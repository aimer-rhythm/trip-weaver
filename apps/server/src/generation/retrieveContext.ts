// RAG 检索：编排前的外部知识检索入口（09-18 接入）
// 混合召回（KISS）：
//   1. 关键词层（必做，零依赖）：按 names 在 canonical_places 精确命中 + LIKE 前缀兜底，top 8，带 verified 过滤
//   2. 向量层（可选）：env embedding 已配置且 pgvector 扩展可用时，叠加 ORDER BY embedding <=> $1 LIMIT 8
//   3. 对命中 place 批量查 research_evidence（每 place 至多 3 条，实用信息优先于口碑）
// 降级：扩展不可用 / embedding 未配置 / 查询失败 → 退化为仅关键词层或空数组，绝不抛错
import { pool } from '../db/client';
import { env, hasEmbedding } from '../env';
import { embedTexts } from '../integrations/embedding';

export interface EvidenceItem {
  kind: string;
  content: string;
}

export interface RetrievedPlace {
  name: string;
  category: string;
  verified: boolean;
  evidence: EvidenceItem[];
}

interface PlaceRow {
  id: string;
  name: string;
  category: string;
  verified: boolean;
}

/** 关键词层：name = ANY($1) 精确命中 + LIKE 前缀兜底，取 top 8，带 verified 过滤 */
async function keywordRecall(names: string[]): Promise<PlaceRow[]> {
  if (names.length === 0) return [];
  const patterns = names.map((n) => `${n}%`);
  const { rows } = await pool.query<PlaceRow>(
    `SELECT id, name, category, verified
     FROM canonical_places
     WHERE verified = TRUE
       AND (name = ANY($1) OR name LIKE ANY($2))
     ORDER BY (name = ANY($1)) DESC, name
     LIMIT 8`,
    [names, patterns],
  );
  return rows;
}

/** 向量层：pgvector 扩展可用 + embedding 已配置时叠加召回，与关键词层按 id 去重合并 */
async function vectorRecall(names: string[]): Promise<PlaceRow[]> {
  if (!hasEmbedding()) return [];
  if (env.embedding.dims !== 1024) return [];
  const queryVecs = await embedTexts([names.join(' ')]);
  const queryVec = queryVecs[0];
  if (!queryVec) return [];
  const { rows } = await pool.query<PlaceRow>(
    `SELECT id, name, category, verified
     FROM canonical_places
     WHERE verified = TRUE AND embedding IS NOT NULL
     ORDER BY embedding <=> $1
     LIMIT 8`,
    [`[${queryVec.join(',')}]`],
  );
  return rows;
}

/** 批量查 evidence：每 place 至多 3 条，实用信息优先（xhs_warning / xhs_reservation / xhs_price 优先于口碑） */
async function fetchEvidence(placeIds: string[]): Promise<Map<string, EvidenceItem[]>> {
  const map = new Map<string, EvidenceItem[]>();
  if (placeIds.length === 0) return map;
  const { rows } = await pool.query<{ place_id: string; kind: string; content: string }>(
    `SELECT place_id, kind, content
     FROM research_evidence
     WHERE place_id = ANY($1)
     ORDER BY CASE kind
       WHEN 'xhs_warning' THEN 0
       WHEN 'xhs_reservation' THEN 1
       WHEN 'xhs_price' THEN 2
       ELSE 3
     END, fetched_at DESC`,
    [placeIds],
  );
  for (const row of rows) {
    const list = map.get(row.place_id) ?? [];
    if (list.length < 3) {
      list.push({ kind: row.kind, content: row.content });
      map.set(row.place_id, list);
    }
  }
  return map;
}

/** 编排前检索入口：混合召回 + evidence 挂载，返回注入 prompt 的上下文结构 */
export async function retrieveContext(names: string[]): Promise<RetrievedPlace[]> {
  try {
    const keywordHits = await keywordRecall(names);
    let merged: PlaceRow[] = keywordHits;
    try {
      const vectorHits = await vectorRecall(names);
      const seen = new Set(keywordHits.map((r) => r.id));
      merged = [...keywordHits, ...vectorHits.filter((r) => !seen.has(r.id))].slice(0, 8);
    } catch {
      // 向量层失败降级为仅关键词层
    }

    const evidenceMap = await fetchEvidence(merged.map((r) => r.id));
    return merged.map((r) => ({
      name: r.name,
      category: r.category,
      verified: r.verified,
      evidence: evidenceMap.get(r.id) ?? [],
    }));
  } catch (err) {
    console.warn(`[retrieveContext] 检索失败，降级为空数组：${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}
