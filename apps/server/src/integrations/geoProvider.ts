// 地图服务商门面（09-25 二次调整）：两家**互补**，各自承担不同能力 —— 不再是站点级单轨切换。
//   · 路线规划 + 地理编码 → **高德优先**（有凭据就用），缺失时降级天地图，两者都缺才 Null
//   · POI 搜索           → **固定天地图**（与 Key 自动决策无关：高德 v5/place/text 与地理编码主路径
//                          共用同一份个人配额，实测会被打满 —— 这是配额分工，不是可用性降级）
// 两条链分别解析、各自独立计数，互不回退。坐标系契约不变：门面进出的坐标**一律 GCJ-02**，
// WGS-84 ↔ GCJ-02 的转换收敛在各适配器内部，上层（geoPipeline / orchestrator）感知不到 provider 差异。
import { env, type MapProvider } from '../env';
import { resolveAmapCredential } from '../services/settingsService';
import { amapBudgetRemaining, tiandituBudgetRemaining } from '../services/quotaService';
import { geocodeFallbackGcj02 } from './geocode';
import { geocodeActivity as amapGeocodeActivity } from './amap/geocoder';
import { createAmapRouteBreaker } from './amap/route';
import { tiandituGeocodeActivity } from './tianditu/geo';
import { createTiandituRouteBreaker } from './tianditu/route';
import { resolveTiandituPoiSource } from './tianditu/poiSource';
import { getNullPoiSource } from './nullPoiSource';
import { createRouteBreaker } from './routeBreaker';
import type { GeocodedPlace, PoiSource, RouteBreaker } from './geoContracts';

/** 路线规划 + 地理编码的服务商实例（POI 源不在其中，见 resolvePoiSourceForUser） */
export interface GeoProvider {
  readonly cacheIdentity?: string; // Credential revision only, never key material.
  readonly kind: MapProvider | 'null';
  /** 是否绑定了可用的真实凭据。false 时上层整条 provider 链路跳过，只留 Nominatim → 启发式两级。 */
  readonly enabled: boolean;
  /** 活动坐标解析链（provider 级 → Nominatim → null）；@param tryAcquire 任务级额度记账回调 */
  geocodeActivity(name: string, city: string, tryAcquire: () => boolean): Promise<GeocodedPlace | null>;
  /** 每个生成任务建一个实例：熔断状态随任务生灭；凭据绑定在实例内 */
  createRouteBreaker(): RouteBreaker;
  /** 该服务商的当日剩余额度（供任务级预留量闸门；Null provider 恒为 0） */
  budgetRemaining(): Promise<number>;
}

/** 无凭据可用的降级 provider：provider 级整级跳过，保留 Nominatim → 启发式（与存量行为一致） */
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
    budgetRemaining: async () => 0,
  };
}

function createAmapProvider(apiKey: string): GeoProvider {
  return {
    kind: 'amap',
    enabled: true,
    geocodeActivity: (name, city, tryAcquire) => amapGeocodeActivity(apiKey, name, city, tryAcquire),
    createRouteBreaker: () => createAmapRouteBreaker(apiKey),
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
    budgetRemaining: tiandituBudgetRemaining,
  };
}

/**
 * 路线规划 + 地理编码：**高德优先**（个人 Key → 站点 Key），缺失时降级天地图，两者都缺才 Null。
 * 与旧版 MAP_PROVIDER 单轨的区别：这里不再有「选了天地图就不碰高德」的排他语义 ——
 * 高德在这个能力域是主用方，缺 Key 才让位。
 * 日额度闸门不在这里：需要按任务级预留量判断，由调用方（geoPipeline）叠加。
 */
export async function resolveGeoProvider(userId: string): Promise<GeoProvider> {
  const credential = await resolveAmapCredential(userId);
  if (credential) return { ...createAmapProvider(credential.apiKey), cacheIdentity: credential.revision };
  if (env.tiandituKey) return createTiandituProvider(env.tiandituKey);
  return createNullGeoProvider();
}

export interface ResolvedPoiSource {
  source: PoiSource;
  credentialRevision: string;
  credentialOrigin: 'personal' | 'site' | 'none';
}

/**
 * POI 源解析（设置页自检与生成链路共用，保证「看到的」就是「跑起来的」）。
 * **固定天地图，与 Key 自动决策无关**：高德搜索与地理编码共用 `v5/place/text` 配额，
 * 回落高德会把刚腾给地理编码的配额重新挤掉。
 * 天地图是站点级单轨凭据（没有个人 Key），不可用时返回 Null 源 → 空结果 + 模型知识。
 */
export function resolvePoiSourceForUser(): ResolvedPoiSource {
  return {
    source: resolveTiandituPoiSource(env.tiandituKey),
    credentialRevision: `tianditu:${env.tiandituKey ? 'site' : 'none'}`,
    credentialOrigin: env.tiandituKey ? 'site' : 'none',
  };
}

/**
 * POI 源的当日剩余额度（固定天地图）—— 供 orchestrator 的 POI 源闸门使用。
 * 与 `provider.budgetRemaining()`（路线/地理编码那条链）**必须分开**：两家额度独立核算，
 * 共用一处判断会让「天地图搜索额度耗尽」误伤高德的路线规划。
 */
export function poiBudgetRemaining(): Promise<number> {
  return tiandituBudgetRemaining();
}
