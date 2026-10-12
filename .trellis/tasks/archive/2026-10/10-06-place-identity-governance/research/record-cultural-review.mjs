// 成功证据齐备后推进逐项台账；不应用数据、不提交或归档。
import fs from 'node:fs';
import assert from 'node:assert/strict';
const url = name => new URL(name, import.meta.url);
const read = name => JSON.parse(fs.readFileSync(url(name), 'utf8'));
const write = (name, value, exclusive = true) => fs.writeFileSync(url(name), JSON.stringify(value, null, 2) + '\n', { flag: exclusive ? 'wx' : 'w' });
const pointer = read('cleaning-scope/current.json');
assert.equal(pointer.latestAppliedEntityBatch, 34);
assert.equal(pointer.cityReviewLedgers['济南'], '../priority-cities/济南/review-05.json');
for (const file of ['priority-cities/济南/review-06.json', 'priority-cities/济南/review-06.md', 'cleaning-scope/current-before-cultural-review.json']) assert.equal(fs.existsSync(url(file)), false);
const upstream = read('priority-cities/济南/cultural-upstream-check-01.json');
const downstream = read('priority-cities/济南/cultural-downstream-check-03.json');
const applied = read('independent-photo-batch-02/applied.json');
const visual = read('independent-photo-batch-02/visual-review.json');
assert.deepEqual(upstream.failures, []); assert.deepEqual(downstream.failures, []); assert.deepEqual(applied.failures, []);
assert.ok(applied.apply && applied.unchanged); assert.equal(applied.boundImages, 4); assert.equal(applied.withdrawnWrongPositive, 1);
assert.equal(applied.globalAssignmentsAfter, 13); assert.equal(applied.previousGlobalAssignments, 8);
const tests = fs.readdirSync(url('independent-photo-batch-02/')).filter(f => /^verify-\d+\.json$/.test(f)).sort();
const postTest = tests.map(f => ({ file: `independent-photo-batch-02/${f}`, data: read(`independent-photo-batch-02/${f}`) })).findLast(t => t.data.liveAssignments === 5);
assert.ok(postTest?.data.rollback && postTest.data.idempotent && postTest.data.sourceUnchanged);
const flow = read('all-cities/flow/run-36/report.json').cities.find(c => c.city === '济南');
const ledger = read('priority-cities/济南/review-05.json');
assert.equal(ledger.rows.length, 98);
const geo = read('priority-cities/济南/geo-05.json');
const museums = ['6ed737543bd4e4f550f0fd357c9e8c71', '0f3bfc53c2a77e85d2c1699c7c90fd10'];
for (const eid of museums) {
  const row = ledger.rows.find(r => r.entityId === eid);
  const source = upstream.groups.find(g => g.entityId === eid);
  const result = downstream.entities.find(e => e.entityId === eid);
  assert.ok(row && source && result); assert.equal(row.status, 'pending');
  assert.equal(result.revision, 2); assert.equal(result.vector.diagnostics.vector, 'used');
  assert.equal(result.category, '文化'); assert.equal(source.upstreamManagedImageCount, 0);
  assert.ok(result.sql.length === 2 && result.sql.every(p => p.firstId === eid));
  const candidate = geo.find(p => p.query === row.name && p.name === (row.name === '山东博物馆' ? '山东博物馆(山东省石刻艺术博物馆)' : '山东美术馆'));
  assert.ok(candidate);
  assert.equal(Number(candidate.gcj02.latitude.toFixed(6)), result.lat);
  assert.equal(Number(candidate.gcj02.longitude.toFixed(6)), result.lng);
  const probe = flow.probes.find(p => p.id === eid);
  for (const flag of ['candidate', 'schedule', 'persistence', 'edit', 'revisit']) assert.equal(probe?.[flag], true);
  const museum = row.name === '山东博物馆';
  if (museum) assert.equal(visual.rows.filter(r => r.entityId === eid).length, 1);
  else assert.equal(result.independentImages, 0);
  Object.assign(row, { currentEntityId: eid, currentName: row.name, currentRevision: 2, status: 'reviewed_identity',
    reviewAfterEntityBatch: 34, sourceIds: source.sourceIds, currentMentionIds: source.completeMatchingMentionIds,
    dimensions: { identity: 'complete_source_set_reviewed_same_institution', category: 'reviewed_culture',
      location: 'reviewed_current_museum_reference_point', media: museum ? '13_sources_reviewed_1_bound_12_rejected' : 'no_matching_managed_or_independent_images' },
    evidenceFiles: ['priority-cities/济南/cultural-upstream-check-01.json', 'priority-cities/济南/cultural-downstream-check-03.json',
      'priority-cities/济南/geo-05.json', 'independent-photo-batch-02/visual-review.json', 'independent-photo-batch-02/applied.json', postTest.file],
    followup: museum ? '15提及/两源完整核查，主名及山东省博物馆同体、与美术馆和旧址/设施分开；经十路11899号新馆参考点确认，独立图库13图逐图核查，1张正门图已绑定、12张原拒绝保留。SQL/真实向量/旧ID/行程消费通过，AI自查完成，待用户验收。'
      : '10提及/两源完整核查，山东省美术馆别名与现行主体一致，与博物馆独立；经十路11777号本体参考点确认。上游图库及实际独立目录均无匹配图，SQL/真实向量/旧ID/行程消费通过。AI自查完成，待用户验收。' });
}
const church = ledger.rows.find(r => r.entityId === '2caab5c5038a94f91657ae16110dd56e');
assert.ok(church);
Object.assign(church, { status: 'reviewed_identity_media_location_pending', reviewAfterEntityBatch: 34,
  dimensions: { identity: '8_mentions_same_institution_confirmed', category: 'reviewed_culture', location: 'reference_point_pending', media: '9_sources_reviewed_3_bound_1_wrong_positive_withdrawn_5_rejected' },
  evidenceFiles: ['priority-cities/济南/cultural-upstream-check-01.json', 'priority-cities/济南/cultural-downstream-check-03.json',
    'priority-cities/济南/geo-05.json', 'independent-photo-batch-02/visual-review.json', 'independent-photo-batch-02/applied.json', postTest.file],
  followup: '8提及/两源主体与别名已核查，9张独立图逐图核实，3图绑定、1张旧模型错误正例已撤销、5张原拒绝保留。现参考点与新地图候选约57米差异尚待判定，不据距离自动改点；此行仍未完成自查。' });
