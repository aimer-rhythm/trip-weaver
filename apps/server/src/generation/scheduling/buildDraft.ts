// 排程结果 → DraftTrip 落盘（第二期）：把纯函数排出的序列写成草稿活动。
// 文案不在这里编：description 先用候选 intro 截断兜底，随后由 writer 阶段（单次 LLM 调用）统一改写。
// 坐标直接用调研阶段旁路捕获的真实坐标（GCJ-02），标 coordSource='geocoded' 让 geoPipeline 跳过重解析。
import {
  ACTIVITY_CATEGORIES,
  MAX_SOURCE_NOTES,
  type ActivityCategory,
  type GenerateForm,
  type ResearchPoi,
} from '@tripweaver/shared';
import type { DraftTrip } from '../draft';
import { createResearchPlaceLookup, type ResearchLocation } from '../placeLookup';
import type { LongHaulPoi } from '../longHaul';
import { buildSchedule, type ScheduleResult, type SchedulablePoi } from './schedule';
import { poiScore, scoreMaxima } from './score';
import { visitWeight } from './visitWeight';
import type { PlaceFacts } from './placeFacts';

export interface ScheduleDraftInput {
  draft: DraftTrip;
  form: GenerateForm;
  pool: readonly ResearchPoi[];
  locations: ReadonlyMap<string, ResearchLocation>;
  longHaul: readonly LongHaulPoi[];
  foodFocused: boolean;
  facts: ReadonlyMap<string, PlaceFacts>;
}

export interface ScheduleDraftResult {
  schedule: ScheduleResult;
  /** 写入草稿的活动数（含餐次与占位） */
  written: number;
  /** 无坐标候选数：不参与空间聚类，但照样排入（按分数轮流补位），坐标留给 geoPipeline 后续解析 */
  withoutCoord: number;
}

/** 草稿活动类目：餐饮固定「美食」；占位固定「其他」；其余优先用知识库的 8 类目，否则按候选类目回退 */
function activityCategory(poi: SchedulablePoi, facts: PlaceFacts | undefined): ActivityCategory {
  if (poi.category === 'food') return '美食';
  if (poi.category === 'other') return '其他';
  const fromKnowledgeBase = facts?.category;
  if (fromKnowledgeBase && (ACTIVITY_CATEGORIES as readonly string[]).includes(fromKnowledgeBase)) {
    return fromKnowledgeBase as ActivityCategory;
  }
  return poi.category === 'hotel' ? '住宿' : '文化';
}

interface LocatedPoi {
  poi: ResearchPoi;
  /** 调研阶段旁路捕获的坐标；可缺省（后续由 geoPipeline 解析） */
  point?: ResearchLocation;
  facts: PlaceFacts | undefined;
}

/**
 * 确定性排程并写入草稿。
 * 排除规则：hotel 不排成活动（住宿只用表单/推导出的区域名）。
 * 无坐标候选不排除 —— 既有设计里活动坐标由 geoPipeline 在排程之后统一解析，
 * 排程不能因为「调研阶段没抓到坐标」就把好候选丢掉。
 */
