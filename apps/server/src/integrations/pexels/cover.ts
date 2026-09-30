// 景点摄影补充：精选和本地图未命中时搜索 Pexels；入选照片持久保存并优先复用。
//
// 没有坐标可核对，所以用「alt / 照片页 slug 与地点名的归一键匹配」当闸门：
// 宁可这张卡片回落类目图标，也不要把某公园的通用湖景贴到具体景点上。
//
// 条款（API Guidelines）：每次 API 请求都要求展示指向 Pexels 的显眼链接（前端 PexelsCredit 组件），
// 限流 200 次/小时、20000 次/月。这里用进程内小时窗口自我约束，避免把限流打穿。
import { createSerialQueue } from '../../lib/serialQueue';
import { TtlCache } from '../../lib/ttlCache';
import { normalizePlaceKey } from '../../lib/placeKey';
import type { PoiPhoto } from '@tripweaver/shared';
import { readPhotoSelection, saveRemotePhoto, writePhotoSelection } from '../photoStore';

const API = 'https://api.pexels.com/v1/search';
const TIMEOUT_MS = 8_000;
/** 串行间隔；Pexels 限流是小时级的，这里只是别把请求打成一阵 */
const MIN_INTERVAL_MS = 1_000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** 单次生成的真实请求上限（与维基各自计数） */
const MAX_PER_TASK = 8;
/** 小时窗口上限：官方 200/h，留 10% 余量。进程级、重启重置，不落库 */
const MAX_PER_HOUR = 180;
/** 候选池大小：闸门是文本匹配，池子越大越容易碰到带地名的 alt（实测 5 条时不少命中项排在后面） */
const PER_PAGE = 15;

const cache = new TtlCache<PoiPhoto[]>(CACHE_TTL_MS, 300);
const recentCalls: number[] = [];

export interface PexelsPhoto {
  alt?: unknown;
  url?: unknown;
  src?: Record<string, unknown>;
  photographer?: unknown;
  width?: unknown;
  height?: unknown;
}

export interface PexelsCoverQuery {
  /** 地点名，如「故宫博物院」。只用它做查询词 —— 实测拼上城市反而稀释关键词 */
  name: string;
  /** 城市名，仅用于缓存键与日志 */
  city: string;
}

export interface PexelsCoverLookup {
  /** 只读本地选择；null 表示未选过，空数组表示已选文件不可用。 */
  cachedPhotosFor?(query: PexelsCoverQuery): Promise<PoiPhoto[] | null>;
  /** 入选图片持久保存后返回本地 URL；未命中、超限或失败都是 null。 */
  coverFor(query: PexelsCoverQuery): Promise<string | null>;
  photosFor?(query: PexelsCoverQuery): Promise<PoiPhoto[]>;
}

