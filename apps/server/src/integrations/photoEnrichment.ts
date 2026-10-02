import { env } from '../env';
import { createPhotoReviewQueue } from './photoReviewQueue';
import { collectPhotoCandidates, reviewPhotoCandidates, type PhotoCollectionConfig, type PhotoCandidate } from './photoCollection';
import { createReviewedCoverLookup } from './reviewedPhotos';
import { createSelectedPhotoLibrary, selectedFirstLookup } from './selectedPhotos';
import { createStoredPlaceLookups } from '../generation/storedCover';
import { createAmapPoiPhotoLookup } from './amap/poiPhotos';
import { safePhotoUrl } from './stockPhotoSupport';

export const photoCollectionConfig: PhotoCollectionConfig = {
  ...env.photoReview, pexelsKey: env.pexelsApiKey, pixabayKey: env.pixabayApiKey, unsplashKey: env.unsplashAccessKey,
};
export const photoReviewConfigured = Boolean(env.photoReview.enabled && photoCollectionConfig.baseUrl && photoCollectionConfig.apiKey && photoCollectionConfig.model);
export const photoReviewQueue = createPhotoReviewQueue({
  dailyLimit: env.photoReview.dailyLimit, warn: message => console.warn(message),
  async run(job, signal) {
    if (!photoReviewConfigured) throw new Error('photo review not configured');
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

export function createGenerationPhotoLookup(city: string) {
  const options = { unsplashKey: env.unsplashAccessKey, mediaBase: env.mediaBaseUrl };
  const selected = createSelectedPhotoLibrary(city, options);
  return selectedFirstLookup(selected, createReviewedCoverLookup(city, { ...options, acceptPhoto: selected.acceptSupplement }),
    name => photoReviewQueue.enqueue(city, name));
}
