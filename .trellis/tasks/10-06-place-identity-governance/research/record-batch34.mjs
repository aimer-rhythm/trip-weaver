// 仅补写已完成第34批的任务记录，不运行应用、同步、提交或归档。
import fs from 'node:fs';
import assert from 'node:assert/strict';
const url = file => new URL(file, import.meta.url);
const read = file => JSON.parse(fs.readFileSync(url(file), 'utf8'));
const write = (file, data, exclusive = true) => fs.writeFileSync(url(file), JSON.stringify(data, null, 2) + '\n', { flag: exclusive ? 'wx' : 'w' });
const pointer = read('cleaning-scope/current.json');
assert.equal(pointer.latestAppliedEntityBatch, 33);
for (const file of ['priority-cities/济南/review-05.json', 'priority-cities/济南/review-05.md', 'cleaning-scope/current-before-batch34.json']) {
  assert.equal(fs.existsSync(url(file)), false, file);
}
const sync = read('all-cities/batch-34/sync-01/sync-state.json').cities['济南'];
assert.ok(sync.importedAt && sync.relationsImportedAt && sync.embeddingRunAt);
assert.equal(sync.places, 228); assert.equal(sync.relationSnapshotRevision, 8);
const verification = read('all-cities/batch-34/sync-01/verification-vectors.json');
assert.deepEqual(verification.failures, []);
assert.equal(verification.cities[0].active, 222);
assert.equal(verification.cities[0].vectorProbes.length, 1);
assert.equal(verification.cities[0].vectorProbes[0].diagnostics.vector, 'used');
assert.equal(verification.cities[0].withdrawals.length, 6);
assert.ok(verification.cities[0].withdrawals.every(w => w.diagnostics.vector === 'used' && w.sqlExcluded));
const boundary = read('all-cities/batch-34/sync-01/boundary-check.json');
assert.deepEqual(boundary.failures, []); assert.equal(boundary.assigned, 22); assert.equal(boundary.pending, 38);
const source = read('all-cities/batch-34-upstream-check.json');
assert.equal(source.rawSourcesUnchanged, 107); assert.equal(source.originalMentionsUnchanged, 662);
assert.equal(source.originalNotesCovered, 82); assert.deepEqual(source.failures, []);
const flow = read('all-cities/flow/run-36/report.json');
assert.deepEqual(flow.failures, []); assert.equal(read('all-cities/flow/run-36/cleanup.json').removed, true);
const sum = key => flow.cities.reduce((n, c) => n + c[key].length, 0);
assert.equal(sum('probes'), 282); assert.equal(sum('negativeProbes'), 113); assert.equal(sum('withdrawalProbes'), 47);
const audit = read('all-cities/audit/run-32/report.json');
assert.deepEqual(audit.failures, []);
assert.equal(audit.cities.reduce((n, c) => n + (c.statuses.PENDING ?? 0), 0), 236);
const detail = read('priority-cities/济南/baotu-source-review-01.json');
const ledger = read('priority-cities/济南/review-04.json');
assert.equal(ledger.rows.length, 98); assert.equal(detail.rows.length, 60);
ledger.createdAt = new Date().toISOString(); ledger.previousLedger = 'priority-cities/济南/review-04.json';
const park = ledger.rows.find(r => r.entityId === 'd14cc0c8a631defad91e60d475b7aedd');
const mixed = ledger.rows.find(r => r.entityId === '8808e16f1472d0df17bed729a2e54e83');
for (const row of [park, mixed]) {
  assert.ok(row);
  Object.assign(row, { currentEntityId: row.entityId, currentName: row.name, changeBatch: 34, currentRevision: 3,
    governedSourceIds: [5349, 5366], scopeMentionIds: detail.rows.map(r => r.mentionId),
    pendingScopeMentionIds: detail.rows.filter(r => !r.entityId).map(r => r.mentionId),
    evidenceFiles: ['priority-cities/济南/baotu-source-review-01.json', 'all-cities/batch-34-applied.json',
      'all-cities/batch-34-upstream-check.json', 'all-cities/batch-34/sync-01/boundary-check.json',
      'all-cities/batch-34/sync-01/verification-vectors.json'] });
}
Object.assign(park, { status: 'reviewed_scope_partial',
  currentMentionIds: detail.rows.filter(r => r.entityId === park.entityId).map(r => r.mentionId),
  dimensions: { identity: '22_park_mentions_confirmed_38_scope_mentions_pending', category: 'reviewed_nature',
    location: 'reviewed_reference_point', media: 'reviewed_empty_managed_gallery' },
  followup: '两源60提及/51原文已逐条核对，22条归公园，38条主体或语境不明确仍待补证。自然类别及本体参考点已核实；裸名、主泉、门口和码头不自动认领为公园。审核364未关闭。' });
Object.assign(mixed, { status: 'mixed_source_withdrawn_assignment_pending', currentMentionIds: [],
  dimensions: { identity: 'mixed_id_withdrawn_without_redirect', category: 'withdrawn',
    location: 'withdrawn_not_a_core_point', media: 'reviewed_empty_managed_gallery' },
  followup: '旧混合裸名ID显式撤回、不重定向，错误酒店坐标保持清空；22条已确认公园提及逐条归公园，38条保留null。不伪造主泉实体或删除原入选行。' });
