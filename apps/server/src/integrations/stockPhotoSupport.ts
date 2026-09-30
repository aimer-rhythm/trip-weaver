// 新图库共享的有限请求、24h查询缓存和地名闸门；不持有API密钥。
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PoiPhoto } from '@tripweaver/shared';
import { normalizePlaceKey } from '../lib/placeKey';

export interface StockPhotoQuery { name: string; city: string }
export interface StockPhotoLookup {
  cachedPhotosFor(query: StockPhotoQuery): Promise<PoiPhoto[] | null>;
  photosFor(query: StockPhotoQuery): Promise<PoiPhoto[]>;
}
export const PHOTO_DATA = fileURLToPath(new URL('../../../../data/', import.meta.url));
export const DAY = 24 * 60 * 60 * 1000;
const MAX_JSON = 1024 * 1024;
type Namespace = 'unsplash-search' | 'unsplash-places' | 'pixabay-search';
export const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const string = (value: unknown): string => typeof value === 'string' ? value : '';
const normalize = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
export const photoKey = (query: StockPhotoQuery) => JSON.stringify([normalize(query.city), normalize(query.name)]);
function cacheFile(namespace: Namespace, key: string, root: string) {
  return path.join(root, 'photo-store', namespace, createHash('sha256').update(key).digest('hex') + '.json');
}
export async function readStockCache(namespace: Namespace, key: string, root = PHOTO_DATA, maxAge = DAY): Promise<unknown> {
  try {
    const raw = await readFile(cacheFile(namespace, key, root));
    if (raw.length > MAX_JSON) return undefined;
    const entry = object(JSON.parse(raw.toString('utf8')));
    if (entry.version === 1 && entry.key === key && typeof entry.savedAt === 'number' && entry.savedAt <= Date.now() && Date.now() - entry.savedAt < maxAge) return entry.data;
  } catch { /* 无缓存或损坏时仅重取对应查询，不暴露原始响应。 */ }
  return undefined;
}
export async function writeStockCache(namespace: Namespace, key: string, data: unknown, root = PHOTO_DATA) {
  const raw = JSON.stringify({ version: 1, key, savedAt: Date.now(), data });
  if (Buffer.byteLength(raw) > MAX_JSON) throw new Error('photo cache exceeds size limit');
  const file = cacheFile(namespace, key, root), temporary = `${file}.${randomUUID()}.tmp`;
  await mkdir(path.dirname(file), { recursive: true });
  try { await writeFile(temporary, raw, { flag: 'wx' }); await rename(temporary, file); }
  finally { await unlink(temporary).catch(() => {}); }
}

export function safePhotoUrl(value: unknown, hosts: readonly string[], prefix = '/'): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && hosts.includes(url.hostname) && !url.username && !url.password && !url.port && !url.hash && url.pathname.startsWith(prefix) ? value : null;
  } catch { return null; }
}

