// 通勤启发式估算（v0.5）：高德失败/超额/无 Key 时的确定性降级，生成流程永不因此失败
import { haversineMeters, type LegMode } from '@tripweaver/shared';

const DETOUR_FACTOR = 1.4;   // 直线 → 实际路网绕行系数

// 速度（km/h）与固定开销（分钟）：transit 含换乘等待、drive 含取还车/停车
const MODE_PARAMS: Record<LegMode, { speedKmh: number; overheadMin: number }> = {
  walk: { speedKmh: 4.5, overheadMin: 0 },
  transit: { speedKmh: 20, overheadMin: 10 },
  drive: { speedKmh: 30, overheadMin: 5 },
};

export interface LegEstimate {
  durationMin: number;
  distanceM: number;
  source: 'heuristic';
}

export function estimateLeg(
  origin: { lat: number; lng: number },
  dest: { lat: number; lng: number },
  mode: LegMode,
): LegEstimate {
  const distanceM = Math.round(haversineMeters(origin, dest) * DETOUR_FACTOR);
  const { speedKmh, overheadMin } = MODE_PARAMS[mode];
  const durationMin = Math.max(1, Math.round((distanceM / 1000 / speedKmh) * 60 + overheadMin));
  return { durationMin, distanceM, source: 'heuristic' };
}
