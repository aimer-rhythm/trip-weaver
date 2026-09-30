// Unsplash API 选片只持久化元数据；图片必须沿用官方 hotlink，选用必须上报 download_location。
import { Value } from '@sinclair/typebox/value';
import { PoiPhotoSchema, type PoiPhoto } from '@tripweaver/shared';
import {
  matchesStockPlace, object, photoKey, readStockCache, safePhotoUrl, stockPhotoBudget,
  stockPhotoScore, stockPhotoSearch, string, writeStockCache, type StockPhotoLookup, type StockPhotoQuery,
} from '../stockPhotoSupport';

interface Selection { id: string; photo: PoiPhoto; downloadLocation: string; evidence: string }
const SITE = ['unsplash.com'];
const LICENSE_URL = 'https://unsplash.com/license?utm_source=tripweaver&utm_medium=referral';
function referral(value: unknown, prefix: string): string | null {
  const safe = safePhotoUrl(value, SITE, prefix);
  if (!safe) return null;
  const url = new URL(safe);
  url.searchParams.set('utm_source', 'tripweaver');
  url.searchParams.set('utm_medium', 'referral');
  return url.href.length <= 1500 ? url.href : null;
}
function validSelection(value: unknown, query: StockPhotoQuery): value is Selection {
  const row = object(value), photo = row.photo;
  if (!Value.Check(PoiPhotoSchema, photo) || !photo.attribution || photo.attribution.source !== 'unsplash') return false;
  if (!/^[\w-]+$/.test(string(row.id)) || !matchesStockPlace(string(row.evidence), query)) return false;
  if (!safePhotoUrl(photo.url, ['images.unsplash.com']) || photo.url.length > 300) return false;
  const credit = photo.attribution;
  if (!credit.photographerUrl || referral(credit.sourceUrl, '/photos/') !== credit.sourceUrl ||
    referral(credit.photographerUrl, '/@') !== credit.photographerUrl || credit.license !== 'Unsplash License' || credit.licenseUrl !== LICENSE_URL) return false;
  const download = safePhotoUrl(row.downloadLocation, ['api.unsplash.com'], `/photos/${row.id}/download`);
  if (!download) return false;
  const url = new URL(download);
  return url.pathname === `/photos/${row.id}/download` && !url.hash &&
    [...url.searchParams.keys()].every(key => key === 'ixid');
}
function selections(value: unknown, query: StockPhotoQuery): Selection[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is Selection => validSelection(row, query))
    .filter((row, i, rows) => rows.findIndex(other => other.id === row.id || other.photo.url === row.photo.url) === i).slice(0, 3);
}

export function pickUnsplashPhotos(value: unknown, query: StockPhotoQuery): Selection[] {
  if (!Array.isArray(value)) return [];
  const ranked = value.map(value => {
    const row = object(value), links = object(row.links), user = object(row.user), urls = object(row.urls);
    const evidence = [row.description, row.alt_description, links.html, ...Object.values(object(row.location))].map(string).join(' ');
    const sourceUrl = referral(links.html, '/photos/'), photographerUrl = referral(object(user.links).html, '/@');
    const photographer = string(user.name).trim();
    const photo: PoiPhoto = { url: string(urls.regular), attribution: {
      source: 'unsplash', photographer: photographer.slice(0, 300), sourceUrl: sourceUrl ?? '',
      photographerUrl: photographerUrl ?? '', license: 'Unsplash License', licenseUrl: LICENSE_URL,
      changes: '使用官方图片尺寸版本，未另行裁切',
    } };
    return { selection: { id: string(row.id), photo, downloadLocation: string(links.download_location), evidence },
      score: stockPhotoScore(row.width, row.height, evidence), eligible: !!photographer && !!sourceUrl && !!photographerUrl };
  }).filter(row => row.eligible).sort((a, b) => b.score - a.score);
  return selections(ranked.map(row => row.selection), query);
}

export function createUnsplashCoverLookup(apiKey: string, requestsLeft = 12, options: { dataRoot?: string } = {}): StockPhotoLookup {
  const budget = stockPhotoBudget('unsplash', requestsLeft);
  const headers = { Authorization: `Client-ID ${apiKey}`, 'Accept-Version': 'v1' };
  // 一个生成任务内的同名采用只上报一次；下一任务复用元数据时重新记一次采用。
  const pending = new Map<string, Promise<PoiPhoto[]>>();
  const savedFor = async (query: StockPhotoQuery): Promise<Selection[] | null> => {
    const saved = await readStockCache('unsplash-places', photoKey(query), options.dataRoot, Infinity);
    return saved === undefined ? null : selections(saved, query);
  };
  const cachedPhotosFor = async (query: StockPhotoQuery) => {
    if (!apiKey) return null;
    return (await savedFor(query))?.map(row => row.photo) ?? null;
  };
  const photosFor = (query: StockPhotoQuery): Promise<PoiPhoto[]> => {
    const key = photoKey(query), existing = pending.get(key);
    if (existing) return existing;
    const task = (async () => {
      if (!apiKey) return [];
      try {
        let chosen = await savedFor(query);
        if (chosen === null) {
          let cached = await readStockCache('unsplash-search', key, options.dataRoot);
          if (cached === undefined) {
            const params = new URLSearchParams({ query: stockPhotoSearch(query), per_page: '20', content_filter: 'high' });
            const body = object(await budget.json(`https://api.unsplash.com/search/photos?${params}`, headers));
            if (!Array.isArray(body.results)) throw new Error('invalid photo results');
            cached = pickUnsplashPhotos(body.results, query);
            await writeStockCache('unsplash-search', key, cached, options.dataRoot);
          }
          chosen = selections(cached, query);
        }
        const adopted: Selection[] = [];
        for (const selection of chosen) {
          try {
            await budget.json(selection.downloadLocation, headers);
            adopted.push(selection);
          } catch { /* 上报失败的照片不进入本次行程，下一任务可以重试。 */ }
        }
        // 保留稳定顺序和整组选择，避免暂时上报失败永久删掉备选。
        if (adopted.length) await writeStockCache('unsplash-places', key, chosen, options.dataRoot);
        return adopted.map(row => row.photo);
      } catch {
        console.warn('[unsplash-cover] 图源暂不可用，跳过本次选片');
        return [];
      }
    })();
    pending.set(key, task);
    return task;
  };
  return { cachedPhotosFor, photosFor };
}
