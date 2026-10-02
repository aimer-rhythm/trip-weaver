import type { PoiCategory } from '@tripweaver/shared';
import type { QueryResultRow } from 'pg';
import { categoryValues, preferenceCategories, rankPlaces, type PlaceRow, type RankedPlace } from './retrievalRanking';

export interface EvidenceItem {
  kind: string;
  content: string;
  strength: string;
  sourceUrl?: string;
}
export interface RetrievedPlace extends PlaceRow {
  aliases: string[];
  evidence: EvidenceItem[];
}
export interface RetrieveOptions {
  city?: string;
  category?: PoiCategory;
  preferences?: readonly string[];
  limit?: number;
  /** 只供系统表单预取；普通空关键词仍返回空数组。 */
  browse?: boolean;
  vector?: 'auto' | 'off' | 'force';
  signal?: AbortSignal;
}
export interface RetrievalDeps {
  query<T extends QueryResultRow>(sql: string, values: unknown[]): Promise<{ rows: T[] }>;
  embed(text: string, signal?: AbortSignal): Promise<number[] | null>;
}

// 不搬运图库、原始笔记、向量或完整金集 activity。
const COLUMNS = `id, city, name, category, verified, source, lat, lng,
  jsonb_build_object('aliases', payload->'aliases', 'themes', payload->'themes',
    'recommendScore', payload->'recommendScore', 'mentionCount', payload->'mentionCount',
    'xhsPlaceType', payload->'xhsPlaceType', 'adcode', payload->'adcode',
    'openHours', payload->'openHours', 'reservation', payload->'reservation',
    'reservationNote', payload->'reservationNote', 'content', payload->'content',
    'topReasons', payload->'topReasons', 'identity', payload->'identity', 'components', payload->'components') AS payload`;
const ALIASES = `CASE WHEN jsonb_typeof(payload->'aliases') = 'array' THEN payload->'aliases' ELSE '[]'::jsonb END`;
const MEMBERS = `CASE WHEN jsonb_typeof(payload->'identity'->'memberNames') = 'array' THEN payload->'identity'->'memberNames' ELSE '[]'::jsonb END`;
const THEMES = `CASE WHEN jsonb_typeof(payload->'themes') = 'array' THEN payload->'themes' ELSE '[]'::jsonb END`;
const SQL_SCORE = `CASE WHEN jsonb_typeof(payload->'recommendScore') = 'number' THEN (payload->>'recommendScore')::numeric END`;

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, '\\$&');
}

