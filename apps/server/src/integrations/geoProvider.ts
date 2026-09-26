// 地图服务商门面（09-25）：上层只认这里，不直接碰 amap/* 或 tianditu/*。
// 选哪家由站点级环境变量 MAP_PROVIDER 决定（手动切换，不做自动回退 —— 见 prd Decisions）。
// 坐标系契约：本门面进出的坐标**一律 GCJ-02**。WGS-84 ↔ GCJ-02 的转换收敛在各适配器内部，
// 上层（geoPipeline / orchestrator）完全感知不到 provider 差异。
import { env, type MapProvider } from '../env';
import { resolveAmapCredential } from '../services/settingsService';
import { amapBudgetRemaining, tiandituBudgetRemaining } from '../services/quotaService';
import { geocodeFallbackGcj02 } from './geocode';
import { geocodeActivity as amapGeocodeActivity } from './amap/geocoder';
import { createAmapRouteBreaker } from './amap/route';
import { createPoiSource as createAmapPoiSource, resolvePoiSourceForUser as resolveAmapPoiSourceForUser } from './amap/poiSource';
import { tiandituGeocodeActivity } from './tianditu/geo';
import { createTiandituRouteBreaker } from './tianditu/route';
import { resolveTiandituPoiSource } from './tianditu/poiSource';
import { getNullPoiSource } from './nullPoiSource';
import { createRouteBreaker } from './routeBreaker';
import type { GeocodedPlace, PoiSource, RouteBreaker } from './geoContracts';

export interface GeoProvider {
  readonly kind: MapProvider | 'null';
  /** 是否绑定了可用的真实凭据。false 时上层整条 provider 链路跳过，只留 Nominatim → 启发式两级。 */
  readonly enabled: boolean;
  /** 活动坐标解析链（provider 级 → Nominatim → null）；@param tryAcquire 任务级额度记账回调 */
  geocodeActivity(name: string, city: string, tryAcquire: () => boolean): Promise<GeocodedPlace | null>;
  /** 每个生成任务建一个实例：熔断状态随任务生灭；凭据与目的地上下文绑定在实例内 */
  createRouteBreaker(): RouteBreaker;
  createPoiSource(): PoiSource;
  /** 该服务商的当日剩余额度（供任务级预留量闸门；Null provider 恒为 0） */
  budgetRemaining(): Promise<number>;
}

/** 未配置凭据时的降级 provider：provider 级整级跳过，保留 Nominatim → 启发式（与存量行为一致） */
export function createNullGeoProvider(): GeoProvider {
  return {
    kind: 'null',
    enabled: false,
    geocodeActivity: async (name, city) => {
      const fallback = await geocodeFallbackGcj02(name, city);
      return fallback ? { ...fallback, origin: 'nominatim' } : null;
    },
    // 前置拦截恒真：任何调用都在扣额度之前被挡下，不计失败也不消耗额度
    createRouteBreaker: () => createRouteBreaker({ estimate: async () => null, skip: () => true, label: '[no-provider]' }),
    createPoiSource: getNullPoiSource,
    budgetRemaining: async () => 0,
  };
}

function createAmapProvider(apiKey: string): GeoProvider {
  return {
    kind: 'amap',
    enabled: true,
    geocodeActivity: (name, city, tryAcquire) => amapGeocodeActivity(apiKey, name, city, tryAcquire),
    createRouteBreaker: () => createAmapRouteBreaker(apiKey),
    createPoiSource: () => createAmapPoiSource(apiKey),
    budgetRemaining: amapBudgetRemaining,
  };
}

/** @param tk 天地图服务端 Key；入参与城市无关（/transit 自行从坐标推断城市） */
function createTiandituProvider(tk: string): GeoProvider {
  return {
    kind: 'tianditu',
    enabled: true,
    geocodeActivity: (name, city, tryAcquire) => tiandituGeocodeActivity(tk, name, city, tryAcquire),
    createRouteBreaker: () => createTiandituRouteBreaker(tk),
    createPoiSource: () => resolveTiandituPoiSource(tk),
    budgetRemaining: tiandituBudgetRemaining,
  };
}

/**
 * 按 MAP_PROVIDER 解析服务商实例（凭据已绑定）；未配置对应 Key 时回 Null provider。
 * 显式选了天地图却没给 tk 也走 Null —— **不回退高德**（手动切换要可预测，静默双开会让额度与排查失控）。
 * 日额度闸门不在这里：需要按任务级预留量判断，由调用方（geoPipeline / orchestrator）叠加。
 */
export async function resolveGeoProvider(userId: string): Promise<GeoProvider> {
  if (env.mapProvider === 'tianditu') {
    return env.tiandituKey ? createTiandituProvider(env.tiandituKey) : createNullGeoProvider();
  }
  // 高德：个人 Key 优先、站点 Key 兜底，按用户解析（个人凭据不进全局单例）
  const credential = await resolveAmapCredential(userId);
  return credential ? createAmapProvider(credential.apiKey) : createNullGeoProvider();
}

export interface ResolvedPoiSource {
  source: PoiSource;
  credentialRevision: string;
  credentialOrigin: 'personal' | 'site' | 'none';
}

/** 当前生效服务商的当日剩余额度（额度是站点级，与用户无关）——供 orchestrator 的 POI 源闸门使用 */
export function geoBudgetRemaining(): Promise<number> {
  return env.mapProvider === 'tianditu' ? tiandituBudgetRemaining() : amapBudgetRemaining();
}

/**
 * POI 源解析（设置页自检与生成链路共用同一套 provider 判断，保证「看到的」就是「跑起来的」）。
 * 天地图是站点级单轨：没有个人凭据，revision 只随配置存在性变化。
 */
export async function resolvePoiSourceForUser(userId: string): Promise<ResolvedPoiSource> {
  if (env.mapProvider === 'tianditu') {
    return {
      source: resolveTiandituPoiSource(env.tiandituKey),
      credentialRevision: `tianditu:${env.tiandituKey ? 'site' : 'none'}`,
      credentialOrigin: env.tiandituKey ? 'site' : 'none',
    };
  }
  return resolveAmapPoiSourceForUser(userId);
}
