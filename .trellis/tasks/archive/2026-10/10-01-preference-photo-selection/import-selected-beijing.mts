// 将用户明确授权的固定快照转换为部署目录；不读取实时反馈，不发网络请求，不改原标记。
import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { Value } from '@sinclair/typebox/value';
import { SelectedLibrarySchema } from '../../../../../apps/server/src/integrations/selectedPhotos';
import { photoMime, writePhotoJson } from '../../../../../apps/server/src/integrations/photoReviewIO';
import { reviewDigest, validReviewedAttribution } from '../../../../../apps/server/src/integrations/reviewedPhotos';

const root = process.cwd();
const previous = path.join(root, '.trellis/tasks/09-30-ranked-place-photography/research');
const decisionFile = path.join(root, 'apps/server/src/data/photography/beijing-selection-decisions.json');
const decisions = JSON.parse(await readFile(decisionFile, 'utf8'));
const snapshotFile = path.join(previous, 'live/all-pools-feedback/snapshots', `${decisions.snapshotId}.json`);
const snapshotBytes = await readFile(snapshotFile);
const snapshot = JSON.parse(snapshotBytes.toString('utf8'));
const comparisonRoot = path.join(previous, 'live/all-pools');
const comparison = JSON.parse(await readFile(path.join(comparisonRoot, 'comparison.json'), 'utf8'));
assert.equal(snapshot.catalogVersion, comparison.selectionCatalogVersion);
const queryFiles = (await readdir(path.join(comparisonRoot, 'queries'))).filter(f => f.startsWith('unsplash-'));
const unsplash = (await Promise.all(queryFiles.map(async f => JSON.parse(await readFile(path.join(comparisonRoot, 'queries', f), 'utf8'))))).flatMap(q => q.results ?? []);
const library = { version: 1, city: '北京', snapshotId: snapshot.id, selectedAt: snapshot.createdAt, places: [] as any[] };
const held: any[] = [], included: any[] = [];
const apply = process.argv.includes('--apply');
async function localBytes(preview: string) {
  if (!preview.startsWith('media/')) return null;
  const file = path.resolve(comparisonRoot, preview);
  assert.ok(file.startsWith(comparisonRoot + path.sep), '预览路径必须位于对比目录');
  return readFile(file);
}
for (const group of snapshot.places) {
  const place = { name: group.place, aliases: decisions.aliases[group.place] ?? [], photos: [] as any[], excluded: [] as any[] };
  for (const candidate of group.candidates) {
    if (candidate.rating !== 'selected' && candidate.rating !== 'rejected') continue;
    const record = candidate.records[0];
    const reason = candidate.rating === 'selected' ? decisions.held[record.id] : undefined;
    if (candidate.rating === 'rejected' || reason) {
      for (const r of candidate.records) {
        const bytes = await localBytes(r.preview).catch(() => null);
        place.excluded.push({ url: r.preview.startsWith('https:') ? r.preview : '', sourceUrl: r.source === 'amap' ? '' : r.sourceUrl ?? '', sha256: bytes ? reviewDigest(bytes) : '' });
      }
      if (reason) held.push({ place: group.place, id: record.id, selectionKey: candidate.key, reason });
      continue;
    }
    const detail = comparison.candidates.find((r: any) => r.place === group.place && r.id === record.id && r.selectionKey === candidate.key);
    assert.ok(detail, `缺少来源元数据 ${group.place}/${record.id}`);
    const source = detail.underlyingSource ?? detail.source;
    const photo: any = { url: record.preview };
    const asset: any = { photo, sha256: '', selectionKey: candidate.key, identity: 'verified',
      evidence: decisions.evidence[record.id] ?? `结合已核对画面主体与来源记录：${detail.reviewDetail?.evidence ?? detail.evidence ?? detail.title}` };
    if (source === 'amap') asset.provider = 'amap';
    else photo.attribution = { source, photographer: detail.photographer, sourceUrl: detail.sourceUrl,
      license: detail.license, licenseUrl: source === 'commons' ? detail.licenseUrl.replace(/^http:/, 'https:').replace(/\/deed\.[a-z-]+\/?$/, '') : detail.licenseUrl,
      ...(detail.photographerUrl ? { photographerUrl: detail.photographerUrl } : {}),
      changes: source === 'unsplash' ? '官方hotlink，未裁切' : detail.changes ?? '复用已选图尺寸版本，未额外裁切' };
    if (source === 'unsplash') {
      const raw = unsplash.find((r: any) => r.urls?.regular === record.preview);
      assert.ok(raw?.links?.download_location, `缺少原始Unsplash采用端点 ${record.id}`);
      asset.downloadLocation = raw.links.download_location;
      asset.sha256 = reviewDigest(photo.url);
    } else if (source === 'amap') asset.sha256 = reviewDigest(photo.url);
    else {
      const bytes = await localBytes(record.preview);
      assert.ok(bytes && bytes.length <= 8 * 1024 * 1024 && photoMime(bytes), `无有效本地原选图 ${record.id}`);
      asset.sha256 = reviewDigest(bytes);
      const ext = photoMime(bytes) === 'image/jpeg' ? 'jpg' : photoMime(bytes) === 'image/png' ? 'png' : 'webp';
      photo.url = `/media/remote-photos/${asset.sha256}.${ext}`;
      if (apply) {
        const destination = path.join(root, 'data', photo.url.slice(1));
        await mkdir(path.dirname(destination), { recursive: true });
        await copyFile(path.join(comparisonRoot, record.preview), destination);
      }
    }
    assert.ok(validReviewedAttribution(asset), `署名或来源无效 ${record.id}`);
    place.photos.push(asset);
    included.push({ place: place.name, id: record.id, selectionKey: candidate.key, url: photo.url });
  }
  library.places.push(place);
}
assert.ok(Value.Check(SelectedLibrarySchema, library), JSON.stringify([...Value.Errors(SelectedLibrarySchema, library)]));
assert.equal(included.length + held.length, 64);
const report = { snapshotId: snapshot.id, snapshotSha256: reviewDigest(snapshotBytes), imported: included.length, selectedPlaces: library.places.filter(p => p.photos.length).length, included, held };
if (apply) {
  await writePhotoJson(path.join(root, 'apps/server/src/data/photography/beijing-selected.json'), library);
  await writePhotoJson(path.join(root, '.trellis/tasks/archive/2026-10/10-01-preference-photo-selection/research/selected-import.json'), report);
}
console.log(JSON.stringify({ applied: apply, imported: included.length, held: held.length, selectedPlaces: report.selectedPlaces }));
