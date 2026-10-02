import type { QueryResultRow } from 'pg';

interface ImportPlace { id: string; name: string; payload?: Record<string, unknown> }
interface QueryClient { query<T extends QueryResultRow>(sql: string, params: unknown[]): Promise<{ rows: T[]; rowCount: number | null }> }

// 上游权威字段替换旧值，不能让 goldset 合并顺序保留旧的矛盾政策。
const CONTENT_KEYS = ['content', 'topReasons', 'aliases', 'identity', 'components', 'reservation', 'reservationNote',
  'reservationEvidence', 'reservationConflict', 'openHours', 'hours', 'price'];

/** 在地点导入的同一事务中执行。旧记录只重定向，保留来源、照片和历史引用。 */
export async function reconcileImportedPlaces(client: QueryClient, city: string, places: readonly ImportPlace[]): Promise<number> {
  const owners = new Map<string, string>();
  const records = places.flatMap((place) => {
    const identity = place.payload?.identity;
    if (!identity || typeof identity !== 'object' || Array.isArray(identity)) return [];
    const value = identity as Record<string, unknown>;
    if (value.version !== 1 || value.canonicalName !== place.name || !Array.isArray(value.memberNames)
      || !value.memberNames.includes(place.name) || value.memberNames.length > 100
      || value.memberNames.some((n) => typeof n !== 'string' || !n.trim() || n.length > 128)) {
      throw new Error(`地点归一元数据无效：${place.name}`);
    }
    for (const name of value.memberNames as string[]) {
      if (owners.has(name) && owners.get(name) !== place.id) throw new Error(`地点归属冲突：${name}`);
      owners.set(name, place.id);
    }
    return [{ id: place.id, names: value.memberNames,
      payload: Object.fromEntries(CONTENT_KEYS.filter((key) => place.payload?.[key] !== undefined).map((key) => [key, place.payload![key]])) }];
  });
  if (!records.length) return 0;
  const encoded = JSON.stringify(records);
  await client.query(`UPDATE canonical_places p SET payload =
    (COALESCE(p.payload, '{}'::jsonb) - $3::text[] - 'canonicalRedirectTo') || v.payload
    FROM jsonb_to_recordset($2::jsonb) AS v(id text, names jsonb, payload jsonb)
    WHERE p.id=v.id AND p.city=$1 AND p.source IN ('xhs','goldset')`, [city, encoded, CONTENT_KEYS]);
  const result = await client.query(`UPDATE canonical_places p SET payload =
    COALESCE(p.payload, '{}'::jsonb) || jsonb_build_object('canonicalRedirectTo', v.id)
    FROM jsonb_to_recordset($2::jsonb) AS v(id text, names jsonb, payload jsonb)
    WHERE p.city=$1 AND p.source IN ('xhs','goldset') AND p.id<>v.id
      AND v.names ? p.name AND p.payload->>'canonicalRedirectTo' IS DISTINCT FROM v.id`, [city, encoded]);
  return result.rowCount ?? 0;
}
