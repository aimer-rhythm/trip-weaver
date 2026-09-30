// 景点封面降级（09-26）：知识库没有封面列，生成时按「地点名 + 城市」搜中文维基词条，
// 用条目坐标核对（≤2km）后取主图。入选图和地点选择持久保存，不回写 canonical_places。
//
// 为什么不按坐标最近取图：实测故宫最近的是「体仁阁」，鸟巢最近的是冬奥会开幕式。
// 为什么不只按名字取第一条：实测「颐和园」第一条是同名电影，没有图。
// 失败一律返回 null，不抛到生成流程。
import { gcj02ToWgs84, haversineMeters, type PoiPhoto } from '@tripweaver/shared';
import { createSerialQueue } from '../../lib/serialQueue';
import { TtlCache } from '../../lib/ttlCache';
import { normalizePlaceKey } from '../../lib/placeKey';
import { cacheWikiImage, downloadWikiImage } from './imageCache';
import { readPhotoSelection, writePhotoSelection } from '../photoStore';

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
  pageprops?: { wikibase_item?: unknown };
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
  identity?: { name: string; city: string },
): string | null {
  if (!Number.isFinite(here.lat) || !Number.isFinite(here.lng)) return null;
  let best: { thumb: string; distance: number } | null = null;
  for (const page of pages) {
    if (identity && !wikiTitleMatches(page.title, identity.name, identity.city)) continue;
    if (!page.thumb || page.lat === null || page.lng === null || !Number.isFinite(page.lat) || !Number.isFinite(page.lng)) continue;
    if (!page.thumb.startsWith('https://')) continue;
    const distance = haversineMeters(here, { lat: page.lat, lng: page.lng });
    if (distance > MAX_DISTANCE_M) continue;
    if (!best || distance < best.distance) best = { thumb: page.thumb, distance };
  }
  return best?.thumb ?? null;
}

/** 距离只能消歧，不能把西湖词条主图当成断桥或苏堤的照片。 */
export function wikiTitleMatches(title: string, name: string, city: string): boolean {
  const key = (value: string) => {
    let text = value.normalize('NFKC').trim();
    if (text.endsWith(`(${city})`)) text = text.slice(0, -(city.length + 2)).trim();
    if (city && text.startsWith(city) && text.length > city.length + 1) text = text.slice(city.length);
    return normalizePlaceKey(text).toLowerCase();
  };
  return Boolean(name.trim()) && key(title) === key(name);
}

export async function verifyWikiImage(url: string): Promise<boolean> {
  return (await downloadWikiImage(url)) !== null;
}

async function lookup(query: CoverQuery, deliver: typeof cacheWikiImage): Promise<string | null> {
  // 搜索索引会漏掉同名词条。先直接查询原名与城市消歧名，身份和距离闸门不变。
  const direct = await lookupTitles([query.name, `${query.name} (${query.city})`], query);
  if (direct) return deliver(direct);
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

  const selected = await lookupTitles(titles, query);
  return selected ? deliver(selected) : null;
}

async function lookupTitles(titles: string[], query: CoverQuery): Promise<string | null> {
  const info = new URLSearchParams({
    action: 'query',
    titles: titles.join('|'),
    prop: 'pageimages|coordinates|pageprops',
    redirects: '1',
    piprop: 'thumbnail',
    pithumbsize: '400',
    colimit: '1',
    format: 'json',
  });
  const raw = pagesOf(await getJson(info)).filter(page => wikiTitleMatches(str(page.title), query.name, query.city));
  // 词条常未挂坐标模板，但同一 Wikidata 实体已有地球坐标；不借关联实体或城市坐标。
  const ids = [...new Set(raw.filter(p => !p.coordinates?.length).map(p => str(p.pageprops?.wikibase_item)).filter(id => /^Q\d+$/.test(id)))];
  let entities: Record<string, { claims?: { P625?: { rank?: string; mainsnak?: { datavalue?: { value?: { latitude?: number; longitude?: number; globe?: string; precision?: number } } } }[] } }> = {};
  if (ids.length) {
    const params = new URLSearchParams({ action: 'wbgetentities', ids: ids.join('|'), props: 'claims', format: 'json' });
    const response = await fetch(`https://www.wikidata.org/w/api.php?${params}`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`wikidata http ${response.status}`);
    entities = ((await response.json()) as { entities?: typeof entities }).entities ?? {};
  }
  const pages = raw.map((page) => {
    const coord = page.coordinates?.[0];
    const claims = entities[str(page.pageprops?.wikibase_item)]?.claims?.P625 ?? [];
    const earth = claims.filter(c => c.rank !== 'deprecated').map(c => c.mainsnak?.datavalue?.value)
      .filter(c => c && c.globe === 'http://www.wikidata.org/entity/Q2' &&
        Number.isFinite(c.latitude) && Number.isFinite(c.longitude) && Math.abs(c.latitude!) <= 90 && Math.abs(c.longitude!) <= 180 &&
        typeof c.precision === 'number' && c.precision <= 0.005);
    const fallback = earth.length === 1 ? earth[0] : undefined;
    const lat = typeof coord?.lat === 'number' ? coord.lat : fallback?.latitude ?? null;
    const lng = typeof coord?.lon === 'number' ? coord.lon : fallback?.longitude ?? null;
    return { title: str(page.title), lat, lng, thumb: str(page.thumbnail?.source) || null };
  });
  return pickCover(pages, gcj02ToWgs84(query.lat, query.lng), query);
}

export interface CoverLookup {
  /** 只读本地选择；null 表示未选过，空数组表示已选文件不可用。 */
  cachedPhotosFor?(query: CoverQuery): Promise<PoiPhoto[] | null>;
  /** 返回已缓存主图的同源 /media URL；无命中、超限或失败都是 null */
  coverFor(query: CoverQuery): Promise<string | null>;
}

/** 进程级缓存 + 队列；requestsLeft 由单次生成持有，跨任务不共享。minIntervalMs 仅供测试缩短等待。 */
export function createWikiCoverLookup(requestsLeft = MAX_PER_TASK, minIntervalMs = MIN_INTERVAL_MS, deliver = cacheWikiImage, options: { dataRoot?: string } = {}): CoverLookup {
  const run = createSerialQueue(minIntervalMs);
  let remaining = requestsLeft;
  const cachedPhotosFor = (query: CoverQuery) => readPhotoSelection(
    query.city, JSON.stringify([query.name, query.lat, query.lng]), options.dataRoot, 'wikimedia',
  );
  return {
    cachedPhotosFor,
    async coverFor(query) {
      // 坐标也是身份校验的一部分，不能给同名但不同坐标的地点复用旧结论。
      const identity = JSON.stringify([query.name, query.lat, query.lng]);
      const key = JSON.stringify([options.dataRoot ?? '', query.city, identity]);
      const saved = await cachedPhotosFor(query);
      if (saved !== null) return saved[0]?.url ?? null;
      const cached = cache.get(key);
      if (cached !== undefined) return cached;
      if (remaining <= 0) return null;
      remaining -= 1;
      try {
        const url = await run(() => lookup(query, deliver));
        if (url && /^\/media\/wikimedia\/[a-f0-9]{64}\.(jpg|png|webp|gif)$/.test(url)) {
          await writePhotoSelection(query.city, identity, [{ url }], options.dataRoot, 'wikimedia');
        }
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
