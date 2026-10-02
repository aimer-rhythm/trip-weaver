// 离线复核真实目录和正式调研工具；Unsplash采用回执模拟成功，不产生外部采用或新行程。
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { Value } from '@sinclair/typebox/value';
import { createSelectedPhotoLibrary, selectedFirstLookup, SelectedLibrarySchema } from '../../../../../apps/server/src/integrations/selectedPhotos';
import { createReviewedCoverLookup, verifiedPhotoBytes, validReviewedAttribution, reviewDigest, type PhotoAsset } from '../../../../../apps/server/src/integrations/reviewedPhotos';
import { buildResearchTools, type ResearchOutcome } from '../../../../../apps/server/src/generation/tools/researchTools';

const root = process.cwd();
const output = path.join(root, '.trellis/tasks/archive/2026-10/10-01-preference-photo-selection/research');
const library = JSON.parse(await fs.readFile(path.join(root, 'apps/server/src/data/photography/beijing-selected.json'), 'utf8'));
assert.ok(Value.Check(SelectedLibrarySchema, library));
const assets = library.places.flatMap(place => place.photos);
const local = assets.filter(asset => asset.photo.url.startsWith('/media/'));
for (const asset of assets) assert.ok(validReviewedAttribution(asset), asset.selectionKey);
for (const asset of local) assert.ok(await verifiedPhotoBytes(asset), asset.photo.url);

const simulatedAdoptions: string[] = [];
const options = { adoptUnsplash: async (asset: PhotoAsset) => { simulatedAdoptions.push(asset.photo.url); return true; } };
const selected = createSelectedPhotoLibrary('北京', options);
const reviewed = createReviewedCoverLookup('北京', { ...options, acceptPhoto: selected.acceptSupplement });
const queued: string[] = [];
const lookup = selectedFirstLookup(selected, reviewed, async name => { queued.push(name); });
const outcome: ResearchOutcome = { summary: '', pool: [], locations: new Map() };
const selfCheck = async () => ({ configured: false, checked: false, ok: true, message: '' });
const tools = buildResearchTools({ destination: '北京', searchWebMax: 0, outcome,
  poiSource: { kind: 'null', searchPois: async () => [], selfCheck },
  searchSource: { kind: 'null', search: async () => [], selfCheck },
  reviewedCover: lookup,
  curatedCover: async () => assert.fail('正式选图不得回退到旧精选'),
  storedCover: async () => assert.fail('正式选图不得回退到旧图库'),
});
const add = tools.find(tool => tool.name === 'add_candidate')!;
const rows = [];
for (const place of library.places) {
  await add.execute(place.name, { name: place.name, category: 'attraction', intro: '北京选图验收预览' });
  const candidate = outcome.pool.at(-1)!;
  const chosen = await selected.coverFor(place.name);
  if (chosen) assert.deepEqual(candidate.photos, chosen.photos, `${place.name}不得混入自动补图`);
  if (candidate.photos?.length) {
    assert.ok(candidate.photos.length <= 3);
    assert.equal(candidate.coverUrl, candidate.photos[0]!.url);
    assert.deepEqual(candidate.coverAttribution, candidate.photos[0]!.attribution);
  }
  rows.push({ ...candidate, source: chosen ? 'user-selected' : candidate.photos?.length ? 'reviewed-supplement' : 'queued', selectedCount: place.photos.length });
  for (const alias of place.aliases) assert.deepEqual(await lookup(alias), await lookup(place.name), `${alias}与主名称一致`);
}
await new Promise(resolve => setImmediate(resolve));

async function localHttp(url: string): Promise<{ status: number; mime: string; bytes: Buffer }> {
  return new Promise((resolve, reject) => {
    const request = http.get(new URL(url, 'http://127.0.0.1:8787'), { timeout: 5000 }, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode ?? 0, mime: response.headers['content-type'] ?? '', bytes: Buffer.concat(chunks) }));
      response.on('error', reject);
    });
    request.on('error', reject);
    request.on('timeout', () => request.destroy(new Error('本地图片HTTP超时')));
  });
}
const httpChecks = [];
for (const asset of local) {
  const result = await localHttp(asset.photo.url);
  assert.equal(result.status, 200, asset.photo.url);
  assert.match(result.mime, /^image\//);
  assert.equal(reviewDigest(result.bytes), asset.sha256);
  httpChecks.push({ url: asset.photo.url, status: result.status, mime: result.mime, bytes: result.bytes.length });
}
const summary = { places: rows.length, selectedPlaces: rows.filter(row => row.source === 'user-selected').length,
  selectedAssets: assets.length, displayedPhotos: rows.reduce((sum, row) => sum + (row.photos?.length ?? 0), 0),
  localFiles: local.length, localHttpPassed: httpChecks.length, queued: [...new Set(queued)], simulatedAdoptions: simulatedAdoptions.length };
const result = { at: new Date().toISOString(), snapshotId: library.snapshotId,
  mode: '真实目录与正式add_candidate离线回放，Unsplash采用回执模拟成功；不生成行程、不写真实队列', summary, rows, httpChecks };
await fs.writeFile(path.join(output, 'selected-replay-result.json'), JSON.stringify(result, null, 2) + '\n');

const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const label = { 'user-selected': '你的已选照片', 'reviewed-supplement': '审核补图', queued: '暂无合格照片' };
const sections = rows.map(row => `<section><h2>${escape(row.name)} <small>${label[row.source as keyof typeof label]}</small></h2><div class="photos">${(row.photos ?? []).map((photo, index) => {
  const src = photo.url.startsWith('/media/') ? `http://127.0.0.1:8787${photo.url}` : photo.url;
  const credit = photo.attribution;
  return `<figure><img src="${escape(src)}" alt="${escape(row.name)} · 第${index + 1}张"><figcaption>${index === 0 ? '封面' : `第${index + 1}张`} · ${credit ? `<a href="${escape(credit.sourceUrl)}">${escape(credit.photographer)} / ${escape(credit.source)}</a> · <a href="${escape(credit.licenseUrl)}">${escape(credit.license)}</a>` : '高德原始图片'}</figcaption></figure>`;
}).join('') || '<p>本次保持文字卡；后台审核完成后供后续新行程使用。</p>'}</div></section>`).join('');
await fs.writeFile(path.join(output, 'selected-preview.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>北京 · 已选照片验收预览</title><style>body{margin:0;background:#f5f3ed;color:#24332b;font:16px/1.65 system-ui,sans-serif}main{max-width:1140px;margin:auto;padding:32px 20px}h1{font-size:32px;margin:0}h2{font-size:22px;margin:0 0 14px}small{display:inline-block;font-size:13px;font-weight:400;color:#586d60;background:#e5eadf;padding:3px 10px;border-radius:20px}section{margin:32px 0;padding:22px;background:white;border-radius:16px}.photos{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}figure{margin:0;min-width:0}img{width:100%;height:230px;object-fit:contain;background:#f5f3ed;border-radius:8px}figcaption{font-size:12px;overflow-wrap:anywhere}a{color:#356a4f}p{color:#59665e}@media(max-width:650px){main{padding:20px 12px}h1{font-size:26px}.photos{grid-template-columns:1fr}section{padding:16px}img{height:240px}}</style><main><h1>北京 · 你的已选照片</h1><p>21 个景点优先使用你保存的照片，最多展示三张；已有一张可用图就不混入自动补图。下面同时列出审核补图和仍缺图的地点。</p><p>此页用于确认照片和顺序，不保存或修改行程。完整选图保留 49 张，15 张因地点错配或证据不足暂缓采用。</p>${sections}</main></html>`);
console.log(JSON.stringify(summary));
