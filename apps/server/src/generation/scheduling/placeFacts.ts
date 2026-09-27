// 排程所需的地点事实补全：候选池 ResearchPoi 只带 name/category/intro，
// 排程要的停留时长 / 细粒度类型 / 主题 / 推荐分 都在 canonical_places.payload 里。
// 一次全城拉取 + TS 侧归一合并（09-23 实体归一）：知识库存在「故宫 / 故宫博物院」式分裂条目，
// 按名精确查会把分数与情报拆散——改为按归一键合并后服务候选。失败静默降级为空 Map，不阻断生成。
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
  /** payload.recommendScore：社区推荐分（缺省 0）；合并取 max（质量分不叠加） */
  recommendScore: number;
  /** payload.mentionCount：被提及次数（缺省 0）；合并求和（热度可叠加） */
  mentionCount: number;
  /** 从 research_evidence 文本挖出的闭馆表述（如「周一闭馆」，截 60 字）：候选无高德 openTime 时的闭馆检测兜底（09-23） */
  closureText?: string;
  /** payload.openHours 渲染出的开闭馆文本（09-27，如「09:00-17:00；周一闭馆」）。
   *  上游给的是结构化数据（closedWeekdays 是明确的星期数字），排程能精确避让 —— 优先于自由文本的 closureText。 */
  openTime?: string;
  /** payload.aliases：上游城市维度别名表（09-27）。只用于实体归一键扩展，不参与排程消费。 */
  aliases: string[];
  /** payload.coverImage：库内封面（09-27），形如 `xhs/杭州/{placeId}/00.webp` 的相对 key。
   *  绝对 URL 由 MEDIA_BASE_URL 拼出，见 generation/storedCover.ts。 */
  coverImage?: string;
}

interface FactRow {
  name: string;
  category: string;
  source: string;
  lng: number | null;
  lat: number | null;
  payload: unknown;
}

/** 机构类尾部后缀（长后缀优先，只剥一次）：「故宫博物院」与「故宫」归一到同键 */
const MERGEABLE_SUFFIXES = [
  '风景名胜区', '自然保护区', '旅游度假区',
  '风景区', '旅游区', '度假区', '博物院', '博物馆', '纪念馆', '陈列馆',
  '公园', '景区', '寺院', '寺庙', '陵寝', '故居', '广场',
] as const;

/**
 * 实体归一键（09-23）：trim + 去尾部机构后缀。
 * 只剥后缀、不做任意子串合并——「沈阳故宫」与「故宫博物院」归一键不同（「沈阳故宫」无后缀可剥），天然隔离。
 * 剥后至少保留 2 个字，防「公园」整名被剥空。
 */
