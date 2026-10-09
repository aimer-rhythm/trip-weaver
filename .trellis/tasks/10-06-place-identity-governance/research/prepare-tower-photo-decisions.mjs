import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const read = file => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), 'utf8'));
const manifest = read('priority-cities/济南/tower-photos-01/manifest.json');
const sourceBytes = fs.readFileSync(new URL('priority-cities/济南/tower-photo-sources-01.json', import.meta.url));
assert.equal(createHash('sha256').update(sourceBytes).digest('hex'), manifest.sourceSha256);
const source = JSON.parse(sourceBytes);
const [entity] = source.entities;
assert.equal(entity.entityId, 'd4a51a5df56f78c9de0713d86ea8c00c');
assert.equal(entity.revision, 2); assert.deepEqual(entity.assignments, []);
assert.equal(manifest.images.length, 10); assert.equal(entity.independentSources.length, 10);
const page = read('priority-cities/济南/tower-fetch-commons-t10-01.json');
assert.equal(page.ok, true); assert.ok(page.content.includes('从超然楼望济南01'));
assert.ok(page.content.includes('Own work') && page.content.includes('Sprt98'));
const observations = {
  T01: '传统牌坊，无多层楼体；原来源明确南京，保持拒绝。',
  T02: '韩国水原华城石墙角楼，原来源明确Suwon Hwaseong，保持拒绝。',
  T03: '超然楼正面亮灯夜景，底部超然楼匾额可读；多层屋檐、底座及正面结构与T07一致。',
  T04: '高处斜俯拍超然楼及湖畔，主楼层级、两侧附属亭和白色连廊与已确认楼体一致；高德关联结合画面核查。',
  T05: '狭长河道两岸建筑，无超然楼；来源明确南京秦淮河，保持拒绝。',
  T06: '韩国水原华城石墙角楼近景，形制与超然楼不同，保持拒绝。',
  T07: '白天正面超然楼，底部匾额可读，楼体与T03一致；阴天偏暗不影响身份，不重排原审美选择。',
  T08: '林间寺庙入口，无超然楼楼体；来源为南京灵谷寺，保持拒绝。',
  T09: '传统门厅，无超然楼证据；来源为福建土楼，保持拒绝。',
  T10: '从高处俯瞰园林、水面和济南天际线，画面没有超然楼楼体。Commons作品页确认作者Sprt98自摄从超然楼望济南01，作为登楼观景视角绑定超然楼，不据此认领大明湖主体。',
};
const confirmed = new Set(['T03', 'T04', 'T07', 'T10']);
const rows = manifest.images.map(image => {
  const original = entity.independentSources.find(s => s.imageKey === image.imageKey);
  assert.ok(original && observations[image.label] && image.bytesSha256 && image.imageFile && !image.error);
  assert.equal(original.inputHash, image.inputHash); assert.equal(original.assetKey, image.assetKey);
  assert.equal(original.eligible, confirmed.has(image.label));
  if (confirmed.has(image.label)) {
    assert.ok(entity.relatedAssetSources.filter(s => s.assetKey === image.assetKey).every(s => s.catalogName === '超然楼'));
  }
  return { label: image.label, imageKey: image.imageKey, inputHash: image.inputHash, assetKey: image.assetKey,
    entityId: confirmed.has(image.label) ? entity.entityId : null,
    outcome: confirmed.has(image.label) ? 'confirmed_subject' : 'retain_existing_rejection',
    originalEligible: image.eligible, observation: observations[image.label], originalEvidence: image.entry.evidence,
    visualFile: `priority-cities/济南/tower-photos-01/${image.imageFile}`, bytesSha256: image.bytesSha256,
    ...(image.label === 'T10' ? { sourcePage: 'priority-cities/济南/tower-fetch-commons-t10-01.json', viewMeaning: 'view_from_tower' } : {}) };
});
const decision = { key: 'independent-photo-batch-03-jinan-20261008', city: '济南',
  expectedEntityRevisions: { [entity.entityId]: entity.revision },
  images: rows.filter(r => confirmed.has(r.label)).map(r => ({ imageKey: r.imageKey, inputHash: r.inputHash, entityId: r.entityId, expectedRevision: 0 })),
  evidence: rows.filter(r => confirmed.has(r.label)) };
const folder = new URL('independent-photo-batch-03/', import.meta.url);
assert.equal(fs.existsSync(folder), false); fs.mkdirSync(folder);
fs.writeFileSync(new URL('decisions.json', folder), JSON.stringify([decision], null, 2) + '\n', { flag: 'wx' });
fs.writeFileSync(new URL('visual-review.json', folder), JSON.stringify({ reviewed: 10, confirmed: 4, retainedRejected: 6,
  sourceSha256: manifest.sourceSha256, rows, note: '四图绑定；原六拒绝不重复写null。原目录、视角和排序保持，正式入口最多三图。' }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ folder: 'independent-photo-batch-03', reviewed: 10, confirmed: 4, retainedRejected: 6 }));