export function applyDeterministicSchedule(input: ScheduleDraftInput): ScheduleDraftResult {
  const lookup = createResearchPlaceLookup(input.pool, input.locations);
  const located: LocatedPoi[] = [];
  let withoutCoord = 0;
  for (const poi of input.pool) {
    const { point } = lookup({ name: poi.name, poiId: poi.id });
    const facts = input.facts.get(poi.name.trim());
    // 坐标优先取调研阶段捕到的高德值；没有则用 canonical_places 的坐标兜底
    // （库内 1494/1494 都有，且实测与高德同坐标系：点状地标偏差 64~93m）。
    // 这条兜底让排程不再依赖「模型多调 search_pois」——高德留给知识库没覆盖的地点与封面图。
    const coords =
      point ??
      (facts?.lat !== undefined && facts.lng !== undefined
        ? { lat: facts.lat, lng: facts.lng, adcode: facts.adcode ?? '' }
        : undefined);
    // 住宿不进编排（09-22）：既不排成活动，也不梯推导住宿区域。
    // 之前拿 hotel 候选的 name 当住宿区域名，必然产出具体商家（实测：「北京丽晶酒店」
    // 「观旗宾馆(北京天安门广场店)」），违反「只给区域名、严禁具体酒店」。
    if (poi.category === 'hotel') continue;
    if (!coords) withoutCoord += 1;
    located.push({ poi, ...(coords ? { point: coords } : {}), facts });
  }

  // 选点权重：社区推荐分（质量）0.6 + 提及次数（热度）0.4 + 金集加分。
  // 归一化基准只统计有值的样本；缺失值走中性比例（不当 0）—— 否则金集地标会被排到最后。
  const maxima = scoreMaxima(located.map((item) => item.facts));
  const points: SchedulablePoi[] = located.map(({ poi, point, facts }) => {
    const schedulable: SchedulablePoi = {
      id: poi.id,
      name: poi.name,
      category: poi.category,
      ...(point ? { lat: point.lat, lng: point.lng } : {}),
      score: poiScore(facts, maxima),
      weight: visitWeight(facts),
    };
    if (poi.openTime) schedulable.openTime = poi.openTime;
    const theme = facts?.themes[0];
    if (theme) schedulable.theme = theme;
    // 知识库的 8 活动类目：主题缺失时的回退标签（图片/街道类点上常常没有 themes）
    if (facts?.category) schedulable.kbCategory = facts.category;
    return schedulable;
  });

  const schedule = buildSchedule(points, {
    days: input.form.days,
    foodFocused: input.foodFocused,
    exclusiveNames: input.longHaul.filter((item) => item.tier === 'exclusive').map((item) => item.name),
    fallbackArea: input.form.destination,
    startDate: input.form.startDate || undefined,
  });

  input.draft.setSkeleton(
    `${input.form.destination}${input.form.days}日行程`,
    schedule.days.map((day) => day.title),
  );

  const byId = new Map(located.map((item) => [item.poi.id, item]));
  let written = 0;
  for (const day of schedule.days) {
    for (const stop of day.stops) {
      const source = byId.get(stop.poi.id);
      const mealLabel = stop.meal === 'lunch' ? '午餐' : '晚餐';
      // 占位活动与无美食候选的餐次锚点用目的地定位（geocodeAll 会把它解析成市中心），
      // 不让「自由安排｜北京」这类文案名进入地理编码链。
      const synthetic = !source;
      const placeName = synthetic ? input.form.destination : stop.poi.name;
      const coord = stop.poi.lat !== undefined && stop.poi.lng !== undefined ? { lat: stop.poi.lat, lng: stop.poi.lng } : {};
      input.draft.addActivity(day.dayIndex, {
        name: stop.meal ? `${mealLabel}｜${stop.poi.name}` : stop.poi.name,
        placeName,
        ...(source ? { poiId: stop.poi.id } : {}),
        ...coord,
        // 有真实坐标（调研阶段旁路捕获的 GCJ-02）才标 geocoded；否则留给 geoPipeline 解析
        ...(stop.poi.lat !== undefined ? { coordSource: 'geocoded' as const, coordSystem: 'gcj02' as const } : {}),
        // 不产出时间轴（09-22 D5）：拿不到可信游玩时长，排「几点到几点」是假数据，
        // 而且真实 leg 会在后处理阶段把假时间轴一路推爆（实测第 2 天被推到 22:45）。
        // ActivitySchema 的 startTime/endTime 允许空串，前端按「未排时刻」展示。
        startTime: '',
        endTime: '',
        category: activityCategory(stop.poi, source?.facts),
        description: (source?.poi.intro ?? '').trim().slice(0, 100),
        ...(source?.poi.openTime ? { openTime: source.poi.openTime } : {}),
        ...(source?.poi.sourceLinks.length ? { sourceNotes: source.poi.sourceLinks.slice(0, MAX_SOURCE_NOTES) } : {}),
      });
      written += 1;
    }
  }

  return { schedule, written, withoutCoord };
}