ledger.createdAt = new Date().toISOString(); ledger.previousLedger = 'priority-cities/济南/review-05.json';
Object.assign(ledger.summary, { fullyReviewed: 6, remainingPrimaryToReview: 88, otherPendingPrimaryRows: 84,
  reviewedOrdinaryPrimaryRows: 2, reviewedIdentityMediaLocationPending: 1,
  fullyReviewedMeaning: 'AI自查6个原入选行：前4行归一为2主体，另山东博物馆/山东美术馆2行；非地点排除4行单列。用户未验收。',
  scopeProgressMeaning: '98原入选行保留：4非地点、6行完成AI自查；88未完成中4行泉池/公园部分治理，其余84继续，含教堂主体/媒体已核但位置待核。' });
write('priority-cities/济南/review-06.json', ledger);
fs.writeFileSync(url('priority-cities/济南/review-06.md'), '# 济南98项重点清单核查台账（文化地点与独立图库第二批后）\n\n'
  + ledger.summary.scopeProgressMeaning + '原7项待定位保持；教堂另有参考点待核。整城未验收。\n\n'
  + '| 原入选名称 | 现行名称 | 版本 | 进度 | 说明 |\n| --- | --- | ---: | --- | --- |\n'
  + ledger.rows.map(r => `| ${r.name} | ${r.currentName ?? r.name} | ${r.currentRevision} | ${r.status} | ${r.followup} |`).join('\n') + '\n', { flag: 'wx' });
write('cleaning-scope/current-before-cultural-review.json', pointer);
const progress = '实体批次仍截至34且已双同步，无batch35。三组文化地点33提及/6源核查、6全名别名SQL及3真实向量通过；山东博物馆/山东美术馆完成AI自查，洪家楼教堂位置仍待核。独立图库第二批22图逐图核实，4图绑定、1旧模型错误正例撤销、17原拒绝保持，正式应用及应用后幂等/回滚/实际生成图片入口通过；不变性检查含201历史行程。review-06保留98项：4非地点、6行AI自查、88未完成（4行泉池/公园部分治理，其余84），原7待定位及教堂参考点继续。50重点实体对+56提及=106范围内待审和4必去缺口不变。未验收，不提交归档。';
Object.assign(pointer, { cityReviewLedgers: { ...pointer.cityReviewLedgers, 济南: '../priority-cities/济南/review-06.json' },
  latestIndependentPhotoBatch: 2, progressUpdatedAt: new Date().toISOString(), progressNote: progress });
write('cleaning-scope/current.json', pointer, false);
const task = read('../task.json'); assert.equal(task.status, 'in_progress');
task.notes = '云南不处理，继续九城。scope06固定978主体+56依赖/1135源，89普通长尾及37已隔离来源归属待审保留。' + progress + '最新research/jinan-cultural-review-20261008.md。';
write('../task.json', task, false);
const prdPath = url('../prd.md');
fs.writeFileSync(prdPath, fs.readFileSync(prdPath, 'utf8').replace('## 已知事实\n', '## 已知事实\n\n### 最新进展：两博物馆自查及独立图库第二批已完成\n\n' + progress + '详见[文化地点核查](research/jinan-cultural-review-20261008.md)。以下为历史快照。\n'));
const resumePath = url('nine-cities-continuation-20261007.md');
fs.writeFileSync(resumePath, fs.readFileSync(resumePath, 'utf8').replace('## 本轮断点\n', '## 本轮断点\n\n最新见[文化地点核查](jinan-cultural-review-20261008.md)。' + progress + '下一步教堂位置与剩余普通地点，之后其余八城。以下为历史断点。\n'));
for (const kind of ['implement', 'check']) {
  const file = url(`../${kind}.jsonl`);
  const entry = { file: '.trellis/tasks/10-06-place-identity-governance/research/jinan-cultural-review-20261008.md', reason: '两博物馆自查完成及图片批次02已应用，教堂位置及其他九城范围继续；禁止重放旧批次' };
  if (!fs.readFileSync(file, 'utf8').includes(entry.file)) fs.appendFileSync(file, JSON.stringify(entry) + '\n');
}
console.log(JSON.stringify({ ledger: 'review-06', fullyReviewed: 6, nonPlaces: 4, remaining: 88, independentPhotoBatch: 2,
  pendingInScope: 106, taskStatus: task.status, userAcceptance: pointer.userAcceptance }));
