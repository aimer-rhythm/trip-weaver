// 住宿锚点通勤段辅助（ST3）：TransitLeg 哨兵 id 'lodging' 的匹配纯函数 —— 前端 DaySection/地图共用
import { haversineMeters } from './geo';
import type { LegMode, TransitLeg, TripDay } from './types';

/** TransitLeg from/to 哨兵值：表示当天的住宿锚点（契约见 TransitLegSchema 注释） */
export const LODGING_SENTINEL = 'lodging';

// 通勤启发式的唯一事实源（v0.5）：相邻活动 <1.5km 走路，否则按出行方式基调估算
export const WALK_THRESHOLD_M = 1500;
const DETOUR_FACTOR = 1.4;   // 直线 → 实际路网绕行系数
// 速度（km/h）与固定开销（分钟）：transit 含换乘等待、drive 含取还车/停车
const MODE_PARAMS: Record<LegMode, { speedKmh: number; overheadMin: number }> = {
  walk: { speedKmh: 4.5, overheadMin: 0 },
  transit: { speedKmh: 20, overheadMin: 10 },
  drive: { speedKmh: 30, overheadMin: 5 },
};

/**
 * 两点通勤的确定性启发式估算（纯函数、无 IO）：高德失败/无 leg 时的兜底。
 * 服务端 legEstimator 与可行性引擎共用同一速度模型，避免逻辑漂移。
 */
export function estimateTransit(
  origin: { lat: number; lng: number },
  dest: { lat: number; lng: number },
  mode: LegMode,
): { durationMin: number; distanceM: number } {
  const distanceM = Math.round(haversineMeters(origin, dest) * DETOUR_FACTOR);
  const { speedKmh, overheadMin } = MODE_PARAMS[mode];
  const durationMin = Math.max(1, Math.round((distanceM / 1000 / speedKmh) * 60 + overheadMin));
  return { durationMin, distanceM };
}

export interface LodgingLegs {
  /** 住宿 → 当天首个活动（严格匹配当前首活动 id，重排/删改后失配即丢弃） */
  departure?: TransitLeg;
  /** 当天末活动 → 住宿 */
  returning?: TransitLeg;
}

/** 按当前活动顺序匹配当天住宿 leg；无活动或失配时返回空对象，由调用方静默跳过 */
export function lodgingLegsForDay(day: TripDay): LodgingLegs {
  const first = day.activities[0];
  const last = day.activities[day.activities.length - 1];
  if (!first || !last || !day.legs?.length) return {};
  return {
    departure: day.legs.find((l) => l.fromActivityId === LODGING_SENTINEL && l.toActivityId === first.id),
    returning: day.legs.find((l) => l.fromActivityId === last.id && l.toActivityId === LODGING_SENTINEL),
  };
}
