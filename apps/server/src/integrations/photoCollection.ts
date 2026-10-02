// 有界跨源采集及视觉审核；仅后台worker/预热CLI调用。
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { Value } from '@sinclair/typebox/value';
import { Type } from '@sinclair/typebox';
import type { PoiPhoto } from '@tripweaver/shared';
import { PoiPhotoSchema, PhotoAttributionSchema } from '@tripweaver/shared';
import { createCuratedCoverLookup } from './curatedPhotos';
import { saveRemotePhoto } from './photoStore';
import { object, string, PHOTO_DATA, safePhotoUrl, stockPhotoBudget, stockPhotoSearch } from './stockPhotoSupport';
import { PHOTO_REVIEW_PROMPT, PHOTO_REVIEW_VERSION, VisualReviewSchema, reviewDigest, reviewName,
  validReviewedAttribution, writeReviewedCatalog, type ReviewedPhoto, type VisualReview } from './reviewedPhotos';
import { photoMime, photoResponseBytes, readPhotoJson, writePhotoJson } from './photoReviewIO';

export interface PhotoCollectionConfig {
  baseUrl: string; apiKey: string; model: string;
  pexelsKey: string; pixabayKey: string; unsplashKey: string;
}
export interface PhotoCandidate {
  photo: PoiPhoto; evidence: string; downloadLocation?: string; provider?: 'amap';
}
const CandidateSchema = Type.Object({
  photo: Type.Object({ url: Type.String({ minLength: 1, maxLength: 4000 }), attribution: Type.Optional(PhotoAttributionSchema) }),
  evidence: Type.String({ minLength: 1, maxLength: 1500 }),
  provider: Type.Optional(Type.Literal('amap')), downloadLocation: Type.Optional(Type.String({ maxLength: 1500 })),
});
const strip = (value: unknown) => string(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1500);
function referral(raw: unknown): string {
  const safe = safePhotoUrl(raw, ['unsplash.com']);
  if (!safe) return '';
  const u = new URL(safe); u.searchParams.set('utm_source', 'tripweaver'); u.searchParams.set('utm_medium', 'referral'); return u.href;
}
// 保留候选池，查询词不是身份结论。所有源都参与；每源最多3张进入本轮审核。
export function sourceCandidates(provider: string, raw: unknown): PhotoCandidate[] {
  const body = object(raw);
  const list: unknown[] = provider === 'commons' ? Object.values(object(object(body.query).pages)) :
    Array.isArray(body.photos) ? body.photos : Array.isArray(body.hits) ? body.hits : Array.isArray(body.results) ? body.results : [];
  return list.flatMap(value => {
    const row = object(value);
    let candidate: PhotoCandidate;
    if (provider === 'pexels') {
      candidate = { photo: { url: string(object(row.src).large), attribution: { source: 'pexels', photographer: strip(row.photographer), sourceUrl: string(row.url), license: 'Pexels License', licenseUrl: 'https://www.pexels.com/license/', changes: '图源尺寸版本' } }, evidence: strip(row.alt) };
    } else if (provider === 'pixabay') {
      if (row.type !== 'photo') return [];
      candidate = { photo: { url: string(row.largeImageURL), attribution: { source: 'pixabay', photographer: strip(row.user), sourceUrl: string(row.pageURL), license: 'Pixabay Content License', licenseUrl: 'https://pixabay.com/service/license-summary/', changes: '图源尺寸版本' } }, evidence: strip(row.tags) };
    } else if (provider === 'unsplash') {
      const links = object(row.links), user = object(row.user);
      candidate = { photo: { url: string(object(row.urls).regular), attribution: { source: 'unsplash', photographer: strip(user.name), sourceUrl: referral(links.html), photographerUrl: referral(object(user.links).html), license: 'Unsplash License', licenseUrl: referral('https://unsplash.com/license'), changes: '官方hotlink，未裁切' } },
        evidence: strip([row.description, row.alt_description, ...Object.values(object(row.location))].filter(v => typeof v === 'string').join(' ')), downloadLocation: string(links.download_location) };
    } else {
      const info = object(Array.isArray(row.imageinfo) ? row.imageinfo[0] : undefined), metadata = object(info.extmetadata);
      candidate = { photo: { url: string(info.thumburl || info.url), attribution: { source: 'commons', photographer: strip(object(metadata.Artist).value), sourceUrl: string(info.descriptionurl), license: strip(object(metadata.LicenseShortName).value), licenseUrl: string(object(metadata.LicenseUrl).value).replace(/^http:/, 'https:'), changes: 'Wikimedia缩略图版本' } }, evidence: strip(`${string(row.title)} ${strip(object(metadata.ImageDescription).value)}`) };
    }
    const checkPhoto = provider === 'unsplash' ? candidate.photo : { ...candidate.photo, url: '/media/pending' };
    return candidate.evidence && Value.Check(PoiPhotoSchema, checkPhoto) && validReviewedAttribution({ ...candidate, photo: checkPhoto }) ? [candidate] : [];
  });
}

