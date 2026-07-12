// 高德路径规划适配层（v0.5）：步行/驾车/公交三模式时长距离估算 + 折线抽稀
// 纪律沿用四道闸：与 geocoder 共用串行队列（350ms）+ 24h TTL 缓存（键=坐标取整5位+mode）；
// 任务级上限 ROUTE_MAX_PER_TASK 与日额度由 generation/geoPipeline 把关并计入 amap_calls。
// 任何故障回 null —— 上层降级 legEstimator 启发式，生成流程永不因此失败。
import type { LegMode } from '@tripweaver/shared';
import { TtlCache } from '../../lib/ttlCache';
import { amapQueue } from './geocoder';

const ROUTE_URLS: Record<LegMode, string> = {
  walk: 'https://restapi.amap.com/v5/direction/walking',
  drive: 'https://restapi.amap.com/v5/direction/driving',
  transit: 'https://restapi.amap.com/v5/direction/transit/integrated',
};

export const ROUTE_MAX_PER_TASK = 30;   // 单次生成 ≤30 次路径规划，超出走启发式

const MAX_POLYLINE_CHARS = 4000;
const cache = new TtlCache<RouteEstimate | null>(24 * 60 * 60 * 1000, 300);

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface RouteEstimate {
  durationMin: number;
  distanceM: number;
  polyline?: string;   // 「lng,lat;lng,lat…」抽稀后串；超长丢弃仅留时长距离
}

export interface RouteOpts {
  city1?: string;   // 起点 adcode（transit 必需）
  city2?: string;   // 终点 adcode（transit 必需）
}

function num(v: unknown): number {
  const n = typeof v === 'string' ? Number.parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : 0;
}

/** 折线抽稀：等间隔取点压到 4000 字符内；仍超长则整体丢弃（回 undefined） */
export function downsamplePolyline(points: string[]): string | undefined {
  const clean = points.filter(Boolean);
  if (!clean.length) return undefined;
  // 单点约 20 字符（含分隔符），据此估算保留点数
  const keep = Math.max(2, Math.floor(MAX_POLYLINE_CHARS / 20));
  const step = Math.max(1, Math.ceil(clean.length / keep));
  const sampled = clean.filter((_, i) => i % step === 0 || i === clean.length - 1);
  const joined = sampled.join(';');
  return joined.length <= MAX_POLYLINE_CHARS ? joined : undefined;
}

/** 从 v5 步行/驾车 paths[0] 或公交 transits[0] 中提取时长（秒）/距离（米）/折线点 */
function parseRoute(mode: LegMode, body: Record<string, unknown>): RouteEstimate | null {
  const route = (body.route ?? {}) as Record<string, unknown>;
  const listKey = mode === 'transit' ? 'transits' : 'paths';
  const first = Array.isArray(route[listKey]) ? ((route[listKey] as unknown[])[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) return null;
  const cost = (first.cost ?? {}) as Record<string, unknown>;
  const durationSec = num(cost.duration) || num(first.duration);
  const distanceM = num(first.distance);
  if (!durationSec && !distanceM) return null;
  // 公交换乘 segments 结构复杂且折线意义有限，只对步行/驾车取 steps[].polyline
  let polyline: string | undefined;
  if (mode !== 'transit' && Array.isArray(first.steps)) {
    const points = (first.steps as Record<string, unknown>[])
      .map((s) => (typeof s.polyline === 'string' ? s.polyline : ''))
      .join(';')
      .split(';');
    polyline = downsamplePolyline(points);
  }
  return {
    durationMin: Math.max(1, Math.round(durationSec / 60)),
    distanceM: Math.round(distanceM),
    ...(polyline ? { polyline } : {}),
  };
}

/** 两点间路径规划；transit 缺 adcode 时直接回 null（上层走启发式降级） */
export async function routeEstimate(
  apiKey: string,
  origin: GeoPoint,
  dest: GeoPoint,
  mode: LegMode,
  opts: RouteOpts = {},
): Promise<RouteEstimate | null> {
  if (mode === 'transit' && (!opts.city1 || !opts.city2)) return null;
  const fmt = (p: GeoPoint) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`;   // 高德要求「lng,lat」，取整 5 位兼作缓存键
  const cacheKey = `${mode}:${fmt(origin)}:${fmt(dest)}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  const estimate = await amapQueue(async () => {
    try {
      const params = new URLSearchParams({
        key: apiKey,
        origin: fmt(origin),
        destination: fmt(dest),
        show_fields: 'polyline,cost',
      });
      if (mode === 'transit') {
        params.set('city1', opts.city1!);
        params.set('city2', opts.city2!);
      }
      const res = await fetch(`${ROUTE_URLS[mode]}?${params}`, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as Record<string, unknown>;
      if (body.status !== '1') throw new Error(String(body.info || '未知错误'));
      return parseRoute(mode, body);
    } catch {
      return null;
    }
  });
  cache.set(cacheKey, estimate);
  return estimate;
}
