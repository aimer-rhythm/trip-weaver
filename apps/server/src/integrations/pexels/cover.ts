// 景点封面第一来源（09-27）：Pexels 免费图库关键词搜索。
//
// 为什么排在库内封面与维基之前：库内图只覆盖 3 个城市（北京/广州/杭州），维基的
// upload.wikimedia.org 在国内被封锁 —— 两者合起来出不了几张图。
//
// 没有坐标可核对，所以用「alt / 照片页 slug 与地点名的归一键匹配」当闸门：
// 宁可这张卡片回落类目图标，也不要把某公园的通用湖景贴到具体景点上。
//
// 条款（API Guidelines）：每次 API 请求都要求展示指向 Pexels 的显眼链接（前端 PexelsCredit 组件），
// 限流 200 次/小时、20000 次/月。这里用进程内小时窗口自我约束，避免把限流打穿。
import { createSerialQueue } from '../../lib/serialQueue';
import { TtlCache } from '../../lib/ttlCache';
import { normalizePlaceKey } from '../../lib/placeKey';

const API = 'https://api.pexels.com/v1/search';
const TIMEOUT_MS = 8_000;
/** 串行间隔；Pexels 限流是小时级的，这里只是别把请求打成一阵 */
const MIN_INTERVAL_MS = 1_000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** 单次生成的真实请求上限（与维基各自计数） */
const MAX_PER_TASK = 8;
/** 小时窗口上限：官方 200/h，留 10% 余量。进程级、重启重置，不落库 */
const MAX_PER_HOUR = 180;
const PER_PAGE = 5;

const cache = new TtlCache<string | null>(CACHE_TTL_MS, 300);
const recentCalls: number[] = [];

export interface PexelsPhoto {
  alt?: unknown;
  url?: unknown;
  src?: Record<string, unknown>;
}

export interface PexelsCoverQuery {
  /** 地点名，如「故宫博物院」。只用它做查询词 —— 实测拼上城市反而稀释关键词 */
  name: string;
  /** 城市名，仅用于缓存键与日志 */
  city: string;
}

export interface PexelsCoverLookup {
  /** 返回 https 图片 URL；未命中、超限或失败都是 null */
  coverFor(query: PexelsCoverQuery): Promise<string | null>;
}

/** 照片页 URL → 可比较的要点串（`/photo/beijing-forbidden-city-12345/` → `beijing-forbidden-city`） */
function slugOf(url: string): string {
  const match = /\/(?:photo|photos)\/([^/?#]+)/.exec(url);
  return match?.[1]?.replace(/-\d+$/, '') ?? '';
}

function httpsOnly(value: unknown): string {
  return typeof value === 'string' && value.startsWith('https://') ? value : '';
}

/**
 * 在已取回的结果里挑封面：alt 或照片页 slug 与地点名的归一键有交集才算命中，返回该条目的图片直链。
 * 纯函数，方便单测不发请求。尺寸回落：medium（高约 350px，够 72px 卡片）→ large → original。
 */
export function pickCover(photos: readonly PexelsPhoto[], name: string): string | null {
  const wanted = normalizePlaceKey(name);
  if (wanted.length < 2) return null;
  for (const photo of photos) {
    const alt = typeof photo.alt === 'string' ? normalizePlaceKey(photo.alt) : '';
    const slug = slugOf(typeof photo.url === 'string' ? photo.url : '');
    const hit = (alt.length > 0 && alt.includes(wanted)) || (slug.length > 0 && slug.includes(wanted));
    if (!hit) continue;
    const src = photo.src ?? {};
    const image = httpsOnly(src.medium) || httpsOnly(src.large) || httpsOnly(src.original);
    if (image) return image;
  }
  return null;
}

/** 清掉一小时之前的记账。返回当前窗口是否还有余量 */
function hourWindowHasRoom(now: number): boolean {
  const cutoff = now - 60 * 60 * 1000;
  while (recentCalls.length > 0 && recentCalls[0]! < cutoff) recentCalls.shift();
  return recentCalls.length < MAX_PER_HOUR;
}

async function lookup(name: string, apiKey: string): Promise<string | null> {
  const params = new URLSearchParams({ query: name, locale: 'zh-CN', per_page: String(PER_PAGE) });
  const res = await fetch(`${API}?${params}`, {
    headers: { Authorization: apiKey, Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`pexels http ${res.status}`);
  const body = (await res.json()) as { photos?: PexelsPhoto[] };
  return pickCover(body.photos ?? [], name);
}

/**
 * 进程级缓存 + 队列；requestsLeft 由单次生成持有，跨任务不共享。
 * 未配置 apiKey 时退化为 Null 实现（不发请求、不影响既有链路）。
 * minIntervalMs 仅供测试缩短等待。
 */
export function createPexelsCoverLookup(
  apiKey: string,
  requestsLeft = MAX_PER_TASK,
  minIntervalMs = MIN_INTERVAL_MS,
): PexelsCoverLookup {
  const run = createSerialQueue(minIntervalMs);
  let remaining = requestsLeft;
  return {
    async coverFor(query) {
      if (!apiKey) return null;
      const cacheKey = `${query.city}|${query.name}`.trim().toLowerCase();
      const cached = cache.get(cacheKey);
      if (cached !== undefined) return cached;
      const now = Date.now();
      if (remaining <= 0 || !hourWindowHasRoom(now)) return null;
      remaining -= 1;
      recentCalls.push(now);
      try {
        const url = await run(() => lookup(query.name, apiKey));
        cache.set(cacheKey, url); // 含 null：确认没图的地点 24h 内不再打
        return url;
      } catch (err) {
        // 失败不进缓存：超时与限流都是瞬时的，下次生成应再试一次
        console.warn(`[pexels-cover] ${query.name} 检索失败：${err instanceof Error ? err.message : '未知错误'}`);
        return null;
      }
    },
  };
}