export async function collectPhotoCandidates(city: string, name: string, config: PhotoCollectionConfig, options: {
  dataRoot?: string; signal: AbortSignal; supplemental?: () => Promise<PhotoCandidate[]>;
}): Promise<PhotoCandidate[]> {
  const root = options.dataRoot ?? PHOTO_DATA, query = stockPhotoSearch({ city, name });
  const output: PhotoCandidate[] = [];
  const curated = await createCuratedCoverLookup(city)(name);
  for (const photo of curated?.photos ?? []) output.push({ photo, evidence: `${city} ${name}；既有图库来源，必须重新核对实际主体；${photo.attribution?.sourceUrl ?? ''}` });
  let successes = 0;
  for (const provider of ['pexels', 'pixabay', 'unsplash', 'commons'] as const) {
    if (options.signal.aborted) throw new Error('photo collection cancelled');
    if (provider === 'pexels' && !config.pexelsKey || provider === 'pixabay' && !config.pixabayKey || provider === 'unsplash' && !config.unsplashKey) continue;
    const cache = path.join(root, 'photo-store/review-search', reviewDigest(JSON.stringify([PHOTO_REVIEW_VERSION, provider, city, name])) + '.json');
    try {
      const saved = object(await readPhotoJson(cache));
      let candidates: PhotoCandidate[];
      if (typeof saved.at === 'number' && Date.now() - saved.at < 86400000 && Array.isArray(saved.candidates)) {
        // 缓存仍通过下游完整校验，不能直接进入正式图库。
        candidates = saved.candidates.filter((c): c is PhotoCandidate => Value.Check(CandidateSchema, c));
      } else {
        let url: string;
        const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': 'TripweaverPhotoReview/1.0' };
        if (provider === 'pexels') {
          url = `https://api.pexels.com/v1/search?${new URLSearchParams({ query, per_page: '12' })}`;
          headers.Authorization = config.pexelsKey;
        } else if (provider === 'pixabay') url = `https://pixabay.com/api/?${new URLSearchParams({ key: config.pixabayKey, q: query, image_type: 'photo', safesearch: 'true', per_page: '20' })}`;
        else if (provider === 'unsplash') {
          url = `https://api.unsplash.com/search/photos?${new URLSearchParams({ query, per_page: '12', content_filter: 'high' })}`;
          headers.Authorization = `Client-ID ${config.unsplashKey}`; headers['Accept-Version'] = 'v1';
        } else url = `https://commons.wikimedia.org/w/api.php?${new URLSearchParams({ action: 'query', format: 'json', generator: 'search', gsrsearch: `${query} filetype:bitmap`, gsrnamespace: '6', gsrlimit: '12', prop: 'imageinfo', iiprop: 'url|size|extmetadata', iiurlwidth: '1280' })}`;
        const raw = provider === 'unsplash' || provider === 'pixabay' ? await stockPhotoBudget(provider, 1).json(url, headers) :
          JSON.parse((await photoResponseBytes(await fetch(url, { headers, signal: AbortSignal.any([options.signal, AbortSignal.timeout(8000)]), redirect: 'error' }), 1024 * 1024)).toString('utf8')) as unknown;
        const data = object(raw);
        if (data.error || provider === 'pexels' && !Array.isArray(data.photos) ||
          provider === 'pixabay' && !Array.isArray(data.hits) || provider === 'unsplash' && !Array.isArray(data.results) ||
          provider === 'commons' && !('batchcomplete' in data) && !('query' in data)) throw new Error('invalid photo search response');
        candidates = sourceCandidates(provider, raw);
        await writePhotoJson(cache, { at: Date.now(), candidates });
      }
      output.push(...candidates.slice(0, 3)); successes++;
    } catch { /* 来源失败不阻止其他来源；没有任何成功来源时重试。密钥可能在URL中，不能打印原始异常。 */ }
  }
  if (options.supplemental) output.push(...await options.supplemental().catch(() => []));
  if (!successes && !output.length) throw new Error('all photo sources unavailable');
  // 轮转各源，避免旧精选占掉全部预算；同作品同URL只审一次。
  const groups = new Map<string, PhotoCandidate[]>();
  for (const c of output) {
    if (!c?.photo || typeof c.photo.url !== 'string') continue;
    const source = c.photo.attribution?.source ?? c.provider ?? 'unknown';
    const group = groups.get(source) ?? [];
    if (!group.some(p => p.photo.url === c.photo.url)) group.push(c);
    groups.set(source, group);
  }
  const result: PhotoCandidate[] = [];
  for (let i = 0; i < 3; i++) for (const group of groups.values()) if (group[i]) result.push(group[i]!);
  return result.slice(0, 18);
}

