import fs from 'node:fs';
import assert from 'node:assert/strict';
const read = file => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), 'utf8'));
const manifest = read('priority-cities/济南/cultural-photos-01/manifest.json');
const verified = read('priority-cities/济南/cultural-downstream-check-03.json');
assert.deepEqual(verified.failures, []); assert.equal(manifest.images.length, 22);
assert.equal(verified.independentLibrary.bindings, 0);
const observations = {
  M01: '夜间多层欧式商业楼，非馆舍；来源明确Harbin，不归山东博物馆。',
  M02: '山峦云雾，无博物馆；来源为多洛米蒂山。',
  M03: '花田与高原山丘，无博物馆；来源称西藏高原。',
  M04: '垂柳、泉池、园林廊亭；来源为趵突泉，非山东博物馆。',
  M05: '现代灰色馆舍、顶端弧形采光结构、正面金色山东博物馆馆名可读，与当前经十路新馆相符；来源高德关联经画面独立复核。',
  M06: '传统水榭与池塘，非馆舍；来源称南京。',
  M07: '自然雪山针叶林，非博物馆。',
  M08: '画像与标语可辨的天安门城楼，非山东博物馆。',
  M09: '园林泉池与垂柳；来源为趵突泉，非山东博物馆。',
  M10: '国立中山大学牌坊馆名字样明确，与目标博物馆不同。',
  M11: '高山草甸与岩峰，非博物馆。',
  M12: '方形多层佛塔；来源为西安大雁塔，非山东博物馆。',
  M13: '湖畔传统红柱亭阁，来源大明湖，非现代博物馆。',
  C01: '山间东亚寺庙建筑，无目标双塔教堂；来源称韩国Jinan County，不把城市同拼音判等。',
  C02: '红瓦屋顶前景、塔楼与立面形制和洪家楼不符；没有济南地点证据。',
  C03: '雪景教堂侧立面，双塔、带叶饰尖顶、侧面扶壁与相连院落建筑可辨；Commons作品明确Hongjialou Cathedral Jinan，与C09本体互证。',
  C04: '双塔红色坡屋顶、横向平直立面，与洪家楼石质叶饰尖顶及密集拱窗不同；来源无济南限定。',
  C05: '自然山峦雾景，不是教堂。',
  C06: '花园前教堂长侧立面及相连附属院落，不是正门全景；Commons作品明确济南山东大学旁Sacred Heart Cathedral，侧墙、窗及院落与C03互证。纠正旧模型将此视为双塔正面的说明，但不改原目录。',
  C07: '夜景主入口右侧为单座高塔，中央尖拱窗及左侧低塔布局与洪家楼对称双塔正立面不同；来源只是泛称Gothic cathedral，没有济南证据。旧模型match不能成立，撤销可用归属，不猜其他城市。',
  C08: '教堂内部拱顶及管风琴，没有洪家楼具体地点证据；原目录已拒绝，保持不使用。',
  C09: '双塔正立面，叶饰尖顶、玫瑰窗、三尖拱门、塔楼窗与精细石构件清楚；Commons作品明确Sacred-Heart-Cathedral-Jinan及Hongjialou名称，认领现行教堂主体。',
};
const confirmed = new Set(['M05', 'C03', 'C06', 'C09']);
const toGovern = new Set([...confirmed, 'C07']);
const rows = manifest.images.map(image => {
  assert.ok(observations[image.label]); assert.ok(image.imageFile && !image.error && image.bytesSha256);
  const entityId = confirmed.has(image.label) ? image.entityId : null;
  if (entityId) assert.equal(image.eligible, true);
  return { label: image.label, imageKey: image.imageKey, inputHash: image.inputHash, assetKey: image.assetKey,
    entityId, outcome: entityId ? 'confirmed_subject' : image.label === 'C07' ? 'withdraw_wrong_positive' : 'retain_existing_rejection',
    originalEligible: image.eligible, observation: observations[image.label], originalEvidence: image.entry.evidence,
    visualFile: `priority-cities/济南/cultural-photos-01/${image.imageFile}`, bytesSha256: image.bytesSha256 };
});
const decision = { key: 'independent-photo-batch-02-jinan-20261008', city: '济南',
  expectedEntityRevisions: { '6ed737543bd4e4f550f0fd357c9e8c71': 2, '2caab5c5038a94f91657ae16110dd56e': 2 },
  images: rows.filter(r => toGovern.has(r.label)).map(r => ({ imageKey: r.imageKey, inputHash: r.inputHash, entityId: r.entityId, expectedRevision: 0 })),
  evidence: rows.filter(r => toGovern.has(r.label)) };
assert.equal(decision.images.length, 5);
const folder = new URL('independent-photo-batch-02/', import.meta.url);
assert.equal(fs.existsSync(folder), false); fs.mkdirSync(folder);
fs.writeFileSync(new URL('decisions.json', folder), JSON.stringify([decision], null, 2) + '\n', { flag: 'wx' });
fs.writeFileSync(new URL('visual-review.json', folder), JSON.stringify({ reviewed: 22, confirmed: 4,
  wrongPositive: 1, retainedRejected: 17, rows, note: '只绑定4图及撤销1个错误正例；17条已有拒绝不重复写空分配，避免无意阻断其他目录同资产的正确归属。' }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ folder: 'independent-photo-batch-02', reviewed: 22, confirmed: 4, withdrawn: 1, retainedRejected: 17 }));
