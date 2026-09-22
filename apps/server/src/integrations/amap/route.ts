// 高德路径规划适配层（v0.5）：步行/驾车/公交三模式时长距离估算 + 折线抽稀
// 纪律沿用四道闸：与 geocoder 共用串行队列（350ms）+ 24h TTL 缓存（键=坐标取整5位+mode，仅缓存成功结果）；
// 任务级上限 ROUTE_MAX_PER_TASK 与日额度由 generation/geoPipeline 把关并计入 amap_calls。
// 任何故障回 null —— 上层降级 legEstimator 启发式，生成流程永不因此失败。
import type { LegMode } from '@tripweaver/shared';
import { TtlCache } from '../../lib/ttlCache';
import { amapQueue } from './geocoder';

const ROUTE_URLS: Record<LegMode, string> = {
  walk: 'https://restapi.amap.com/v5/direction/walking',
  cycle: 'https://restapi.amap.com/v5/direction/bicycling',
  drive: 'https://restapi.amap.com/v5/direction/driving',
  transit: 'https://restapi.amap.com/v5/direction/transit/integrated',
};

export const ROUTE_MAX_PER_TASK = 30;   // 单次生成 ≤30 次路径规划，超出走启发式
export const ROUTE_BREAKER_THRESHOLD = 5;   // 任务级熔断阈值：route 连续失败 ≥5 次即熔断（任一成功清零）

const MAX_POLYLINE_CHARS = 4000;
const cache = new TtlCache<RouteEstimate>(24 * 60 * 60 * 1000, 300);

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
  // 只缓存成功结果：失败（网络/超时/限流/无方案）不做 24h 负缓存，
  // 避免一次瞬时故障把该点对钉死在启发式（重试成本已由任务级上限与日额度闸门约束）
  if (estimate) cache.set(cacheKey, estimate);
  return estimate;
}

// ---------- 任务级连续失败熔断（circuit breaker，07-18） ----------
// 背景：负缓存拆除后，本机/网络异常导致 route 大面积超时（单次硬等 10s + 350ms 队列间隔）时，
// 首轮 geoPipeline、层3 修复器定向重算、修订轮会把失败段反复真实重试，最坏
// ROUTE_MAX_PER_TASK×10.35s≈5.2min，叠加 LLM 推理直接吃穿整任务 10min 超时（终态 cancelled）。
// 语义：同一生成任务内连续失败（超时/网络错/status!=1/无方案，适配层统一吞错回 null）达阈值
// → 熔断开启：后续 estimate 直接回 null（调用方走启发式降级），不再发请求、不消耗 route 额度；
// 任一次成功（含缓存命中）清零计数。状态为任务级会话内存，不跨任务不持久化 —— 下个任务重新给高德机会。

export interface RouteBreaker {
  /** 熔断是否已开启：开启后调用方可提前跳过 adcode 解析等前置准备 */
  isOpen(): boolean;
  /** 当前连续失败计数（成功清零；供日志与测试观测） */
  failStreak(): number;
  /**
   * 经熔断与额度闸门包装的路径规划。
   * @param tryAcquire 任务级 route 额度记账回调（拒绝则不发请求）；熔断开启时不调用 —— 没发请求就不扣额度。
   * 回 null 且不计失败的情形：熔断已开启 / transit 缺 adcode / 额度拒绝（三者均未发起真实请求）。
   */
  estimate(
    apiKey: string,
    origin: GeoPoint,
    dest: GeoPoint,
    mode: LegMode,
    opts: RouteOpts,
    tryAcquire: () => boolean,
  ): Promise<RouteEstimate | null>;
}

/** 每个生成任务（geoSession）各建一个实例：熔断状态与该任务同生命周期 */
export function createRouteBreaker(): RouteBreaker {
  let failStreak = 0;
  let open = false;
  return {
    isOpen: () => open,
    failStreak: () => failStreak,
    async estimate(apiKey, origin, dest, mode, opts, tryAcquire) {
      if (open) return null;   // 熔断开启：不发请求、不扣额度，调用方直接启发式
      // transit 缺 adcode 时 routeEstimate 不会发真实请求：提前拦截，不扣额度也不计失败
      if (mode === 'transit' && (!opts.city1 || !opts.city2)) return null;
      if (!tryAcquire()) return null;   // 任务级上限拒绝：未发请求，不计失败
      const route = await routeEstimate(apiKey, origin, dest, mode, opts);
      if (route) {
        failStreak = 0;   // 任一次成功（含缓存命中）清零连续失败
        return route;
      }
      // 走到这里 = 一次真实调用尝试失败（超时/网络错/status!=1/无方案）
      failStreak += 1;
      if (failStreak >= ROUTE_BREAKER_THRESHOLD) {
        open = true;
        // 生成会话层无 Fastify logger 可达：单行 warn 供运维定位「整任务全启发式」根因，无敏感信息
        console.warn(
          `[amap-route] 路径规划连续失败 ${failStreak} 次（超时/网络错/status!=1/无方案），本任务熔断：后续通勤不再请求高德，直接启发式降级`,
        );
      }
      return null;
    },
  };
}