const gates = new Map<string, { calls: number[]; blockedUntil: number }>();
export function stockPhotoBudget(provider: 'unsplash' | 'pixabay', requestsLeft: number) {
  const interval = provider === 'unsplash' ? 3600000 : 60000;
  const maximum = provider === 'unsplash' ? 45 : 90;
  const state = gates.get(provider) ?? { calls: [], blockedUntil: 0 };
  gates.set(provider, state);
  let remaining = requestsLeft;
  return {
    async json(url: string, headers: Record<string, string> = {}): Promise<unknown> {
      const now = Date.now();
      state.calls = state.calls.filter(at => now - at < interval);
      if (remaining <= 0 || state.calls.length >= maximum || state.blockedUntil > now) throw new Error('photo request budget exhausted');
      remaining--; state.calls.push(now);
      try {
        const response = await fetch(url, { headers: { Accept: 'application/json', ...headers }, redirect: 'error', signal: AbortSignal.timeout(8000) });
        if (response.status === 429 || response.headers.get('x-ratelimit-remaining') === '0') {
          state.blockedUntil = now + interval;
        }
        if (response.status !== 200 || !/^application\/json(;|$)/i.test(response.headers.get('content-type') ?? '') || Number(response.headers.get('content-length')) > MAX_JSON) {
          await response.body?.cancel(); throw new Error('photo provider rejected request');
        }
        const reader = response.body?.getReader(); if (!reader) throw new Error('empty photo response');
        const chunks: Uint8Array[] = []; let size = 0;
        try {
          for (;;) {
            const next = await reader.read(); if (next.done) break;
            size += next.value.length; if (size > MAX_JSON) throw new Error('photo response exceeds size limit');
            chunks.push(next.value);
          }
        } finally { await reader.cancel(); }
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch { throw new Error('photo provider unavailable'); } // Pixabay密钥在URL里，不能转发底层错误。
    },
  };
}

// 只使用明确的同城译名；未知地点依然要求原名和城市同时出现在作品元数据中。
const cityAliases: Record<string, string[]> = { '北京': ['Beijing', 'Peking'], '杭州': ['Hangzhou'], '上海': ['Shanghai'], '广州': ['Guangzhou', 'Canton'], '成都': ['Chengdu'], '厦门': ['Xiamen'], '重庆': ['Chongqing'] };
const aliases: Record<string, Record<string, string[]>> = {
  '北京': { '故宫': ['Forbidden City', 'Palace Museum'], '景山': ['Jingshan'], '北海': ['Beihai Park'], '什刹海': ['Shichahai', 'Houhai'], '天坛': ['Temple of Heaven', 'Tiantan'], '颐和园': ['Summer Palace'], '圆明园': ['Old Summer Palace', 'Yuanmingyuan'], '雍和宫': ['Yonghe', 'Lama Temple'], '八达岭长城': ['Badaling'], '慕田峪长城': ['Mutianyu'], '中国国家': ['National Museum of China'] },
  '杭州': { '西湖': ['West Lake'], '西湖断桥': ['Broken Bridge'], '断桥残雪': ['Broken Bridge'], '苏堤': ['Su Causeway'], '雷峰塔': ['Leifeng Pagoda'], '三潭印月': ['Three Pools Mirroring the Moon'], '灵隐': ['Lingyin'], '飞来峰': ['Feilai'], '九溪烟树': ['Jiuxi', 'Nine Creeks'], '西溪湿地': ['Xixi Wetland'], '宝石山': ['Baoshi Hill'] },
};
function names(query: StockPhotoQuery) {
  const city = query.city.trim(), name = normalizePlaceKey(query.name.normalize('NFKC'));
  const canonical = city === '北京' && name === '国家' ? '中国国家' : city === '杭州' && name === '灵隐寺' ? '灵隐' : name;
  return { city: [city, ...(cityAliases[city] ?? [])], place: [query.name.trim(), ...(aliases[city]?.[canonical] ?? [name])] };
}
export function stockPhotoSearch(query: StockPhotoQuery): string {
  const terms = names(query);
  return `${terms.place[1] ?? terms.place[0]} ${terms.city[1] ?? terms.city[0]}`.slice(0, 100);
}
export function matchesStockPlace(text: string, query: StockPhotoQuery): boolean {
  const terms = names(query), haystack = normalize(text);
  const cityHit = terms.city.some(term => normalize(term).length >= 2 && haystack.includes(normalize(term)));
  const placeHit = terms.place.some(term => normalize(term).length >= 2 && haystack.includes(normalize(term)));
  if (normalizePlaceKey(query.name) === '颐和园' && /oldsummerpalace|yuanmingyuan|圆明园/.test(haystack)) return false;
  return cityHit && placeHit;
}
export function stockPhotoScore(width: unknown, height: unknown, text: string): number {
  return (typeof width === 'number' && typeof height === 'number' && width > height ? 2 : 0) + (/sunset|sunrise|dusk|twilight|mist|fog|golden hour|晨|暮|雾|夕|日落/i.test(text) ? 1 : 0);
}
