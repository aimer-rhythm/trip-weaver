// 身份绑定从旧目录挑出具体图片，原目录名不作为新分店的别名。
import { createSelectedPhotoLibrary } from './selectedPhotos';
import { createPhotoAdopter, rankReviewedPhotos, type PhotoAdoptionOptions, type PhotoAsset,
  type ReviewedCover, type ReviewedPhoto } from './reviewedPhotos';
import { createPlaceIdentityIndex, placeIdentity, type IdentityPlace } from '../lib/placeIdentity';
import type { IndependentPhotoSources, IndependentPhotoSource } from '../services/independentPhotoSources';
import type { IndependentPhotoAssignment } from '../services/independentPhotoIdentity';

export function createBoundPhotoLookup(city: string, inputs: IndependentPhotoSources,
  assignments: readonly IndependentPhotoAssignment[], identities: ReturnType<typeof createPlaceIdentityIndex>,
  options: PhotoAdoptionOptions = {}) {
  const sources = new WeakMap<PhotoAsset, IndependentPhotoSource>(inputs.sources.map(source => [source.entry, source]));
  const assignedKeys = new Set(assignments.map(row => row.image_key));
  const assignedAssets = new Set(assignments.map(row => row.asset_key));
  const adopt = createPhotoAdopter(options);
  const selected = createSelectedPhotoLibrary(city, { library: inputs.selected ?? {} });
  const pending = new Map<string, Promise<ReviewedCover | null>>();
  const allowUnbound = (entry: PhotoAsset): boolean => {
    const source = sources.get(entry);
    return !!source && source.city === city && !assignedKeys.has(source.imageKey) && !assignedAssets.has(source.assetKey);
  };
  const forPlace = (place: IdentityPlace & { verified?: boolean }): Promise<ReviewedCover | null> => {
    const identity = placeIdentity(place);
    if (place.city !== city || place.verified !== true || identity.version !== 2 || identity.entityId !== place.id
      || place.payload?.canonicalRedirectTo || place.payload?.identityWithdrawal) return Promise.resolve(null);
    const key = `${place.id}:${identity.revision}`;
    let result = pending.get(key);
    if (!result) {
      result = (async () => {
        const matched = inputs.sources.filter(source => source.city === city && source.eligible && assignments.some(row => row.city === city
          && row.entity_id === place.id && row.entity_revision === identity.revision && row.image_key === source.imageKey
          && row.input_hash === source.inputHash && row.asset_key === source.assetKey));
        if (!matched.length) return null;
        const selectedPhotos = matched.filter(source => source.kind === 'selected').map(source => source.entry);
        const cover = await adopt(selectedPhotos);
        if (cover) return cover;
        const feedbackNames = new Set([place.name]);
        for (const group of inputs.selected?.places ?? []) {
          const resolved = identities.resolve(city, group.name);
          if (resolved.status === 'resolved' && resolved.canonicalPlaceId === place.id
            || inputs.sources.some(source => source.kind === 'selected' && source.catalogName === group.name
              && assignments.some(row => row.image_key === source.imageKey && row.entity_id === place.id))) feedbackNames.add(group.name);
        }
        const reviewedPhotos = matched.filter(source => source.kind === 'reviewed'
          && [source.catalogName, ...feedbackNames].every(name => selected.acceptSupplement(name, source.entry)))
          .map(source => source.entry).filter((entry): entry is ReviewedPhoto => 'review' in entry);
        return adopt(rankReviewedPhotos(reviewedPhotos).map(entry => ({ ...entry, view: entry.review.view })));
      })().catch(() => null);
      pending.set(key, result);
    }
    return result;
  };
  return { forPlace, allowUnbound };
}
