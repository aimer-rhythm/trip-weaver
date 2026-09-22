// 确定性排程核心（09-21 落地 / 09-22 重构）：纯函数、零 IO、零外呼。
//
// **不产出时间轴**（09-22 D5）：拿不到可信的游玩时长，排出来的「几点到几点」全是假数据，
// 而且真实高德 leg 会在后处理阶段把这条假时间轴一路推爆（实测第 2 天被推到 22:45）。
// 现在只决定三件事：入选哪些点、每个点在哪天、当天内的顺路顺序。
//
// 分组算法：**先成链再切段**（route-first, cluster-second）
//   1. 全局最近邻把入选点连成一条巡游链 —— 链本身就近似最优顺路顺序，段内不需要再做 TSP
//   2. 按顺序把链切成 k 段（k = 可用天数），段内保持链上顺序
//   3. 段按权重降序分配 Day1..k（D1：分数高的排靠前的天）
//
// 分数只决定「入选 + 分到哪天」，不插手段内顺序 —— 否则会把高分点插到不顺路的位置，
// 通勤成本又回来了（景山→故宫 41min 那种段就是这么来的）。
import type { PoiCategory } from '@tripweaver/shared';

export interface SchedulablePoi {
  id: string;
  name: string;
  /** 候选类目：attraction 参与排程；food 仅作为餐次锚点；hotel 不排成活动；other 仅用于空天占位 */
  category: PoiCategory | 'other';
  /** 坐标可缺省：无坐标候选不参与成链，按分数轮流补位（既有设计里坐标由 geoPipeline 事后解析） */
  lat?: number;
  lng?: number;
  /** 入选与分天权重（社区推荐分 + 提及次数的归一化合成），越大越优先 */
  score: number;
  /** payload.themes 的首个标签，用于每天主题 */
  theme?: string;
  /** 知识库的 8 活动类目（文化/自然/…），主题缺失时的回退标签 */
  kbCategory?: string;
}

export interface ScheduledStop {
  poi: SchedulablePoi;
  /** 确定性插入的餐次标记（锚点是真实美食候选，语义是「这一餐」） */
  meal?: 'lunch' | 'dinner';
}

export interface ScheduledDay {
  dayIndex: number;
  /** 当天主题（成员 themes 众数 → 知识库类目 → 空天占位） */
  title: string;
  stops: ScheduledStop[];
}

export interface ScheduleOptions {
  days: number;
  /** 美食导向时每天插午餐 + 晚餐（D6：偏好含「美食」才要求） */
  foodFocused: boolean;
  /** longHaul.ts 判出的【强独占级】地点名：各自独占一天 */
  exclusiveNames?: readonly string[];
  /** 餐次锚点缺失、或空天占位时的兜底片区名（通常传目的地） */
  fallbackArea?: string;
}

export interface ScheduleResult {
  days: ScheduledDay[];
  /** 因天数/容量不足未排入的候选数（D5：排不下就少排，不硬塞） */
  droppedCount: number;
}

export const SCHEDULE_LIMITS = {
  /** 单日最多活动数（既有单日 ≤8 完整性校验的上游约束，排程收紧到 6） */
  maxStopsPerDay: 6,
  /** 空天占位活动的名称前缀（知识库无覆盖时如实占位，不编造地点） */
  emptyDayPrefix: '自由安排',
} as const;

type Coord = { lat: number; lng: number };

/** 类型守卫保留原对象类型（不降级成 Coord），否则 filter 会把 SchedulablePoi 的信息丢光 */
function hasCoord<T extends { lat?: number; lng?: number }>(poi: T): poi is T & Coord {
  return typeof poi.lat === 'number' && typeof poi.lng === 'number' && (poi.lat !== 0 || poi.lng !== 0);
}