Object.assign(ledger.summary, { partiallyReviewedScopeRows: 4, governedScopeMentions: 103,
  confirmedParkMentions: 47, pendingScopeMentions: 56, otherPendingPrimaryRows: 86, remainingPrimaryToReview: 90,
  scopeProgressMeaning: '原98行保留：4非地点排除、4行归一自查；90未完成中4行泉池/公园部分治理，另86行继续。新增待审为五龙潭18及趵突泉38条提及。' });
const progress = 'scope06固定978主体+56依赖/1135源。第34批趵突泉60提及/51原文已核查，22归公园、38待补证；混合旧ID撤回不重定向。228行（222有效+6撤回）/21关系（10强边）已双同步；真实检索/向量/旧ID/原源/历史行程检查通过。flow/run-36为282正例/113独立包含/47撤回0失败，audit/run-32为236PENDING。范围内50实体对+56提及=106审核行，另4必去缺口。济南98行中4非地点、4行归一自查、90未完成（4行部分治理、其余86继续），7仍待定位。01-v2至34禁止重放，无batch35或待同步步骤。未验收，不提交归档。';
write('priority-cities/济南/review-05.json', ledger);
fs.writeFileSync(url('priority-cities/济南/review-05.md'), '# 济南98项重点清单核查台账（第34批后）\n\n'
  + ledger.summary.scopeProgressMeaning + '7项仍待定位；整城未验收。\n\n'
  + '| 原入选名称 | 现行名称 | 版本 | 进度 | 说明 |\n| --- | --- | ---: | --- | --- |\n'
  + ledger.rows.map(r => `| ${r.name} | ${r.currentName ?? r.name} | ${r.currentRevision} | ${r.status} | ${r.followup} |`).join('\n') + '\n', { flag: 'wx' });
write('cleaning-scope/current-before-batch34.json', pointer);
Object.assign(pointer, { latestAppliedEntityBatch: 34, latestFlow: '../all-cities/flow/run-36', latestAudit: '../all-cities/audit/run-32',
  cityReviewLedgers: { ...pointer.cityReviewLedgers, 济南: '../priority-cities/济南/review-05.json' },
  progressUpdatedAt: new Date().toISOString(), progressNote: progress,
  currentScopeReviews: { frozenEntityPairs: 50, addedPendingMentions: 56, currentReviewRows: 106, referenceNeedsReview: 4,
    evidence: ['../priority-cities/济南/wulongtan-source-review-01.json', '../priority-cities/济南/baotu-source-review-01.json'],
    meaning: '18+38条提及已读但主体证据不足，scope保持null；原50重点实体对未关闭，固定scope06统计不作实时统计。' } });
write('cleaning-scope/current.json', pointer, false);
const task = read('../task.json'); assert.equal(task.status, 'in_progress');
task.notes = '云南不处理，九城持续至明确验收。' + progress + '最新research/batch34-jinan-baotu-20261008.md；89普通长尾及37已隔离错城来源归属待审保留。';
write('../task.json', task, false);
const prdPath = url('../prd.md');
let prd = fs.readFileSync(prdPath, 'utf8');
const scopeStart = prd.indexOf('- 用户最新明确：');
const scopeEnd = prd.indexOf('\n\n', scopeStart);
assert.ok(scopeStart >= 0 && scopeEnd > scopeStart);
prd = prd.slice(0, scopeStart) + '- 用户最新明确：**云南不处理，继续其他城市直到验收通过**。当前九城固定978主体＋56依赖/1135源，50重点实体对及4必去缺口不变。第33/34批新增18＋38条范围内提及待审，现106审核行；原scope06统计保持冻结。云南、89普通长尾及37已隔离来源归属待审不扩入主动清洗范围。持续实施不等于预先验收。' + prd.slice(scopeEnd);
prd = prd.replace('## 已知事实\n', '## 已知事实\n\n### 最新进展：第34批趵突泉逐提及治理已同步\n\n' + progress + '详见[第34批记录](research/batch34-jinan-baotu-20261008.md)。以下为历史快照。\n');
fs.writeFileSync(prdPath, prd);
const resume = url('nine-cities-continuation-20261007.md');
let resumeText = fs.readFileSync(resume, 'utf8');
resumeText = resumeText.replace('## 本轮断点\n', '## 本轮断点\n\n最新为[第34批记录](batch34-jinan-baotu-20261008.md)。' + progress + '接着完成两博物馆只读核查、教堂位置和普通地点；已有第34批不得重放。以下为历史断点。\n');
fs.writeFileSync(resume, resumeText);
for (const context of ['implement', 'check']) {
  const file = url(`../${context}.jsonl`);
  const entry = { file: '.trellis/tasks/10-06-place-identity-governance/research/batch34-jinan-baotu-20261008.md', reason: '第34批已同步及九城剩余范围；旧批次禁止重放，继续普通地点核查' };
  if (!fs.readFileSync(file, 'utf8').includes(entry.file)) fs.appendFileSync(file, JSON.stringify(entry) + '\n');
}
console.log(JSON.stringify({ batch: 34, ledger: 'review-05', assignedMentions: 22, pendingMentions: 38,
  currentInScopeReviewRows: 106, remainingPrimaryRows: 90, taskStatus: task.status }));