/** 照片页 URL → 可比较的要点串（`/photo/beijing-forbidden-city-12345/` → `beijing-forbidden-city`） */
function slugOf(url: string): string {
  const match = /\/(?:photo|photos)\/([^/?#]+)/.exec(url);
  return match?.[1]?.replace(/-\d+$/, '') ?? '';
}

/**
 * Pexels 的 alt 是摄影师写的描述，经常只写景类不写专名（「秋日的树木倒映在湿地池塘上」）。
 * 所以除完整地名外，也允许「去掉这层通用尾缀后的核心词」（≥2 字）命中 ——
 * 「龙井村」→「龙井」能对上 alt「杭州龙井茶园」，而「虎跑公园」→「虎跑」不会因为 alt 里
 * 有个泛化的「公园」就蒙中。核心词不剥到少于 2 字。
 */
const GENERIC_SUFFIXES = ['公园', '景区', '村', '寺', '塔', '街', '路', '庙', '宫', '馆', '山', '湖', '园'] as const;

function coreKey(key: string): string {
  for (const suffix of GENERIC_SUFFIXES) {
    if (key.length - suffix.length >= 2 && key.endsWith(suffix)) return key.slice(0, -suffix.length);
  }
  return key;
}

function httpsOnly(value: unknown): string {
  return typeof value === 'string' && value.startsWith('https://') ? value : '';
}

/**
 * 在已取回的结果里挑封面：alt 或照片页 slug 与地点名的归一键有交集才算命中，返回该条目的图片直链。
 * 保留单封面兼容入口；照片组由 pickPhotos 优先选择适合放大查看的尺寸。
 */
export function pickCover(photos: readonly PexelsPhoto[], name: string): string | null {
  const wanted = normalizePlaceKey(name);
  if (wanted.length < 2) return null;
  const core = coreKey(wanted);
  // 先完整地名，再核心词；两者相同时不重复扫
  const keys = core === wanted ? [wanted] : [wanted, core];
  for (const photo of photos) {
    const alt = typeof photo.alt === 'string' ? normalizePlaceKey(photo.alt) : '';
    const slug = slugOf(typeof photo.url === 'string' ? photo.url : '');
    const hit = keys.some(
      (key) => (alt.length > 0 && alt.includes(key)) || (slug.length > 0 && slug.includes(key)),
    );
    if (!hit) continue;
    const src = photo.src ?? {};
    const image = httpsOnly(src.medium) || httpsOnly(src.large2x) || httpsOnly(src.large) || httpsOnly(src.original);
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

export function pickPhotos(photos: readonly PexelsPhoto[], name: string): PoiPhoto[] {
  const ranked = photos.filter(photo => pickCover([photo], name)).map(photo => {
    const landscape = typeof photo.width === 'number' && typeof photo.height === 'number' && photo.width > photo.height;
    const atmosphere = typeof photo.alt === 'string' && /sunset|sunrise|dusk|mist|fog|twilight|golden hour|晨|雾|夕|暮|日落/i.test(photo.alt);
    return { photo, score: (landscape ? 2 : 0) + (atmosphere ? 1 : 0) };
  }).sort((a, b) => b.score - a.score);
  const selected: PoiPhoto[] = [];
  for (const { photo } of ranked) {
    if (typeof photo.photographer !== 'string' || !photo.photographer.trim() || typeof photo.url !== 'string') continue;
    let page: URL;
    try { page = new URL(photo.url); } catch { continue; }
    if (page.protocol !== 'https:' || page.hostname !== 'www.pexels.com' || page.username || page.password || page.port || !page.pathname.startsWith('/photo/')) continue;
    const src = photo.src ?? {};
    const url = httpsOnly(src.large2x) || httpsOnly(src.large) || httpsOnly(src.original) || httpsOnly(src.medium);
    if (!url || selected.some(p => p.url === url)) continue;
    selected.push({ url, attribution: { source: 'pexels', photographer: photo.photographer.trim().slice(0, 300), sourceUrl: page.href,
      license: 'Pexels License', licenseUrl: 'https://www.pexels.com/license/', changes: '已保存图源提供的尺寸版本，未另行裁切' } });
    if (selected.length === 6) break; // 下载失败可以补位，但最终图库最多3张。
  }
  return selected;
}

async function lookup(name: string, apiKey: string): Promise<PoiPhoto[]> {
  const params = new URLSearchParams({ query: name, locale: 'zh-CN', per_page: String(PER_PAGE) });
  const res = await fetch(`${API}?${params}`, {
    headers: { Authorization: apiKey, Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`pexels http ${res.status}`);
  const body: unknown = await res.json();
  if (!body || typeof body !== 'object' || !('photos' in body) || !Array.isArray(body.photos)) throw new Error('invalid pexels response');
  const photos = body.photos.filter((photo): photo is PexelsPhoto => !!photo && typeof photo === 'object' &&
    (!('src' in photo) || (!!photo.src && typeof photo.src === 'object' && !Array.isArray(photo.src))));
  return pickPhotos(photos, name);
}

/**
 * 持久选择优先，另有进程级负缓存 + 队列；requestsLeft 由单次生成持有。
 * 未配置 apiKey 时仍可读已存照片，仅新搜索退化为 Null 实现。
 * minIntervalMs 仅供测试缩短等待。
 */
export function createPexelsCoverLookup(
  apiKey: string,
  requestsLeft = MAX_PER_TASK,
  minIntervalMs = MIN_INTERVAL_MS,
  options: { dataRoot?: string } = {},
): PexelsCoverLookup {
  const run = createSerialQueue(minIntervalMs);
  let remaining = requestsLeft;
  const pending = new Map<string, Promise<PoiPhoto[]>>();
  const cachedPhotosFor = (query: PexelsCoverQuery) => readPhotoSelection(query.city, query.name, options.dataRoot);
  const photosFor = async (query: PexelsCoverQuery): Promise<PoiPhoto[]> => {
    const cacheKey = JSON.stringify([options.dataRoot ?? '', query.city.trim().toLowerCase(), query.name.trim().toLowerCase()]);
    let task = pending.get(cacheKey);
    if (!task) {
      task = (async () => {
        const saved = await cachedPhotosFor(query);
        if (saved !== null) return saved;
        if (!apiKey) return [];
        const cached = cache.get(cacheKey);
        if (cached !== undefined) return cached;
        const now = Date.now();
        if (remaining <= 0 || !hourWindowHasRoom(now)) return [];
        remaining -= 1;
        recentCalls.push(now);
        try {
          const candidates = await run(() => lookup(query.name, apiKey));
          const photos: PoiPhoto[] = [];
          for (const candidate of candidates) {
            const photo = await saveRemotePhoto(candidate, options.dataRoot);
            if (photo && !photos.some(p => p.url === photo.url)) photos.push(photo);
            if (photos.length === 3) break;
          }
          if (photos.length) await writePhotoSelection(query.city, query.name, photos, options.dataRoot);
          // 确认没有候选才负缓存；图片下载失败不固化为空。
          if (photos.length || !candidates.length) cache.set(cacheKey, photos);
          return photos;
        } catch (err) {
          // 失败不进缓存：超时与限流都是瞬时的，下次生成应再试一次
          console.warn(`[pexels-cover] ${query.name} 检索失败：${err instanceof Error ? err.message : '未知错误'}`);
          return [];
        }
      })().finally(() => pending.delete(cacheKey));
      pending.set(cacheKey, task);
    }
    return task;
  };
  return { cachedPhotosFor, photosFor, coverFor: async query => (await photosFor(query))[0]?.url ?? null };
}
