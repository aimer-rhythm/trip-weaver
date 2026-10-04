import type { Trip } from '@tripweaver/shared';
import type { ReviewedCover } from '../integrations/reviewedPhotos';

/** 只补详情响应中的空图片，不写回历史版本；lookup 复用正式选图与异步入队规则。 */
export async function enrichTripPhotos(trip: Trip, lookup: (name: string) => Promise<ReviewedCover | null>): Promise<Trip> {
  if (!trip.overview?.length) return trip;
  const pending = new Map<string, Promise<ReviewedCover | null>>();
  const overview = await Promise.all(trip.overview.map(async poi => {
    if (poi.category !== 'attraction' || poi.coverUrl || poi.photos?.length) return poi;
    let result = pending.get(poi.name);
    if (!result) {
      result = lookup(poi.name).catch(() => null);
      pending.set(poi.name, result);
    }
    const cover = await result;
    return cover?.coverUrl ? { ...poi, ...cover } : poi;
  }));
  return { ...trip, overview };
}
