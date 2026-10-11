import { env } from '../env';
import { createPhotoReviewQueue } from './photoReviewQueue';
import { collectPhotoCandidates, reviewPhotoCandidates, type PhotoCollectionConfig, type PhotoCandidate } from './photoCollection';
import { createReviewedCoverLookup, type PhotoAdoptionOptions } from './reviewedPhotos';
import { createSelectedPhotoLibrary, selectedFirstLookup } from './selectedPhotos';
import { createStoredPlaceLookups } from '../generation/storedCover';
import { createAmapPoiPhotoLookup } from './amap/poiPhotos';
import { safePhotoUrl } from './stockPhotoSupport';
import { loadPlaceIdentityIndex } from '../services/placeIdentityService';
import { loadIndependentPhotoSources, type IndependentPhotoSources } from '../services/independentPhotoSources';
import { loadIndependentPhotoAssignments, type IndependentPhotoAssignment } from '../services/independentPhotoIdentity';
import { createBoundPhotoLookup } from './boundPhotoLookup';
import { pool } from '../db/client';

export const photoCollectionConfig: PhotoCollectionConfig = {
  ...env.photoReview, pexelsKey: env.pexelsApiKey, pixabayKey: env.pixabayApiKey, unsplashKey: env.unsplashAccessKey,
};
export const photoReviewConfigured = Boolean(env.photoReview.enabled && photoCollectionConfig.baseUrl && photoCollectionConfig.apiKey && photoCollectionConfig.model);
function scopedPhotoReference(identities: Awaited<ReturnType<typeof loadPlaceIdentityIndex>>, city: string, name: string): boolean {
  // 仅用于阻止回退/入队，不用去括注后的名字确认身份。
  let candidate = name.normalize('NFKC').trim();
  for (;;) {
    if (identities.isScopedReference(city, candidate)) return true;
    const base = candidate.replace(/\([^()]+\)$/, '').trim();
    if (base === candidate) return false;
    candidate = base;
  }
}
export const photoReviewQueue = createPhotoReviewQueue({
  dailyLimit: env.photoReview.dailyLimit, warn: message => console.warn(message),
  async run(job, signal) {
    if (!photoReviewConfigured) throw new Error('photo review not configured');
    const identities = await loadPlaceIdentityIndex(job.city);
    if (scopedPhotoReference(identities, job.city, job.name) || identities.resolve(job.city, job.name).status === 'ambiguous') return;
    const candidates = await collectPhotoCandidates(job.city, job.name, photoCollectionConfig, {
      signal,
      async supplemental() {
        const stored = createStoredPlaceLookups(job.city);
        const result: PhotoCandidate[] = [];
        for (const photo of await stored.photosFor(job.name).catch(() => [])) {
          // MEDIA_BASE_URL可能指向CDN；此处还原本地key，仅后台读取原文件。
          const base = env.mediaBaseUrl.replace(/\/+$/, '');
          const url = base && photo.url.startsWith(`${base}/`) ? `/media/${photo.url.slice(base.length + 1)}` : photo.url;
          result.push({ photo: { ...photo, url }, evidence: `${job.city} ${job.name} 导入图库候选，具体地点需重新核对` });
        }
        const amap = await stored.amapPhotoFor(job.name).catch(() => null) ??
          await createAmapPoiPhotoLookup(env.amapKey, 1).coverFor({ city: job.city, name: job.name });
        if (amap && safePhotoUrl(amap, ['store.is.autonavi.com', 'aos-cdn-image.amap.com'])) result.push({
          photo: { url: amap }, provider: 'amap', evidence: `${job.city} ${job.name} 高德POI关联图；关联不是主体身份保证，必须独立核对画面`,
        });
        return result;
      },
    });
    await reviewPhotoCandidates(job.city, job.name, candidates, photoCollectionConfig, { signal });
  },
});

export function createGenerationPhotoLookup(city: string, loadIdentities = loadPlaceIdentityIndex, dependencies: {
  loadSources?: (city: string) => Promise<IndependentPhotoSources>;
  loadAssignments?: (city: string) => Promise<IndependentPhotoAssignment[]>;
  adoption?: PhotoAdoptionOptions;
  enqueue?: (city: string, name: string) => Promise<unknown>;
} = {}) {
  const prepare = async () => {
    const [identities, inputs, assignments] = await Promise.all([loadIdentities(city),
      dependencies.loadSources ? dependencies.loadSources(city) : loadIndependentPhotoSources(city, { verifyBytes: false }),
      dependencies.loadAssignments ? dependencies.loadAssignments(city) : loadIndependentPhotoAssignments(pool, city)]);
    const acceptPlace = (name: string) => !scopedPhotoReference(identities, city, name)
      && identities.resolve(city, name).status !== 'ambiguous';
    const options = { unsplashKey: env.unsplashAccessKey, mediaBase: env.mediaBaseUrl, ...dependencies.adoption, acceptPlace };
    const bound = createBoundPhotoLookup(city, inputs, assignments, identities, options);
    const selected = createSelectedPhotoLibrary(city, { ...options, library: inputs.selected ?? {},
      acceptPhoto: (_name, entry) => bound.allowUnbound(entry) });
    const lookup = selectedFirstLookup(selected, createReviewedCoverLookup(city, { ...options, load: async () => inputs.reviewed,
      acceptPhoto: (name, entry) => bound.allowUnbound(entry) && selected.acceptSupplement(name, entry) }),
      name => dependencies.enqueue ? dependencies.enqueue(city, name) : photoReviewQueue.enqueue(city, name, 'trip'));
    return async (name: string) => {
      const resolved = identities.resolve(city, name);
      if (resolved.status === 'resolved') {
        const cover = await bound.forPlace(resolved.place);
        if (cover) return cover;
      }
      return acceptPlace(name) ? lookup(name) : null;
    };
  };
  let ready: ReturnType<typeof prepare> | undefined;
  // 受控主体只用逐图绑定；普通未分配来源保持现有补图行为。
  return async (name: string) => {
    try { return await (await (ready ??= prepare()))(name); }
    catch { return null; }
  };
}
