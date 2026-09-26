// 天地图地理编码适配层（09-25，MAP_PROVIDER=tianditu 时充当高德同位置的主链）
// 与高德同形：出 GeocodedPlace（GCJ-02）+ origin 如实标注；天地图不下发 adcode → 回空串。
// 坐标系：天地图用 CGCS2000（≈WGS-84），返回坐标入站时经 wgs84ToGcj02 转回 GCJ-02 ——
// 转换收敛在本文件内，上层（geoPipeline）拿到的永远是库内唯一坐标系 GCJ-02。
// 纪律沿用四道闸：与路径规划共用串行队列（350ms）+ 24h TTL 缓存；任务级上限与日额度由调用方把关。
// 任何故障不抛错到上层 —— 各级回 null，链路整体失败由上层标注 estimated 降级。
import { wgs84ToGcj02 } from '@tripweaver/shared';
import { createSerialQueue } from '../../lib/serialQueue';
import { TtlCache } from '../../lib/ttlCache';
import type { GeocodedPlace, GeocodedPoint, GeoPoint } from '../geoContracts';
import { geocodeFallbackGcj02 } from '../geocode';
import { describeHttpFailure } from './http';

const GEOCODER_URL = 'https://api.tianditu.gov.cn/geocoder';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** 天地图全 API 共用串行队列（350ms，与高德同姿态）：geocoder 与 drive/walk/bus 共队列限速 */
export const tiandituQueue = createSerialQueue(350);

const geocodeCache = new TtlCache<GeocodedPoint | null>(CACHE_TTL_MS, 300);

/** 天地图 geocoder 的成功状态是**字符串** "0"（写成 === 0 会永远判定失败，已踩坑） */
const SUCCESS_STATUS = '0';

/** 解析天地图「lon,lat」串（CGCS2000/WGS-84）→ WGS-84 点；非法输入回 null */
export function parseTiandituLonLat(raw: unknown): GeoPoint | null {
  const parts = (typeof raw === 'string' ? raw : '').split(',');
  if (parts.length !== 2) return null;
  const lng = Number.parseFloat(parts[0]!);
  const lat = Number.parseFloat(parts[1]!);
  return Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0) ? { lat, lng } : null;
}

/** 解析 geocoder 的 location 对象 {lon, lat}（字段名是 lon 不是 lng） */
function parseLocationObject(raw: unknown): GeoPoint | null {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const toNum = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' ? Number.parseFloat(v) : NaN);
  const lng = toNum(obj.lon);
  const lat = toNum(obj.lat);
  return Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0) ? { lat, lng } : null;
}

/**
 * 天地图正向地理编码（结构化地址 / 地名 → 坐标）；失败回 null。
 * 目的地城市名拼进 keyWord 做消歧（与高德 v3 geocode 的 `${city}${name}` 同策略）；
 * ds 必须是 JSON **字符串**而不是对象，参数名是 tk 而不是官方表格里写的 appkey。
 */
export async function tiandituGeocode(tk: string, name: string, city: string): Promise<GeocodedPoint | null> {
  const cacheKey = `${city}:${name}`.trim().toLowerCase();
  const cached = geocodeCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const point = await tiandituQueue(async () => {
    try {
      const params = new URLSearchParams({
        ds: JSON.stringify({ keyWord: `${city}${name}`.slice(0, 80) }),
        tk,
      });
      const res = await fetch(`${GEOCODER_URL}?${params}`, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw await describeHttpFailure(res);
      const body = (await res.json()) as Record<string, unknown>;
      if (body.status !== SUCCESS_STATUS) throw new Error(String(body.msg || '未知错误'));
      const wgs = parseLocationObject(body.location);
      if (!wgs) return null;
      // 天地图回 WGS-84/CGCS2000 → 落库前转 GCJ-02（库内唯一坐标系契约）
      return { ...wgs84ToGcj02(wgs.lat, wgs.lng), adcode: '' };
    } catch {
      return null;
    }
  });
  geocodeCache.set(cacheKey, point);
  return point;
}

/**
 * 活动坐标解析链（天地图 provider）：天地图 geocoder → Nominatim + wgs84ToGcj02 → null。
 * 与高德链同形，唯一差别是天地图只有一级 —— 其 geocoder 同时承担地名与结构化地址解析，
 * 不像高德那样需要「POI text 定位 + v3 geocode」两级。
 * @param tryAcquire 每次天地图调用尝试前询问（任务上限/日额度记账），拒绝则跳过该级
 */
export async function tiandituGeocodeActivity(
  tk: string | null,
  name: string,
  city: string,
  tryAcquire: () => boolean = () => true,
): Promise<GeocodedPlace | null> {
  if (tk && tryAcquire()) {
    const geo = await tiandituGeocode(tk, name, city);
    if (geo) return { ...geo, origin: 'tianditu' };
  }
  // Nominatim 兜底（WGS-84）→ 统一转 GCJ-02，与全链坐标系一致
  const fallback = await geocodeFallbackGcj02(name, city);
  return fallback ? { ...fallback, origin: 'nominatim' } : null;
}
