// 原目录只读；将选图/审图来源转成稳定逐图输入，不复制或改写作品。
import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { Value } from '@sinclair/typebox/value';
import beijing from '../data/photography/beijing-selected.json';
import { SelectedLibrarySchema, isPhotoExcluded, type SelectedLibrary, type SelectedPhoto } from '../integrations/selectedPhotos';
import { ReviewedCatalogSchema, reviewedCatalogFile, eligibleReview, reviewName, verifiedPhotoBytes,
  validReviewedAttribution, type ReviewedCatalog, type ReviewedPhoto } from '../integrations/reviewedPhotos';
import { PHOTO_DATA } from '../integrations/stockPhotoSupport';

export function photoIdentityJson(value: unknown): string {
  const stable = (input: unknown): unknown => Array.isArray(input) ? input.map(stable) :
    input && typeof input === 'object' ? Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, v]) => [key, stable(v)])) : input;
  return JSON.stringify(stable(value));
}
export const photoIdentityDigest = (value: unknown): string => createHash('sha256').update(photoIdentityJson(value)).digest('hex');
export type IndependentPhotoSource = {
  kind: 'selected' | 'reviewed'; city: string; catalogName: string; aliases: string[];
  imageKey: string; inputHash: string; assetKey: string; eligible: boolean;
  entry: SelectedPhoto | ReviewedPhoto;
};
export type IndependentPhotoSources = {
  selected?: SelectedLibrary; reviewed: ReviewedCatalog[]; sources: IndependentPhotoSource[]; warnings: string[];
};
export interface IndependentPhotoSourceOptions {
  dataRoot?: string; library?: unknown; reviewed?: readonly unknown[];
  /** 在线候选读取只生成指纹，实际采用仍逐图校验字节；治理冻结默认完整校验。 */
  verifyBytes?: boolean;
}

export async function loadIndependentPhotoSources(city: string, options: IndependentPhotoSourceOptions = {}): Promise<IndependentPhotoSources> {
  const root = options.dataRoot ?? PHOTO_DATA;
  const warnings: string[] = [];
  const input = options.library ?? beijing;
  const selected = Value.Check(SelectedLibrarySchema, input) && reviewName(input.city) === reviewName(city) ? input : undefined;
  let catalogInputs = options.reviewed;
  if (!catalogInputs) {
    const dir = path.dirname(reviewedCatalogFile(city, '_', root));
    let files: string[] = [];
    try { files = (await readdir(dir)).filter(f => /^[a-f0-9]{64}\.json$/.test(f)).sort(); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    catalogInputs = await Promise.all(files.map(async file => {
      try {
        const target = path.join(dir, file);
        if ((await stat(target)).size > 4 * 1024 * 1024) throw new Error('oversize');
        return JSON.parse(await readFile(target, 'utf8')) as unknown;
      } catch { warnings.push(`unreadable_reviewed_catalog:${file}`); return null; }
    }));
  }
  const reviewed = catalogInputs.filter((row): row is ReviewedCatalog =>
    Value.Check(ReviewedCatalogSchema, row) && reviewName(row.city) === reviewName(city));
  const sources: IndependentPhotoSource[] = [];
  const add = async (kind: IndependentPhotoSource['kind'], name: string, aliases: string[], context: unknown,
    entry: SelectedPhoto | ReviewedPhoto, key: unknown, quality: boolean) => {
    const remote = entry.provider === 'amap' || entry.photo.attribution?.source === 'unsplash';
    const assetKey = `${remote ? 'official_url' : 'local_bytes'}:${entry.sha256}`;
    const available = validReviewedAttribution(entry) && (remote
      ? createHash('sha256').update(entry.photo.url).digest('hex') === entry.sha256
      : options.verifyBytes === false || !!await verifiedPhotoBytes(entry, root));
    sources.push({ kind, city, catalogName: name, aliases, entry,
      imageKey: `${kind}:${photoIdentityDigest(key)}`, assetKey, eligible: available && quality,
      inputHash: photoIdentityDigest({ version: 1, kind, city, context, entry, available, quality, assetKey }) });
  };
  for (const group of selected?.places ?? []) {
    for (const [position, entry] of group.photos.entries()) {
      await add('selected', group.name, group.aliases,
        { version: selected!.version, snapshotId: selected!.snapshotId, selectedAt: selected!.selectedAt,
          name: group.name, aliases: group.aliases, excluded: group.excluded, position }, entry,
        [reviewName(city), selected!.snapshotId, entry.selectionKey], entry.identity === 'verified' && !isPhotoExcluded(group.excluded, entry));
    }
  }
  for (const catalog of reviewed) {
    for (const entry of catalog.entries) {
      await add('reviewed', catalog.name, catalog.aliases,
        { version: catalog.version, name: catalog.name, aliases: catalog.aliases }, entry,
        [reviewName(city), reviewName(catalog.name), entry.sha256], eligibleReview(entry.review));
    }
  }
  if (new Set(sources.map(source => source.imageKey)).size !== sources.length) {
    throw new Error('独立图库有重复图片身份，须先核实原目录');
  }
  return { selected, reviewed, sources, warnings };
}
