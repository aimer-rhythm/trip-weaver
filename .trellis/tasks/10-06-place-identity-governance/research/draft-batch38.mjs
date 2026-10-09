// 街道位置纠错；所有输入冻结在任务内，原源、提及及图库不改写。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const file = f => new URL(f, import.meta.url);
const read = f => JSON.parse(fs.readFileSync(file(f), 'utf8'));
const hash = f => createHash('sha256').update(fs.readFileSync(file(f))).digest('hex');
const write = (f, value) => fs.writeFileSync(file(f), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const pointer = read('cleaning-scope/current.json');
assert.equal(pointer.latestAppliedEntityBatch, 37);
assert.ok(!pointer.policy.excludedCities.includes('济南'));
const sourceFile = 'priority-cities/济南/streets-source-packet-01.json';
const packet = read(sourceFile);
const baselineFile = 'all-cities/batch-38-baseline.json';
assert.equal(hash(baselineFile), '59165aaa143c35788b4ec3981d9f512733afd257ab8a4e04f609d51af25c31bc');
const baseline = read(baselineFile);
const g = packet.groups.find(g => g.entity.canonical_name === '西更道街');
const { places, ...entity } = baseline.entities.find(e => e.entity_id === g.entity.entity_id);
assert.deepEqual(entity, g.entity);
assert.deepEqual(places.map(p => p.id).sort(), [5391, 5949]);
const geoFile = 'priority-cities/济南/geo-11.json', geo = read(geoFile);
const target = geo.find(p => p.query === '西更道街' && p.name === '西更道街');
const wrong = geo.find(p => p.query === '西更道街' && p.name === '源泉');
assert.ok(target && wrong);
assert.equal(wrong.address, '西更道街20号');
for (const p of g.sources) {
  assert.equal(p.lat, wrong.gcj02.latitude);
  assert.equal(p.lng, wrong.gcj02.longitude);
}
assert.equal(entity.revision, 2);
const note = packet.notes.find(n => n.id === 2813);
const quote = '西更道（连接泉城路和曲水亭街的老街道）';
assert.ok(note.note_desc.includes(quote));
const durationNote = packet.notes.find(n => n.id === 2570);
assert.ok(durationNote.note_desc.includes('13:30-14:30📍西更道街'));
for (const mid of [11457, 12723]) assert.equal(packet.mentions.find(m => m.id === mid).fact_value.minutes, 60);
const evidenceFile = 'priority-cities/济南/streets-location-review-01.json';
write(evidenceFile, {
  city: '济南', entityId: entity.entity_id, name: entity.canonical_name,
  currentRevision: 2, sourceFile, sourceSha256: hash(sourceFile), geoFile, geoSha256: hash(geoFile),
  sourceIds: g.sourceIds, mentionIds: g.mentionIds, noteId: 2813, quote,
  oldReference: wrong, newReference: target,
  conclusion: '原两源及现行位置精确对应西更道街20号的源泉POI；以完整路线原文确认街道主体，改用同名街道参考点。街道与源泉、碧玉泉、街边餐馆、两处文字墙及曲水亭街保持独立。',
  facts: '2570的13:30–14:30是该街独立游览时段，保留60分钟；正文沿街小店及文字墙描述不扩为餐厅身份或别名。',
  scope: '仅修改实体地理覆盖；不改原source、theme、place_type、原始提及、别名或提及分配。',
});
const decision = {
  key: 'all-cities-20261008-batch-38-xigeng-street-location', city: '济南',
  entityId: entity.entity_id, canonicalName: entity.canonical_name, aliases: [], mergeEntityIds: [],
  expectedRevisions: { [entity.entity_id]: 2 },
  overrides: { lat: target.gcj02.latitude, lng: target.gcj02.longitude, address: target.address, geoStatus: 'resolved' },
  evidence: [{ kind: 'reviewed_street_reference_point', file: evidenceFile, sha256: hash(evidenceFile),
    sourcePlaceIds: g.sourceIds, mentionIds: g.mentionIds, noteId: 2813, quote,
    conclusion: '从源泉POI改为同名西更道街参考点，保留街道独立身份和原60分钟来源。' }],
};
write('all-cities/batch-38-source.json', { readOnly: true, city: '济南', baselineFile,
  baselineSha256: hash(baselineFile), sourceFile, sourceSha256: hash(sourceFile), group: g, noteIds: g.noteIds,
  geoFile, geoSha256: hash(geoFile) });
write('all-cities/batch-38-decisions.json', [decision]);
write('all-cities/batch-38-export-expectations.json', [{ city: '济南', id: entity.entity_id,
  name: entity.canonical_name, revision: 3, verified: true }]);
console.log(JSON.stringify({ batch: 38, locationCorrections: 1, merges: 0, scopeChanges: 0, sourceSha256: hash('all-cities/batch-38-source.json') }));
