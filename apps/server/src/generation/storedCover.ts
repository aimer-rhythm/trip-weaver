// 库内景点封面（09-27）：canonical_places.payload.coverImage 存相对 key
// （如 `xhs/杭州/{placeId}/00.webp`，由上游 export_place_images.py 生成、seed-xhs-place-images.ts 写入），
// 这里按 MEDIA_BASE_URL 拼成可展示 URL，交给候选的 coverUrl。
//
// 为什么不存绝对 URL：换存储（本地盘 → 对象存储）只要改环境变量；
// 存绝对 URL 则每次换都要全量重导地点库。
//
// 命中即跳过维基降级 —— upload.wikimedia.org 在国内被封锁，维基只能当海外/代理环境的兜底。
import { env } from '../env';
import { loadPlaceFacts } from './scheduling/placeFacts';

/** 相对 key → 可展示 URL；空 key 返回 null。key 已含 `xhs/` 前缀，与上游导出脚本对齐。
 *  base 默认取 MEDIA_BASE_URL（可注入便于单测）。 */
export function mediaUrl(key: string, base: string = env.mediaBaseUrl): string | null {
  const clean = key.trim().replace(/^\/+/, '');
  if (!clean) return null;
  return base ? `${base.replace(/\/+$/, '')}/${clean}` : `/${clean}`;
}

/**
 * 与 cityPointLookup 同模式：全城行只拉一次，后续候选复用同一 promise。
 * 查库失败或地点不存在都是 null（loadPlaceFacts 内部已吞异常回空 Map），调用方继续走维基降级。
 */
export function createStoredCoverLookup(city: string): (name: string) => Promise<string | null> {
  let pending: ReturnType<typeof loadPlaceFacts> | null = null;
  return async (name) => {
    if (!city.trim()) return null;
    pending ??= loadPlaceFacts([name], city);
    const hit = (await pending).get(name);
    return hit?.coverImage ? mediaUrl(hit.coverImage) : null;
  };
}

/**
 * 库内已回写的高德图片（09-27）：命中直接返回，不再打高德稀缺的搜索配额（个人 5,000/月）。
 * 与 createStoredCoverLookup 同模式：全城行只拉一次，后续候选复用。
 */
export function createStoredAmapPhotoLookup(city: string): (name: string) => Promise<string | null> {
  let pending: ReturnType<typeof loadPlaceFacts> | null = null;
  return async (name) => {
    if (!city.trim()) return null;
    pending ??= loadPlaceFacts([name], city);
    const hit = (await pending).get(name);
    return hit?.amapPhoto ?? null;
  };
}