export async function requestVisualReview(config: PhotoCollectionConfig, city: string, name: string, candidate: PhotoCandidate, image: string, signal: AbortSignal): Promise<VisualReview> {
  const { assertSafeBaseUrl } = await import('./ssrfGuard');
  await assertSafeBaseUrl(config.baseUrl);
  const base = new URL(config.baseUrl);
  if (base.username || base.password || base.search || base.hash) throw new Error('invalid review endpoint');
  const response = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(45000)]),
    headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: config.model, max_tokens: 1200, messages: [
      { role: 'system', content: PHOTO_REVIEW_PROMPT },
      { role: 'user', content: [{ type: 'text', text: JSON.stringify({ city, name, evidence: candidate.evidence.slice(0, 1500), sourceUrl: candidate.photo.attribution?.sourceUrl ?? '', instruction: '按目标景点独立核对，不把搜索词当证据' }) },
        { type: 'image_url', image_url: { url: image, detail: 'high' } }] },
    ] }),
  });
  const body = object(JSON.parse((await photoResponseBytes(response, 128 * 1024)).toString('utf8')));
  const first = object(Array.isArray(body.choices) ? body.choices[0] : null);
  const content = string(object(first.message).content).trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  const result: unknown = JSON.parse(content);
  if (!Value.Check(VisualReviewSchema, result)) throw new Error('invalid visual review');
  return result;
}

export async function reviewPhotoCandidates(city: string, name: string, candidates: PhotoCandidate[], config: PhotoCollectionConfig, options: {
  dataRoot?: string; signal: AbortSignal;
  review?: typeof requestVisualReview;
}): Promise<{ reviewed: number; failed: number }> {
  const root = options.dataRoot ?? PHOTO_DATA, entries: ReviewedPhoto[] = [];
  let failed = 0;
  const failures: { source: string; stage: string }[] = [];
  for (const candidate of candidates.slice(0, 18)) {
    if (options.signal.aborted) throw new Error('photo review cancelled');
    let stage = 'validation';
    try {
      if (!Value.Check(CandidateSchema, candidate)) continue;
      const credit = candidate.photo.attribution;
      const remote = credit?.source === 'unsplash' || candidate.provider === 'amap';
      // 临时图源下载URL可较长；保存后的公共URL必须通过共享schema。
      const checkPhoto = remote || candidate.photo.url.startsWith('/media/') ? candidate.photo : { ...candidate.photo, url: '/media/pending' };
      if (!Value.Check(PoiPhotoSchema, checkPhoto)) continue;
      const shell = { ...candidate, photo: checkPhoto, model: config.model, reviewedAt: new Date().toISOString() };
      if (!validReviewedAttribution(shell)) continue;
      let photo = candidate.photo, image: string, sha256: string;
      if (remote) { image = photo.url; sha256 = reviewDigest(photo.url); }
      else {
        if (!photo.url.startsWith('/media/')) {
          stage = 'download';
          const saved = await saveRemotePhoto(photo, root); if (!saved) throw new Error('photo download unavailable'); photo = saved;
        }
        // 下游目录只准固定媒体路径，禁止读取任意本地文件。
        const { safeImageKey } = await import('../lib/imageGallery');
        const relative = photo.url.slice('/media/'.length);
        if (!(safeImageKey(relative) || /^(remote-photos|wikimedia)\/[a-f0-9]{64}\.(jpg|png)$/.test(relative))) continue;
        stage = 'local-image';
        const bytes = await readFile(path.join(root, 'media', relative));
        const mime = photoMime(bytes); if (!mime || bytes.length > 8 * 1024 * 1024) continue;
        sha256 = reviewDigest(bytes); image = `data:${mime};base64,${bytes.toString('base64')}`;
      }
      const key = reviewDigest(JSON.stringify([PHOTO_REVIEW_VERSION, reviewDigest(PHOTO_REVIEW_PROMPT), config.model, config.baseUrl, reviewName(city), reviewName(name), sha256, candidate.evidence, credit?.sourceUrl]));
      const file = path.join(root, 'photo-store/visual-reviews', `${key}.json`);
      let review = await readPhotoJson(file, 16384);
      if (!Value.Check(VisualReviewSchema, review)) {
        stage = 'visual-model';
        review = await (options.review ?? requestVisualReview)(config, city, name, candidate, image, options.signal);
        if (!Value.Check(VisualReviewSchema, review)) throw new Error('invalid review');
        stage = 'cache-write';
        await writePhotoJson(file, review);
      }
      entries.push({ ...shell, photo, sha256, review });
    } catch { failed++; failures.push({ source: candidate?.photo?.attribution?.source ?? candidate?.provider ?? 'unknown', stage }); }
  }
  await writePhotoJson(path.join(root, 'photo-store/review-reports', reviewDigest(JSON.stringify([city, name])) + '.json'), {
    version: PHOTO_REVIEW_VERSION, city, name, at: new Date().toISOString(), reviewed: entries.length, failed, failures,
  });
  // 全部失败不覆盖已有图库；审核通过/拒绝都保留依据，失败由队列重试。
  if (failed && !entries.length) throw new Error('photo review unavailable');
  if (entries.length || !candidates.length) await writeReviewedCatalog({ version: PHOTO_REVIEW_VERSION, city, name, aliases: [], entries }, root);
  if (failed) throw new Error('photo review partially failed');
  return { reviewed: entries.length, failed };
}
