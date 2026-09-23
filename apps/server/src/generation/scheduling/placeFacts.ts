// 排程所需的地点事实补全：候选池 ResearchPoi 只带 name/category/intro，
// 排程要的停留时长 / 细粒度类型 / 主题 / 推荐分 都在 canonical_places.payload 里。
// 一次批量查询（city 过滤 + name = ANY），失败静默降级为空 Map —— 排程退回类型表兜底，不阻断生成。
import { pool } from '../../db/client';

export interface PlaceFacts {
  name: string;
  /** canonical_places.category：8 活动类目，作为停留时长的二级兜底 */
  category: string;
  /** canonical_places.source：goldset | xhs | amap | manual —— 选点权重要用它给金集加分 */
  source: string;
  /** payload.typicalVisitMinutes：上游抽到的真实停留时长 */
  visitMinutes?: number;
  /** payload.xhsPlaceType：细粒度地点类型 */
  placeType?: string;
  /** canonical_places 的坐标（GCJ-02，1494/1494 全覆盖）；调研阶段没抓到坐标时的排程兜底 */
  lng?: number;
  lat?: number;
  /** payload.adcode：行政区划码，transit 路径规划需要 */
  adcode?: string;
  /** payload.themes：社区主题标签，用于生成每天主题 */
  themes: string[];
  /** payload.recommendScore：社区推荐分（缺省 0） */
  recommendScore: number;
  /** payload.mentionCount：被提及次数（缺省 0） */
  mentionCount: number;
}

interface FactRow {
  name: string;
  category: string;
  source: string;
  lng: number | null;
  lat: number | null;
  payload: unknown;
}

/** 防御性读取：payload 是 jsonb，字段类型不由 DB 保证 */
function numberField(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringArrayField(payload: Record<string, unknown>, key: string): string[] {
  const value = payload[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function toFacts(row: FactRow): PlaceFacts {
  const payload = row.payload && typeof row.payload === 'object' ? (row.payload as Record<string, unknown>) : {};
  const placeType = payload.xhsPlaceType;
  const facts: PlaceFacts = {
    name: row.name,
    category: row.category,
    source: row.source,
    themes: stringArrayField(payload, 'themes'),
    recommendScore: numberField(payload, 'recommendScore') ?? 0,
    mentionCount: numberField(payload, 'mentionCount') ?? 0,
  };
  const visit = numberField(payload, 'typicalVisitMinutes');
  if (visit !== undefined) facts.visitMinutes = visit;
  if (typeof placeType === 'string' && placeType) facts.placeType = placeType;
  if (typeof row.lng === 'number' && typeof row.lat === 'number') {
    facts.lng = row.lng;
    facts.lat = row.lat;
  }
  if (typeof payload.adcode === 'string' && payload.adcode) facts.adcode = payload.adcode;
  return facts;
}

/**
 * 按候选名批量取事实。< 1 个名字或查询失败时返回空 Map —— 调用方按「无事实」处理（类型表兜底）。
 * city 必传：跨城市同名地点会因缺 city 过滤而串味（同 retrieveContext 的 city 语义）。
 */
export async function loadPlaceFacts(names: readonly string[], city: string): Promise<Map<string, PlaceFacts>> {
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  if (!unique.length || !city.trim()) return new Map();
  try {
    const { rows } = await pool.query<FactRow>(
      `SELECT name, category, source, lng, lat, payload
       FROM canonical_places
       WHERE city = $1 AND name = ANY($2)`,
      [city, unique],
    );
    return new Map(rows.map((row) => [row.name, toFacts(row)]));
  } catch (err) {
    console.warn(`[placeFacts] 地点事实补全失败，排程按类型表兜底：${err instanceof Error ? err.message : String(err)}`);
    return new Map();
  }
}
