// 住宿锚点通勤段辅助（ST3）：TransitLeg 哨兵 id 'lodging' 的匹配纯函数 —— 前端 DaySection/地图共用
import type { TransitLeg, TripDay } from './types';

/** TransitLeg from/to 哨兵值：表示当天的住宿锚点（契约见 TransitLegSchema 注释） */
export const LODGING_SENTINEL = 'lodging';

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
