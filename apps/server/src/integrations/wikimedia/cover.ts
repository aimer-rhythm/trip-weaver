// 景点封面降级（09-26）：知识库没有封面列，生成时按「地点名 + 城市」搜中文维基词条，
// 用条目坐标核对（≤2km）后取主图。命中只进本次候选的 coverUrl，不回写 canonical_places。
//
// 为什么不按坐标最近取图：实测故宫最近的是「体仁阁」，鸟巢最近的是冬奥会开幕式。
// 为什么不只按名字取第一条：实测「颐和园」第一条是同名电影，没有图。
// 失败一律返回 null，不抛到生成流程。
import { gcj02ToWgs84, haversineMeters } from '@tripweaver/shared';
import { createSerialQueue } from '../../lib/serialQueue';
import { TtlCache } from '../../lib/ttlCache';

const API = 'https://zh.wikipedia.org/w/api.php';
const USER_AGENT = 'Tripweaver/0.1 (open-source trip planner; https://github.com/aimer-rhythm/trip-weaver)';
const TIMEOUT_MS = 8_000;
/** 匿名访问礼貌间隔；远低于 Wikimedia 的约 200 req/s 上限 */
const MIN_INTERVAL_MS = 1_000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** 单次生成的真实请求上限；超出后停，避免一次行程打十几次 */
const MAX_PER_TASK = 8;
/** 词条坐标与地点坐标的最大距离。大景区（颐和园、八达岭）取点不同，500m 会误杀 */
const MAX_DISTANCE_M = 2_000;
const SEARCH_LIMIT = 3;

const cache = new TtlCache<string | null>(CACHE_TTL_MS, 300);

export interface CoverQuery {
  /** 地点名，如「故宫博物院」 */
  name: string;
  /** 城市名，拼进搜索词消歧，如「北京」 */
  city: string;
  /** GCJ-02。维基坐标是 WGS-84，内部转换后再比距离 */
  lat: number;
  lng: number;
}

interface WikiPage {
  title?: unknown;
  thumbnail?: { source?: unknown };
  coordinates?: { lat?: unknown; lon?: unknown }[];
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function pagesOf(body: unknown): WikiPage[] {
  const pages = (body as { query?: { pages?: Record<string, WikiPage> } }).query?.pages;
  if (!pages) return [];
  return Object.values(pages).filter((page) => page && typeof page === 'object');
}

async function getJson(params: URLSearchParams): Promise<unknown> {
  const res = await fetch(`${API}?${params}`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`wikipedia http ${res.status}`);
  return res.json();
}

/**
 * 在已取回的词条里挑封面：有主图、有坐标、离地点 ≤2km，取最近的一个。
 * 纯函数，方便单测不发请求。
 */
export function pickCover(
  pages: readonly { title: string; lat: number | null; lng: number | null; thumb: string | null }[],
  here: { lat: number; lng: number },
): string | null {
  let best: { thumb: string; distance: number } | null = null;
  for (const page of pages) {
    if (!page.thumb || page.lat === null || page.lng === null) continue;
    if (!page.thumb.startsWith('https://')) continue;
    const distance = haversineMeters(here, { lat: page.lat, lng: page.lng });
    if (distance > MAX_DISTANCE_M) continue;
    if (!best || distance < best.distance) best = { thumb: page.thumb, distance };
  }
  return best?.thumb ?? null;
}

async function lookup(query: CoverQuery): Promise<string | null> {
  const search = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: `${query.name} ${query.city}`.trim(),
    srlimit: String(SEARCH_LIMIT),
    srnamespace: '0',
    format: 'json',
  });
  const found = (await getJson(search)) as { query?: { search?: { title?: unknown }[] } };
  const titles = (found.query?.search ?? []).map((item) => str(item.title)).filter(Boolean);
  if (!titles.length) return null;

  const info = new URLSearchParams({
    action: 'query',
    titles: titles.join('|'),
    prop: 'pageimages|coordinates',
    piprop: 'thumbnail',
    pithumbsize: '400',
    colimit: '1',
    format: 'json',
  });
  const pages = pagesOf(await getJson(info)).map((page) => {
    const coord = page.coordinates?.[0];
    const lat = typeof coord?.lat === 'number' ? coord.lat : null;
    const lng = typeof coord?.lon === 'number' ? coord.lon : null;
    return { title: str(page.title), lat, lng, thumb: str(page.thumbnail?.source) || null };
  });
  return pickCover(pages, gcj02ToWgs84(query.lat, query.lng));
}

export interface CoverLookup {
  /** 返回主图 https URL；无命中、超限或失败都是 null */
  coverFor(query: CoverQuery): Promise<string | null>;
}

/** 进程级缓存 + 队列；requestsLeft 由单次生成持有，跨任务不共享。minIntervalMs 仅供测试缩短等待。 */
export function createWikiCoverLookup(requestsLeft = MAX_PER_TASK, minIntervalMs = MIN_INTERVAL_MS): CoverLookup {
  const run = createSerialQueue(minIntervalMs);
  let remaining = requestsLeft;
  return {
    async coverFor(query) {
      const key = `${query.city}|${query.name}`.trim().toLowerCase();
      const cached = cache.get(key);
      if (cached !== undefined) return cached;
      if (remaining <= 0) return null;
      remaining -= 1;
      try {
        const url = await run(() => lookup(query));
        cache.set(key, url);   // 含 null：没图的地点 24h 内不再打
        return url;
      } catch (err) {
        // 失败不进缓存：超时是瞬时的，下次生成应再试一次
        console.warn(`[wiki-cover] ${query.name} 检索失败：${err instanceof Error ? err.message : '未知错误'}`);
        return null;
      }
    },
  };
}
