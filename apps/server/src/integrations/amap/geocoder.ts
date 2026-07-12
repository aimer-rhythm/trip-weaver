// 高德地理编码适配层（v0.5 地理数据层）：POI text 定位 + v3 geocode + Nominatim 兜底解析链
// 纪律沿用四道闸中的前两道：与路径规划共用串行队列（350ms）+ 24h TTL 缓存；
// 任务级上限与日额度闸门由调用方（generation/geoPipeline）通过 tryAcquire 回调把关。
// 任何故障不抛错到上层 —— 各级回 null，链路整体失败由上层标注 estimated 降级。
import { wgs84ToGcj02 } from '@tripweaver/shared';
import { createSerialQueue } from '../../lib/serialQueue';
import { TtlCache } from '../../lib/ttlCache';
import { geocode as nominatimGeocode } from '../geocode';

/** 解析高德「lng,lat」坐标串（GCJ-02）；非法输入回 null */
export function parseAmapLocation(raw: unknown): { lat: number; lng: number } | null {
  const parts = (typeof raw === 'string' ? raw : '').split(',');
  if (parts.length !== 2) return null;
  const lng = Number.parseFloat(parts[0]!);
  const lat = Number.parseFloat(parts[1]!);
  return Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0) ? { lat, lng } : null;
}

const AMAP_TEXT_URL = 'https://restapi.amap.com/v5/place/text';
const AMAP_GEOCODE_URL = 'https://restapi.amap.com/v3/geocode/geo';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** 高德全 API 共用串行队列（个人认证约 3 QPS）：geocode 与 route 共队列限速 */
export const amapQueue = createSerialQueue(350);

const poiLocateCache = new TtlCache<AmapGeoPoint | null>(CACHE_TTL_MS, 300);
const geocodeCache = new TtlCache<AmapGeoPoint | null>(CACHE_TTL_MS, 300);

export interface AmapGeoPoint {
  lat: number;       // GCJ-02
  lng: number;
  adcode: string;    // 行政区划码（transit 路径规划 city1/city2 入参；可能为空）
}

async function amapGet(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as Record<string, unknown>;
  if (body.status !== '1') throw new Error(String(body.info || '未知错误'));
  return body;
}

/** 高德 POI text 单点定位（名称 + 目的地消歧）→ GCJ-02 坐标 + adcode；失败回 null */
export async function amapPoiLocate(apiKey: string, name: string, city: string): Promise<AmapGeoPoint | null> {
  const cacheKey = `${city}:${name}`.trim().toLowerCase();
  const cached = poiLocateCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const point = await amapQueue(async () => {
    try {
      const params = new URLSearchParams({ key: apiKey, keywords: name.slice(0, 80), page_size: '1' });
      if (city) {
        params.set('region', city.slice(0, 40));
        params.set('city_limit', 'true');
      }
      const body = await amapGet(`${AMAP_TEXT_URL}?${params}`);
      const first = Array.isArray(body.pois) ? (body.pois[0] as Record<string, unknown> | undefined) : undefined;
      const location = first ? parseAmapLocation(first.location) : null;
      return location ? { ...location, adcode: typeof first!.adcode === 'string' ? first!.adcode : '' } : null;
    } catch {
      return null;
    }
  });
  poiLocateCache.set(cacheKey, point);
  return point;
}

/** 高德 v3 地理编码（结构化地址）→ GCJ-02 坐标 + adcode；失败回 null */
export async function amapGeocode(apiKey: string, name: string, city: string): Promise<AmapGeoPoint | null> {
  const cacheKey = `${city}:${name}`.trim().toLowerCase();
  const cached = geocodeCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const point = await amapQueue(async () => {
    try {
      const params = new URLSearchParams({ key: apiKey, address: `${city}${name}`.slice(0, 80) });
      if (city) params.set('city', city.slice(0, 40));
      const body = await amapGet(`${AMAP_GEOCODE_URL}?${params}`);
      const first = Array.isArray(body.geocodes) ? (body.geocodes[0] as Record<string, unknown> | undefined) : undefined;
      const location = first ? parseAmapLocation(first.location) : null;
      return location ? { ...location, adcode: typeof first!.adcode === 'string' ? first!.adcode : '' } : null;
    } catch {
      return null;
    }
  });
  geocodeCache.set(cacheKey, point);
  return point;
}

export type GeocodeOrigin = 'amap-poi' | 'amap-geocode' | 'nominatim';

export interface GeocodedPlace extends AmapGeoPoint {
  origin: GeocodeOrigin;   // 链路每级如实标注来源
}

/**
 * 活动坐标解析链：高德 POI text → 高德 v3 geocode → Nominatim + wgs84ToGcj02 → null。
 * @param tryAcquire 每次高德调用尝试前询问（任务上限/日额度记账），拒绝则跳过该级
 */
export async function geocodeActivity(
  apiKey: string | null,
  name: string,
  city: string,
  tryAcquire: () => boolean = () => true,
): Promise<GeocodedPlace | null> {
  if (apiKey && tryAcquire()) {
    const poi = await amapPoiLocate(apiKey, name, city);
    if (poi) return { ...poi, origin: 'amap-poi' };
  }
  if (apiKey && tryAcquire()) {
    const geo = await amapGeocode(apiKey, name, city);
    if (geo) return { ...geo, origin: 'amap-geocode' };
  }
  // Nominatim 兜底（WGS-84）→ 统一转 GCJ-02，与全链坐标系一致
  const wgs = (await nominatimGeocode(`${city} ${name}`)) ?? (await nominatimGeocode(name));
  if (wgs) return { ...wgs84ToGcj02(wgs.lat, wgs.lng), adcode: '', origin: 'nominatim' };
  return null;
}
