// Nominatim 地理编码：全局串行 + ≥1.1s 间隔 + 24h 缓存（Nominatim 使用政策要求 1 req/s）
// 失败/无结果一律回 null —— 编排 Agent 据此走 estimated 降级（R3）
import { createSerialQueue } from '../lib/serialQueue';
import { TtlCache } from '../lib/ttlCache';

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'tripweaver/0.1 (open-source trip planner; https://github.com/tripweaver)';

const queue = createSerialQueue(1100);
const cache = new TtlCache<{ lat: number; lng: number } | null>(24 * 60 * 60 * 1000, 500);

export interface GeoPoint {
  lat: number;
  lng: number;
}

/** 地名 → 坐标；query 建议为「目的地 地点名」拼接以消歧 */
export async function geocode(query: string): Promise<GeoPoint | null> {
  const key = query.trim().toLowerCase();
  if (!key) return null;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const point = await queue(async () => {
    try {
      const url = `${NOMINATIM_URL}?q=${encodeURIComponent(query)}&format=jsonv2&limit=1`;
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'zh,en' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return null;
      const rows = (await res.json()) as { lat?: string; lon?: string }[];
      const first = rows[0];
      if (!first?.lat || !first?.lon) return null;
      const lat = Number.parseFloat(first.lat);
      const lng = Number.parseFloat(first.lon);
      return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
    } catch {
      return null;
    }
  });

  cache.set(key, point);
  return point;
}
