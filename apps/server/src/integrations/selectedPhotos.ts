// 用户明确授权采用的选图快照；与后台生成的审核目录分开，后台不能重排或覆盖。
import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import beijing from '../data/photography/beijing-selected.json';
import { PhotoAssetSchema, createPhotoAdopter, reviewName, reviewFirstLookup,
  type PhotoAsset, type PhotoAdoptionOptions, type ReviewedCover } from './reviewedPhotos';

const SelectionSchema = Type.Object({
  ...PhotoAssetSchema.properties,
  selectionKey: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  identity: Type.Literal('verified'), evidence: Type.String({ minLength: 1 }),
});
export const SelectedLibrarySchema = Type.Object({
  version: Type.Literal(1), city: Type.String(), snapshotId: Type.String({ minLength: 1 }), selectedAt: Type.String(),
  places: Type.Array(Type.Object({
    name: Type.String({ minLength: 1 }), aliases: Type.Array(Type.String({ minLength: 1 })),
    photos: Type.Array(SelectionSchema, { maxItems: 100 }),
    excluded: Type.Array(Type.Object({ url: Type.String(), sourceUrl: Type.String(), sha256: Type.String() })),
  })),
});
export type SelectedLibrary = Static<typeof SelectedLibrarySchema>;
const workUrl = (url: string) => {
  try { const parsed = new URL(url); return `${parsed.origin}${decodeURIComponent(parsed.pathname).replace(/\/$/, '')}`; }
  catch { return url; }
};
export function createSelectedPhotoLibrary(city: string, options: PhotoAdoptionOptions & { library?: unknown } = {}) {
  const input = options.library ?? beijing;
  const library = Value.Check(SelectedLibrarySchema, input) && reviewName(input.city) === reviewName(city) ? input : undefined;
  const find = (name: string) => {
    const wanted = reviewName(name), primary = /^([^()]+)\([^()]+\)$/.exec(wanted)?.[1];
    const matches = (key: string) => library?.places.filter(p => [p.name, ...p.aliases].some(n => reviewName(n) === key)) ?? [];
    const exact = matches(wanted), result = exact.length ? exact : primary ? matches(primary) : [];
    return result.length === 1 ? result[0] : undefined;
  };
  const canonicalName = (name: string) => find(name)?.name ?? name;
  const adopt = createPhotoAdopter(options), pending = new Map<string, Promise<ReviewedCover | null>>();
  const coverFor = (name: string) => {
    const place = find(name);
    if (!place) return Promise.resolve(null);
    let result = pending.get(place.name);
    if (!result) {
      result = adopt(place.photos).catch(() => null);
      pending.set(place.name, result);
    }
    return result;
  };
  const acceptSupplement = (name: string, entry: PhotoAsset) => !(find(name)?.excluded ?? []).some(excluded =>
    excluded.url === entry.photo.url || excluded.sha256 && excluded.sha256 === entry.sha256 ||
    // 高德POI和小红书笔记都是集合页，排除其中一图不能牵连同页其他图片。
    entry.provider !== 'amap' && entry.photo.attribution?.source !== 'xhs' && excluded.sourceUrl && entry.photo.attribution?.sourceUrl &&
      workUrl(excluded.sourceUrl) === workUrl(entry.photo.attribution.sourceUrl));
  return { coverFor, canonicalName, acceptSupplement };
}

export function selectedFirstLookup(
  selected: ReturnType<typeof createSelectedPhotoLibrary>,
  reviewed: (name: string) => Promise<ReviewedCover | null>,
  enqueue: (name: string) => Promise<unknown>,
) {
  const fallback = reviewFirstLookup(reviewed, enqueue);
  return async (name: string) => await selected.coverFor(name) ?? fallback(selected.canonicalName(name));
}