/** 注入只读连接便于性能探针跳过 db/client 的自动迁移。 */
export function createPlaceRetriever(deps: RetrievalDeps) {
  return async function retrieve(names: string[], options: RetrieveOptions = {}): Promise<RetrievedPlace[]> {
    const terms = [...new Set(names.map((name) => name.trim()).filter(Boolean))].slice(0, 8);
    if ((!terms.length && !options.browse) || (options.browse && !options.city?.trim()) || options.signal?.aborted) return [];
    const limit = Math.max(1, Math.min(48, Math.floor(options.limit ?? 8)));
    const preferences = options.preferences ?? [];
    const categories = categoryValues(options.category);
    try {
      const { rows } = await deps.query<PlaceRow>(
        `SELECT ${COLUMNS} FROM canonical_places
         WHERE verified = TRUE AND payload->>'canonicalRedirectTo' IS NULL AND ($1::text IS NULL OR city = $1)
           AND (cardinality($4::text[]) = 0 OR category = ANY($4))
           AND ($5::boolean OR name = ANY($2) OR name LIKE ANY($3)
             OR ${ALIASES} ?| $2::text[] OR ${MEMBERS} ?| $2::text[]
             OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(${ALIASES}) a(value) WHERE a.value LIKE ANY($3))
             OR ${THEMES} ?| $2::text[] OR category = ANY($6))
         ORDER BY (name = ANY($2) OR ${ALIASES} ?| $2::text[]) DESC,
           (name LIKE ANY($3)) DESC, (source = 'goldset') DESC, (category = ANY($7) OR ${THEMES} ?| $8::text[]) DESC,
           ${SQL_SCORE} DESC NULLS LAST, name, id
         LIMIT 256`,
        [options.city ?? null, terms, terms.map((term) => `${escapeLike(term)}%`), categories,
          Boolean(options.browse), preferenceCategories(terms), preferenceCategories(preferences), [...preferences]],
      );
      if (options.signal?.aborted) return [];
      let selected = rankPlaces(rows, terms, preferences, limit);
      if (terms.length && options.vector !== 'off' && (selected.length < limit || options.vector === 'force')) {
        try {
          const vector = await deps.embed(terms.join(' '), options.signal);
          if (vector && !options.signal?.aborted) {
            const hits = await deps.query<PlaceRow>(
              `SELECT ${COLUMNS}, embedding <=> $1 AS distance FROM canonical_places
               WHERE verified = TRUE AND payload->>'canonicalRedirectTo' IS NULL AND ($2::text IS NULL OR city = $2) AND embedding IS NOT NULL
                 AND (cardinality($3::text[]) = 0 OR category = ANY($3))
               ORDER BY embedding <=> $1 LIMIT 48`,
              [`[${vector.join(',')}]`, options.city ?? null, categories],
            );
            const unique = new Map([...rows, ...hits.rows].map((row) => [row.id, row]));
            const ranked = rankPlaces([...unique.values()], terms, preferences, limit + selected.length);
            if (options.vector === 'force') selected = ranked.slice(0, limit);
            else {
              const seen = new Set(selected.flatMap((place) => place.ids));
              selected = [...selected, ...ranked.filter((place) => !place.ids.some((id) => seen.has(id)))].slice(0, limit);
            }
          }
        } catch { /* 向量失败时保留关键词结果。 */ }
      }
      if (options.signal?.aborted) return [];
      return await withEvidence(selected, deps);
    } catch (err) {
      console.warn(`[retrieveContext] 检索失败，降级为空数组：${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  };
}

async function withEvidence(places: RankedPlace[], deps: RetrievalDeps): Promise<RetrievedPlace[]> {
  if (!places.length) return [];
  const ids = places.flatMap((place) => place.ids);
  // 在 SQL 限制每个地点的证据条数，再对归并实体取前三条。
  const { rows } = await deps.query<EvidenceItem & { place_id: string; fetched_at: Date }>(
    `SELECT requested.place_id, e.kind, e.content, e.strength, e.source_url AS "sourceUrl", e.fetched_at
     FROM unnest($1::text[]) requested(place_id)
     CROSS JOIN LATERAL (
       SELECT kind, left(content, 160) AS content, strength, source_url, fetched_at
       FROM research_evidence WHERE place_id = requested.place_id
       ORDER BY CASE kind WHEN 'xhs_warning' THEN 0 WHEN 'xhs_reservation' THEN 1 WHEN 'xhs_price' THEN 2 ELSE 3 END,
         CASE strength WHEN 'direct' THEN 0 WHEN 'risk_only' THEN 1 ELSE 2 END, fetched_at DESC, id
       LIMIT 3
     ) e`, [ids],
  );
  const kindOrder: Record<string, number> = { xhs_warning: 0, xhs_reservation: 1, xhs_price: 2 };
  const strengthOrder: Record<string, number> = { direct: 0, risk_only: 1 };
  return places.map(({ row, ids: memberIds, aliases }) => ({ ...row, aliases: [...new Set(aliases)],
    evidence: rows.filter((e) => memberIds.includes(e.place_id)).sort((a, b) =>
      (kindOrder[a.kind] ?? 3) - (kindOrder[b.kind] ?? 3)
      || (strengthOrder[a.strength] ?? 2) - (strengthOrder[b.strength] ?? 2)
      || new Date(b.fetched_at).getTime() - new Date(a.fetched_at).getTime())
      .slice(0, 3).map(({ kind, content, strength, sourceUrl }) => ({ kind, content, strength: strength || 'weak', sourceUrl })),
  }));
}
