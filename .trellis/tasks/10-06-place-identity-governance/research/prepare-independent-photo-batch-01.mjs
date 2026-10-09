// 只从已冻结并逐图核对的八张原选图生成请求，不依名称自动批准其他目录。
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const freeze = JSON.parse(await readFile(new URL('independent-photo-freeze-01.json', import.meta.url), 'utf8'));
const library = await readFile('apps/server/src/data/photography/beijing-selected.json');
const targets = [
  { name: '北海公园', id: '4c43da4bfc3095a1bd5b60ed08a0b15d', revision: 2, count: 6,
    observations: ['琼华岛、白塔及湖面落日', '永安桥、牌楼、后方琼华岛白塔', '琼华岛白塔与山体近景',
      '永安桥、牌楼、白塔及结冰湖面', '琼华岛白塔、湖岸长廊及山门', '琼华岛白塔、岸边石桥及倒影'] },
  { name: '八达岭长城', id: '4d453b43bd9156f2b638278e661c924f', revision: 1, count: 2,
    observations: ['山脊长城及敌楼；具体段落沿用已核实Commons作品115371400说明及分类',
      '长城城墙、敌楼与山地；具体段落沿用已核实Commons作品32396898说明及分类'] },
];
const evidence = [], images = [], expectedEntityRevisions = {};
for (const target of targets) {
  const group = freeze.results[0].catalogs.find(c => c.kind === 'selected' && c.name === target.name);
  assert.equal(group.images.length, target.count);
  assert.ok(group.resolutions.every(r => r.status === 'resolved' && r.entityId === target.id && r.revision === target.revision));
  expectedEntityRevisions[target.id] = target.revision;
  for (const [i, image] of group.images.entries()) {
    assert.equal(image.eligible, true);
    assert.ok(image.localPath);
    images.push({ imageKey: image.imageKey, inputHash: image.inputHash, entityId: target.id, expectedRevision: 0 });
    evidence.push({ imageKey: image.imageKey, entityId: target.id, selectionKey: image.selectionKey,
      originalEvidence: image.evidence, observation: target.observations[i],
      contact: 'research/independent-photo-batch-01/contact.jpg', position: i + 1,
      basis: '保留原人工选图与顺序；来源与本轮画面核对确认地点边界，不新增审美筛选',
      librarySha256: createHash('sha256').update(library).digest('hex') });
  }
}
await writeFile(new URL('independent-photo-batch-01/decisions.json', import.meta.url),
  JSON.stringify([{ key: 'independent-photo-batch-01-beijing-20261007', city: '北京', expectedEntityRevisions, images, evidence }], null, 2), { flag: 'wx' });
console.log(JSON.stringify({ entities: targets.length, photos: images.length, apply: false }));
