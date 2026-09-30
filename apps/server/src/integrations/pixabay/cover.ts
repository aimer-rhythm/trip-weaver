// Pixabay 搜索响应缓存24h；选中图片持久保存，禁止把搜索图片URL作为长期封面。
import { Value } from '@sinclair/typebox/value';
import { PoiPhotoSchema, type PoiPhoto } from '@tripweaver/shared';
import { readPhotoSelection, saveRemotePhoto, writePhotoSelection } from '../photoStore';
import {
  matchesStockPlace, object, photoKey, readStockCache, safePhotoUrl, stockPhotoBudget,
  stockPhotoScore, stockPhotoSearch, string, writeStockCache, type StockPhotoLookup, type StockPhotoQuery,
} from '../stockPhotoSupport';

function imageUrl(value: unknown): string | null {
  return safePhotoUrl(value, ['cdn.pixabay.com']) ?? safePhotoUrl(value, ['pixabay.com'], '/get/');
}
export function pickPixabayPhotos(value: unknown, query: StockPhotoQuery): PoiPhoto[] {
  if (!Array.isArray(value)) return [];
  const ranked = value.map(object).map(row => ({ row, text: `${string(row.tags)} ${string(row.pageURL)}` }))
    .filter(({ row, text }) => row.type === 'photo' && matchesStockPlace(text, query))
    .sort((a, b) => stockPhotoScore(b.row.imageWidth, b.row.imageHeight, b.text) - stockPhotoScore(a.row.imageWidth, a.row.imageHeight, a.text));
  const selected: PoiPhoto[] = [];
  for (const { row } of ranked) {
    const url = imageUrl(row.fullHDURL) ?? imageUrl(row.largeImageURL) ?? imageUrl(row.webformatURL);
    const sourceUrl = safePhotoUrl(row.pageURL, ['pixabay.com'], '/photos/'), photographer = string(row.user).trim();
    if (!url || !sourceUrl || sourceUrl.length > 1500 || !photographer || selected.some(photo => photo.url === url)) continue;
    selected.push({ url, attribution: { source: 'pixabay', photographer: photographer.slice(0, 300), sourceUrl,
      license: 'Pixabay Content License', licenseUrl: 'https://pixabay.com/service/license-summary/',
      changes: '已保存图源提供的尺寸版本，未另行裁切' } });
    if (selected.length === 6) break;
  }
  return selected;
}

// 同一查询的并发生成共享一次搜索/保存；成功缓存仍在磁盘，不依赖进程存活。
const pending = new Map<string, Promise<PoiPhoto[]>>();
export function createPixabayCoverLookup(apiKey: string, requestsLeft = 6, options: { dataRoot?: string } = {}): StockPhotoLookup {
  const budget = stockPhotoBudget('pixabay', requestsLeft);
  const cachedPhotosFor = (query: StockPhotoQuery) => readPhotoSelection(query.city, query.name, options.dataRoot, 'pixabay');
  const photosFor = async (query: StockPhotoQuery): Promise<PoiPhoto[]> => {
    const key = photoKey(query), pendingKey = JSON.stringify([options.dataRoot ?? '', key]);
    const existing = pending.get(pendingKey);
    if (existing) return existing;
    const task = (async () => {
      const saved = await cachedPhotosFor(query);
      if (saved !== null) return saved;
      if (!apiKey) return [];
      try {
        let cached = await readStockCache('pixabay-search', key, options.dataRoot);
        if (cached === undefined) {
          const params = new URLSearchParams({ key: apiKey, q: stockPhotoSearch(query), image_type: 'photo',
            orientation: 'horizontal', safesearch: 'true', per_page: '30' });
          const body = object(await budget.json(`https://pixabay.com/api/?${params}`));
          if (!Array.isArray(body.hits)) throw new Error('invalid photo results');
          cached = pickPixabayPhotos(body.hits, query);
          // 只存已校验候选（包括空结果），不保存带密钥的请求URL或任意响应字段。
          await writeStockCache('pixabay-search', key, cached, options.dataRoot);
        }
        const photos: PoiPhoto[] = [];
        for (const candidate of Array.isArray(cached) ? cached.slice(0, 6) : []) {
          // 临时下载链接可超过公共300字符限制；下载后公共URL是固定长度本地路径。
          const row = object(candidate);
          const source = imageUrl(row.url), validated = { ...row, url: '/media/pending' };
          if (!source || !Value.Check(PoiPhotoSchema, validated) || validated.attribution?.source !== 'pixabay' ||
            !safePhotoUrl(validated.attribution.sourceUrl, ['pixabay.com'], '/photos/')) continue;
          const photo = await saveRemotePhoto({ ...validated, url: source }, options.dataRoot);
          if (photo && !photos.some(other => other.url === photo.url)) photos.push(photo);
          if (photos.length === 3) break;
        }
        if (photos.length) await writePhotoSelection(query.city, query.name, photos, options.dataRoot, 'pixabay');
        return photos;
      } catch {
        console.warn('[pixabay-cover] 图源暂不可用，跳过本次选片');
        return [];
      }
    })().finally(() => pending.delete(pendingKey));
    pending.set(pendingKey, task);
    return task;
  };
  return { cachedPhotosFor, photosFor };
}