export function distanceKm(a: Coord, b: Coord): number {
  const dLat = (a.lat - b.lat) * 111;
  const dLng = (a.lng - b.lng) * 111 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

/**
 * 全局最近邻成链：从权重最高的点出发，每次接最近的下一个。
 * 无坐标候选不参与几何成链（不知道它在哪），按分数接在链尾 —— 它们的坐标由 geoPipeline 事后解析。
 */
function buildChain(points: readonly SchedulablePoi[]): SchedulablePoi[] {
  const located = points.filter(hasCoord);
  const stranded = points.filter((poi) => !hasCoord(poi));
  if (located.length <= 1) return [...located, ...stranded];

  const start = located.reduce((best, poi) => (poi.score > best.score ? poi : best), located[0]!);
  const remaining = new Set<SchedulablePoi>(located);
  remaining.delete(start);
  const chain: SchedulablePoi[] = [start];
  let cursor: Coord = start;
  while (remaining.size) {
    let nearest: SchedulablePoi | null = null;
    let nearestKm = Infinity;
    for (const poi of remaining) {
      if (!hasCoord(poi)) continue;
      const km = distanceKm(cursor, poi);
      if (km < nearestKm) {
        nearestKm = km;
        nearest = poi;
      }
    }
    if (!nearest) break;
    chain.push(nearest);
    remaining.delete(nearest);
    if (hasCoord(nearest)) cursor = nearest;   // located 里元素必有坐标，这里只是让类型收窄
  }
  return [...chain, ...stranded];
}

/** 把链均分成 k 段：每段 ⌈n/k⌉ 个，余数自然落在前面的段（链上相邻 = 地理相邻） */
function cutChain(chain: readonly SchedulablePoi[], k: number): SchedulablePoi[][] {
  if (k <= 0 || !chain.length) return [];
  const per = Math.ceil(chain.length / k);
  const segments: SchedulablePoi[][] = [];
  for (let i = 0; i < k; i++) {
    const slice = chain.slice(i * per, (i + 1) * per);
    if (slice.length) segments.push(slice);
  }
  return segments;
}

function dayTitle(members: readonly SchedulablePoi[]): string {
  const count = (pick: (poi: SchedulablePoi) => string | undefined) => {
    const tally = new Map<string, number>();
    for (const poi of members) {
      const value = pick(poi);
      if (value) tally.set(value, (tally.get(value) ?? 0) + 1);
    }
    return [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  };
  // 先看社区主题标签，再退知识库的 8 活动类目（09-22 修：原来读的是 attraction/food/hotel 英文枚举，
  // 永远匹配不上中文类目表，每天都退化成「自由漫步」）
  return count((poi) => poi.theme) ?? count((poi) => poi.kbCategory) ?? '自由漫步';
}

/** 餐次锚点：离上一个点最近、尚未使用的美食候选；没有就退到目的地名（不编造门店） */
function takeMealAnchor(foods: Set<SchedulablePoi>, near: SchedulablePoi | undefined): SchedulablePoi | undefined {
  if (!foods.size) return undefined;
  let best: SchedulablePoi | undefined;
  if (near && hasCoord(near)) {
    let bestKm = Infinity;
    for (const food of foods) {
      if (!hasCoord(food)) continue;
      const km = distanceKm(near, food);
      if (km < bestKm) {
        bestKm = km;
        best = food;
      }
    }
  }
  const anchor = best ?? [...foods][0]!;
  foods.delete(anchor);
  return anchor;
}

/** 美食导向时在段内插午餐（中段之后）与晚餐（段尾）；餐次锚点也是候选池里的真实美食点 */
function withMeals(
  members: readonly SchedulablePoi[],
  foods: Set<SchedulablePoi>,
  kind: 'lunch' | 'dinner',
  near: SchedulablePoi | undefined,
  fallbackArea: string,
): ScheduledStop {
  const anchor = takeMealAnchor(foods, near);
  const poi: SchedulablePoi = anchor ?? {
    id: `meal-${kind}-${members.length}`,
    name: fallbackArea,
    category: 'food',
    score: 0,
  };
  return { poi, meal: kind };
}

function placeholderStop(destination: string): ScheduledStop {
  return {
    poi: {
      id: `placeholder-${destination}`,
      name: `${SCHEDULE_LIMITS.emptyDayPrefix}｜${destination}`,
      category: 'other',
      score: 0,
    },
  };
}

/**
 * 排程主入口：入选 → 成链 → 切段 → 段按权重分天 → 餐次插槽 → 空天占位。
 *
 * 天数与段数可能对不上：强独占级点数 > 天数时，超出部分如实丢弃（不把远端点和市区点混排，
 * 那正是层2 长途点纪律要防的事）；候选不足时当天用占位活动兜底（保住「每天至少一个活动」的门槛）。
 */
export function buildSchedule(candidates: readonly SchedulablePoi[], options: ScheduleOptions): ScheduleResult {
  const byScore = (a: SchedulablePoi, b: SchedulablePoi) => b.score - a.score || a.name.localeCompare(b.name);
  const attractions = candidates.filter((poi) => poi.category === 'attraction').sort(byScore);
  const foods = new Set(candidates.filter((poi) => poi.category === 'food').sort(byScore));
  const dropped = new Set<SchedulablePoi>();

  const exclusiveNames = new Set(options.exclusiveNames ?? []);
  const exclusive = attractions.filter((poi) => exclusiveNames.has(poi.name));
  const rest = attractions.filter((poi) => !exclusiveNames.has(poi.name));

  // 天数被强独占级吃掉的部分先算掉：独占点各占一天，多出来的直接丢弃
  const keptExclusive = exclusive.slice(0, options.days);
  for (const poi of exclusive.slice(options.days)) dropped.add(poi);

  // 入选：其余按分数取到容量上限，超出的按分数丢弃
  const capacity = Math.max(0, options.days * SCHEDULE_LIMITS.maxStopsPerDay - keptExclusive.length);
  const selected = rest.slice(0, capacity);
  for (const poi of rest.slice(capacity)) dropped.add(poi);

  const segments: SchedulablePoi[][] = keptExclusive.map((poi) => [poi]);
  const remainingDays = options.days - segments.length;
  if (remainingDays > 0) segments.push(...cutChain(buildChain(selected), remainingDays));

  // 段按权重降序 → Day1..k（D1：分数高的排靠前）。
  // 权重取**段内最高分**而非总分：总分会让「三个平庸点」压过「一个必去点」，
  // 把长城这类独占日的头牌推到 Day2。
  const weight = (segment: readonly SchedulablePoi[]) => Math.max(...segment.map((poi) => poi.score));
  segments.sort((a, b) => weight(b) - weight(a));

  const fallbackArea = options.fallbackArea?.trim() || '目的地';
  const days: ScheduledDay[] = Array.from({ length: options.days }, (_, index) => ({
    dayIndex: index + 1,
    title: '自由漫步',
    stops: [] as ScheduledStop[],
  }));

  segments.slice(0, options.days).forEach((segment, index) => {
    const day = days[index]!;
    day.title = dayTitle(segment);
    const stops: ScheduledStop[] = segment.map((poi) => ({ poi }));
    if (options.foodFocused) {
      // 午餐落在段中段之后、晚餐落段尾：没有时间轴，位置只表达阅读顺序
      const lunchAt = Math.max(1, Math.ceil(stops.length / 2));
      stops.splice(lunchAt, 0, withMeals(segment, foods, 'lunch', segment[lunchAt - 1], fallbackArea));
      stops.push(withMeals(segment, foods, 'dinner', segment[segment.length - 1], fallbackArea));
    }
    day.stops = stops;
  });

  for (const day of days) {
    if (day.stops.length) continue;
    day.title = SCHEDULE_LIMITS.emptyDayPrefix;
    day.stops = [placeholderStop(fallbackArea)];
  }

  return { days, droppedCount: dropped.size };
}
