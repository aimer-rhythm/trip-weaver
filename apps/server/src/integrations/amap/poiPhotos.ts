// 高德 POI 图片（09-27）：封面链路的第三级，排在上游图库与 Pexels 之后。
//
// 为什么需要它：上游图库只在 3 个城市有货，Pexels 的文本闸门实测只有一半命中，
// 而高德 POI 自带的 photos 是唯一「国内可访问 + 能精确对应景点」的来源
// （实测「西湖」→「杭州西湖风景名胜区」+ 3 张 store.is.autonavi.com 图片，无 Referer 校验，可直接热链）。
//
// 配额纪律（关键）：`v5/place/text` 属高德「基础搜索服务」，个人认证仅 **5,000/月**
// （对比 `v3/geocode/geo` 的「基础LBS服务」150,000/月 —— 见 geocoder.ts 的降级顺序注释）。
// 因此这里三重限流：只在前两级都没图时才被调用（外层顺序保证）、单次生成 ≤8 次、进程内 24h 窗口 ≤100 次。
// 真实调用数通过 `calls` 暴露，由 orchestrator 计入 amapCalls 日额度。
import { TtlCache } from '../../lib/ttlCache';
import { normalizePlaceKey } from '../../lib/placeKey';
import { amapQueue } from './geocoder';

const AMAP_TEXT_URL = 'https://restapi.amap.com/v5/place/text';
const TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** 单次生成的真实调用上限 */
const MAX_PER_TASK = 8;
/** 进程内 24h 滚动窗口；5,000/月 ≈ 166/天，留足余量给地理编码那条链 */
const MAX_PER_DAY = 100;

const cache = new TtlCache<string | null>(CACHE_TTL_MS, 300);
const recentCalls: number[] = [];

export interface AmapPoiRecord {
  name?: unknown;
  photos?: unknown;
}

export interface AmapPoiPhotoQuery {
  /** 地点名，作为 keywords */
  name: string;
  /** 城市名，作为 region 消歧 */
  city: string;
}

export interface AmapPoiPhotoLookup {
  /** 返回 https 图片 URL；未命中、超限或失败都是 null */
  coverFor(query: AmapPoiPhotoQuery): Promise<string | null>;
  /** 已发生的真实 place/text 调用数（orchestrator 计入 amapCalls） */
  readonly calls: number;
}

/** 高德图片 URL 有时是 http（实测混用）→ 统一 https，否则 https 页面会被 mixed content 拦掉 */
function httpsOf(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const url = raw.trim();
  if (url.startsWith('https://')) return url;
  if (url.startsWith('http://')) return `https://${url.slice(7)}`;
  return '';
}

/**
 * 在已取回的 POI 里挑首图：归一键相同或以地点名结尾的 POI 才算命中
 * （高德 name 是权威地名，带「风景名胜区」等后缀 → 归一后「杭州西湖」以「西湖」结尾）。
 * 纯函数，方便单测不发请求。`photos[0]` 取不到就换下一个候选 POI。
 */
export function pickPhoto(pois: readonly AmapPoiRecord[], name: string): string | null {
  const wanted = normalizePlaceKey(name);
  if (wanted.length < 2) return null;
  for (const poi of pois) {
    const poiName = typeof poi.name === 'string' ? normalizePlaceKey(poi.name) : '';
    // endsWith 而不是 includes：避免「西湖区××」被当成「西湖」
    if (poiName !== wanted && !poiName.endsWith(wanted)) continue;
    const photos = Array.isArray(poi.photos) ? poi.photos : [];
    for (const photo of photos) {
      const url = httpsOf((photo as { url?: unknown } | null)?.url);
      if (url) return url;
    }
  }
  return null;
}

/** 清掉 24h 之前的记账；返回当日窗口是否还有余量 */
function dayWindowHasRoom(now: number): boolean {
  const cutoff = now - 24 * 60 * 60 * 1000;
  while (recentCalls.length > 0 && recentCalls[0]! < cutoff) recentCalls.shift();
  return recentCalls.length < MAX_PER_DAY;
}

interface LookupOutcome {
  ok: boolean;
  url: string | null;
}

/**
 * 进程级缓存 + 共享高德串行队列（与 geocode/route 同一队列，避免把个人 3 QPS 打满）。
 * 未配置 apiKey → Null 行为。requestsLeft 由单次生成持有，跨任务不共享。
 */
export function createAmapPoiPhotoLookup(apiKey: string, requestsLeft = MAX_PER_TASK): AmapPoiPhotoLookup {
  let remaining = requestsLeft;
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async coverFor(query) {
      if (!apiKey) return null;
      const cacheKey = `${query.city}|${query.name}`.trim().toLowerCase();
      const cached = cache.get(cacheKey);
      if (cached !== undefined) return cached;
      const now = Date.now();
      if (remaining <= 0 || !dayWindowHasRoom(now)) return null;
      remaining -= 1;
      calls += 1;
      recentCalls.push(now);
      const outcome = await amapQueue<LookupOutcome>(async () => {
        try {
          const params = new URLSearchParams({
            key: apiKey,
            keywords: query.name.slice(0, 80),
            show_fields: 'photos',
            page_size: '3',
          });
          if (query.city) {
            params.set('region', query.city.slice(0, 40));
            params.set('city_limit', 'true');
          }
          const res = await fetch(`${AMAP_TEXT_URL}?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const body = (await res.json()) as { status?: unknown; info?: unknown; pois?: unknown };
          if (body.status !== '1') throw new Error(String(body.info || '未知错误'));
          const pois = Array.isArray(body.pois) ? (body.pois as AmapPoiRecord[]) : [];
          return { ok: true, url: pickPhoto(pois, query.name) };
        } catch (err) {
          console.warn(`[amap-photo] ${query.name} 查询失败：${err instanceof Error ? err.message : '未知错误'}`);
          return { ok: false, url: null };
        }
      });
      if (outcome.ok) cache.set(cacheKey, outcome.url); // 含 null：确认无图的地点 24h 内不再打
      return outcome.url;
    },
  };
}