export function normalizePlaceKey(name: string): string {
  const key = name.trim();
  for (const suffix of MERGEABLE_SUFFIXES) {
    if (key.length - suffix.length >= 2 && key.endsWith(suffix)) {
      return key.slice(0, -suffix.length);
    }
  }
  return key;
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

/** 星期标签（索引 = Date.getDay()：0=周日），与 packages/shared/src/openHours.ts 的 WEEKDAY_LABELS 同序 */
const WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;

/**
 * payload.openHours → openTime 文本（09-27）。
 * 上游给的是结构化对象（openTime/closeTime/closedWeekdays/note），渲染成与高德 openTime 同构的
 * 自由文本后，排程的 isClosedOnDate 与 feasibility 的闭馆日检测可直接复用，不必改共享函数签名。
 * 字段缺失或类型不符 → 返回 undefined（不编造）。
 */
export function renderOpenHours(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const hours = raw as Record<string, unknown>;
  const open = typeof hours.openTime === 'string' ? hours.openTime.trim() : '';
  const close = typeof hours.closeTime === 'string' ? hours.closeTime.trim() : '';
  const days = Array.isArray(hours.closedWeekdays)
    ? [...new Set(hours.closedWeekdays.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort(
        (a, b) => a - b,
      )
    : [];
  const note = typeof hours.note === 'string' ? hours.note.trim() : '';
  const parts: string[] = [];
  if (open && close) parts.push(`${open}-${close}`);
  else if (open) parts.push(`${open} 起`);
  else if (close) parts.push(`${close} 止`);
  if (days.length) parts.push(`${days.map((d) => WEEKDAY_CN[d]!).join('、')}闭馆`);
  if (note) parts.push(note);
  return parts.length ? parts.join('；') : undefined;
}

function toFacts(row: FactRow): PlaceFacts {
  const payload = row.payload && typeof row.payload === 'object' ? (row.payload as Record<string, unknown>) : {};
  const facts: PlaceFacts = {
    name: row.name,
    category: row.category,
    source: row.source,
    themes: stringArrayField(payload, 'themes'),
    recommendScore: numberField(payload, 'recommendScore') ?? 0,
    mentionCount: numberField(payload, 'mentionCount') ?? 0,
    aliases: stringArrayField(payload, 'aliases'),
  };
  const visit = numberField(payload, 'typicalVisitMinutes');
  if (visit !== undefined) facts.visitMinutes = visit;
  const placeType = payload.xhsPlaceType;
  if (typeof placeType === 'string' && placeType) facts.placeType = placeType;
  // 结构化开闭馆（09-27）：上游规则挖掘产物，带明确的 closedWeekdays
  const openTime = renderOpenHours(payload.openHours);
  if (openTime) facts.openTime = openTime;
  if (typeof row.lng === 'number' && typeof row.lat === 'number') {
    facts.lng = row.lng;
    facts.lat = row.lat;
  }
  if (typeof payload.adcode === 'string' && payload.adcode) facts.adcode = payload.adcode;
  const cover = payload.coverImage;
  if (typeof cover === 'string' && cover.trim()) facts.coverImage = cover.trim();
  return facts;
}

/** source 优先级：金集 > 社区 > 高德 > 手工（合并时取最高优先来源的标签） */
const SOURCE_RANK: Record<string, number> = { goldset: 0, xhs: 1, amap: 2, manual: 3 };

/** 同键多行合并：质量取 max、热度求和、themes 并集、坐标取有值行、source 取高优先（导出供单测） */
export function mergeFacts(members: PlaceFacts[]): PlaceFacts {
  const base = members.reduce((best, f) => ((SOURCE_RANK[f.source] ?? 9) < (SOURCE_RANK[best.source] ?? 9) ? f : best), members[0]!);
  const merged: PlaceFacts = {
    ...base,
    name: base.name,
    themes: [...new Set(members.flatMap((f) => f.themes))],
    recommendScore: Math.max(...members.map((f) => f.recommendScore)),
    mentionCount: members.reduce((sum, f) => sum + f.mentionCount, 0),
    aliases: [...new Set(members.flatMap((f) => f.aliases))],
  };
  const visits = members.map((f) => f.visitMinutes).filter((v): v is number => v !== undefined);
  if (visits.length) merged.visitMinutes = Math.max(...visits);
  const withCoords = members.find((f) => f.lng !== undefined && f.lat !== undefined);
  if (withCoords) {
    merged.lng = withCoords.lng;
    merged.lat = withCoords.lat;
  }
  const placeType = members.find((f) => f.placeType)?.placeType;
  if (placeType) merged.placeType = placeType;
  // 结构化开闭馆：任一成员有值即可用（闭馆日信息不会互相矛盾到需要仲裁）
  const openTime = members.find((f) => f.openTime)?.openTime;
  if (openTime) merged.openTime = openTime;
  // 库内封面：同键分裂条目里任一有图即可用（图源同批导出，不会互相矛盾）
  const cover = members.find((f) => f.coverImage)?.coverImage;
  if (cover) merged.coverImage = cover;
  return merged;
}

/**
 * 按候选名批量取事实（实体归一版）：全城行拉回 → 归一键分组合并 → 按候选名的归一键服务。
 * 候选「故宫博物院」与库内「故宫」分裂条目由此合并取数（09-23）。
 * 查询失败返回空 Map —— 调用方按「无事实」处理（类型表兜底）。
 * city 必传：跨城市同名地点会因缺 city 过滤而串味（同 retrieveContext 的 city 语义）。
 */
export async function loadPlaceFacts(names: readonly string[], city: string): Promise<Map<string, PlaceFacts>> {
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  if (!unique.length || !city.trim()) return new Map();
  try {
    const { rows } = await pool.query<FactRow>(
      `SELECT name, category, source, lng, lat, payload
       FROM canonical_places
       WHERE city = $1`,
      [city],
    );
    // 归一键 → 合并事实。归一键来源（09-27）：主名 + payload.aliases ——
    // 库内「紫禁城」带别名「故宫」时，候选「故宫」也能命中该行（上游城市别名表）。
    const groups = new Map<string, PlaceFacts[]>();
    for (const row of rows) {
      const facts = toFacts(row);
      const keys = new Set([normalizePlaceKey(row.name), ...facts.aliases.map((a) => normalizePlaceKey(a))]);
      for (const key of keys) {
        if (!key) continue;
        const group = groups.get(key) ?? [];
        group.push(facts);
        groups.set(key, group);
      }
    }
    const mergedByKey = new Map([...groups.entries()].map(([key, members]) => [key, mergeFacts(members)]));

    // 闭馆文本挖掘（09-23）：evidence 里的「周X闭馆/不开放/休息」表述，补高德 openTime 的覆盖缺口
    // （只覆盖 search_pois 来源）。排除「不休息」误报；挖不到就不设字段，绝不编造。
    const { rows: closureRows } = await pool.query<{ name: string; content: string }>(
      `SELECT DISTINCT ON (p.name) p.name, left(e.content, 60) AS content
       FROM research_evidence e JOIN canonical_places p ON p.id = e.place_id
       WHERE p.city = $1
         AND e.content ~ '周[一二三四五六日天][^；;。]{0,8}(闭馆|不开放|休息)'
         AND e.content !~ '不休息'
       ORDER BY p.name, e.fetched_at DESC`,
      [city],
    );
    const closureByKey = new Map(closureRows.map((row) => [normalizePlaceKey(row.name), row.content]));

    // 按候选名归一键服务；key 保持候选传入名（调用方无感）
    const result = new Map<string, PlaceFacts>();
    for (const name of unique) {
      const key = normalizePlaceKey(name);
      const facts = mergedByKey.get(key);
      if (!facts) continue;
      const closure = closureByKey.get(key);
      if (closure) facts.closureText = closure;
      result.set(name, facts);
    }
    return result;
  } catch (err) {
    console.warn(`[placeFacts] 地点事实补全失败，排程按类型表兜底：${err instanceof Error ? err.message : String(err)}`);
    return new Map();
  }
}
