// 库内景点封面（09-27）：canonical_places.payload.coverImage 存相对 key
// （如 `xhs/杭州/{placeId}/00.webp`，由上游 export_place_images.py 生成、seed-xhs-place-images.ts 写入），
// 这里按 MEDIA_BASE_URL 拼成可展示 URL，交给候选的 coverUrl。
//
// 为什么不存绝对 URL：换存储（本地盘 → 对象存储）只要改环境变量；
// 存绝对 URL 则每次换都要全量重导地点库。
//
// 命中即跳过维基降级 —— upload.wikimedia.org 在国内被封锁，维基只能当海外/代理环境的兜底。
import { env } from '../env';
import type { ResearchPoi } from '@tripweaver/shared';
import { loadCityPlaceFacts, normalizePlaceKey } from './scheduling/placeFacts';

/** 相对 key → 可展示 URL；空 key 返回 null。key 已含 `xhs/` 前缀，与上游导出脚本对齐。
 *  base 默认取 MEDIA_BASE_URL（可注入便于单测）。 */
export function mediaUrl(key: string, base: string = env.mediaBaseUrl): string | null {
  const clean = key.trim().replace(/^\/+/, '');
  if (!clean) return null;
  return base ? `${base.replace(/\/+$/, '')}/${clean}` : `/${clean}`;
}

/** 一次生成共享全城索引；主名、别名、坐标和两种图片均从同一份事实读取。 */
export function createStoredPlaceLookups(city: string, loadFacts = loadCityPlaceFacts) {
  let pending: ReturnType<typeof loadCityPlaceFacts> | null = null;
  const find = async (name: string) => {
    if (!city.trim() || !name.trim()) return null;
    pending ??= loadFacts(city);
    const index = await pending;
    const exact = index.get(normalizePlaceKey(name));
    if (exact) return exact;
    // 候选常写作「九溪烟树（九溪十八涧）」。先匹配完整名字，再匹配括号前的主体；
    // 不用括号内的父景区替代主体（「断桥（西湖）」仍不能取西湖封面）。
    const annotated = name.normalize('NFKC').trim().match(/^([^()]+)\([^()]+\)$/);
    return annotated ? index.get(normalizePlaceKey(annotated[1]!)) ?? null : null;
  };
  return {
    async photosFor(name: string): Promise<NonNullable<ResearchPoi['photos']>> {
      const hit = await find(name);
      return (hit?.imageGallery ?? []).flatMap(photo => {
        const url = mediaUrl(photo.key);
        return url ? [{ url, attribution: photo.attribution }] : [];
      }).slice(0, 3);
    },
    async coverFor(name: string): Promise<string | null> {
      const hit = await find(name);
      return hit?.coverImage ? mediaUrl(hit.coverImage) : null;
    },
    async amapPhotoFor(name: string): Promise<string | null> {
      return (await find(name))?.amapPhoto ?? null;
    },
    async pointFor(name: string): Promise<{ lat: number; lng: number } | null> {
      const hit = await find(name);
      return hit?.lat !== undefined && hit.lng !== undefined ? { lat: hit.lat, lng: hit.lng } : null;
    },
  };
}

export function createStoredCoverLookup(city: string): (name: string) => Promise<string | null> {
  return createStoredPlaceLookups(city).coverFor;
}

/**
 * 库内已回写的高德图片（09-27）：命中直接返回，不再打高德稀缺的搜索配额（个人 5,000/月）。
 * 与 createStoredCoverLookup 同模式：全城行只拉一次，后续候选复用。
 */
export function createStoredAmapPhotoLookup(city: string): (name: string) => Promise<string | null> {
  return createStoredPlaceLookups(city).amapPhotoFor;
}
