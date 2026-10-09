import fs from 'node:fs';
import assert from 'node:assert/strict';
const url = file => new URL(file, import.meta.url);
const read = file => JSON.parse(fs.readFileSync(url(file), 'utf8'));
const write = (file, data, exclusive = true) => fs.writeFileSync(url(file), JSON.stringify(data, null, 2) + '\n', { flag: exclusive ? 'wx' : 'w' });
const pointer = read('cleaning-scope/current.json');
assert.equal(pointer.cityReviewLedgers['济南'], '../priority-cities/济南/review-07.json');
assert.equal(pointer.latestAppliedEntityBatch, 34); assert.equal(pointer.latestIndependentPhotoBatch, 2);
const applied = read('independent-photo-batch-03/applied.json');
assert.ok(applied.apply && applied.unchanged); assert.equal(applied.boundImages, 4);
const verified = read('priority-cities/济南/tower-downstream-check-02.json'); assert.deepEqual(verified.failures, []);
const tests = fs.readdirSync(url('independent-photo-batch-03/')).filter(f => /^verify-\d+\.json$/.test(f)).sort();
const postTestFile = `independent-photo-batch-03/${tests.at(-1)}`;
const postTest = read(postTestFile);
assert.equal(postTest.liveBatchAssignments, 4); assert.ok(postTest.idempotent && postTest.rollback);
const ledger = read('priority-cities/济南/review-07.json');
const rows = ledger.rows.filter(r => r.currentEntityId === 'd4a51a5df56f78c9de0713d86ea8c00c'); assert.equal(rows.length, 2);
for (const row of rows) {
  row.status = row.entityId === row.currentEntityId ? 'reviewed_same_entity' : 'reviewed_alias_redirect';
  row.dimensions.media = '10_reviewed_4_independent_bindings_3_displayed_6_existing_rejections';
  row.independentPhotoBatch = 3;
  row.followup = '两源24提及及完整原文指纹复核通过，保留超然楼稳定ID及大明湖超然楼旧ID重定向；楼体与大明湖、码头、茶馆机位独立。10张独立图逐图核查，4图已绑定、6原拒绝保留；其中1图明确为登楼俯瞰视角。主名/别名展示相同3图，四绑定逐张可用，SQL/真实向量及位置精度核验通过。AI自查完成，待用户验收。';
  row.evidenceFiles.push('priority-cities/济南/tower-upstream-check-01.json', 'priority-cities/济南/tower-downstream-check-02.json',
    'independent-photo-batch-03/visual-review.json', 'independent-photo-batch-03/preview.json', 'independent-photo-batch-03/applied.json', postTestFile);
}
ledger.createdAt = new Date().toISOString(); ledger.previousLedger = 'priority-cities/济南/review-07.json';
Object.assign(ledger.summary, { fullyReviewed: 6, remainingPrimaryToReview: 88, otherPendingPrimaryRows: 84, reopenedIndependentMediaRows: 0,
  fullyReviewedMeaning: 'AI自查6原入选行：宽厚里两行、超然楼两行与两博物馆，共4现行主体；用户未验收。',
  scopeProgressMeaning: '98原入选行保留：4非地点、6行完成AI自查；88未完成中4行泉池/公园部分治理，其余84继续，包含教堂位置待核。' });
write('priority-cities/济南/review-08.json', ledger);
fs.writeFileSync(url('priority-cities/济南/review-08.md'), '# 济南98项重点清单核查台账（超然楼媒体自查完成）\n\n'
  + ledger.summary.scopeProgressMeaning + '原7项待定位保持，教堂参考点另待核。整城未验收。\n\n'
  + '| 原入选名称 | 现行名称 | 版本 | 进度 | 说明 |\n| --- | --- | ---: | --- | --- |\n'
  + ledger.rows.map(r => `| ${r.name} | ${r.currentName ?? r.name} | ${r.currentRevision} | ${r.status} | ${r.followup} |`).join('\n') + '\n', { flag: 'wx' });
write('cleaning-scope/current-before-photo-batch03.json', pointer);
const progress = '实体批次仍截至34且已双同步，无batch35。独立图片03已正式应用超然楼4绑定、6原拒绝保留；10图全部视觉核查，其中1图经Commons确认登楼俯瞰视角。应用后实库4绑定读回、逐图可用及两名三图展示、幂等/回滚通过；原13分配、原目录与201历史行程不变。超然楼24提及及SQL/真实向量/旧ID复核通过。review-08保留98行：4非地点、6行AI自查、88未完成（4行泉池/公园部分治理，其余84）。教堂主体/图片已核，位置仍缺建筑范围证据；原7待定位保留。scope06固定978主体+56依赖/1135源，范围内50实体对+56提及=106待审及4必去缺口不变。未验收，不提交归档。';
pointer.cityReviewLedgers['济南'] = '../priority-cities/济南/review-08.json'; pointer.latestIndependentPhotoBatch = 3;
pointer.progressNote = progress; pointer.progressUpdatedAt = new Date().toISOString(); write('cleaning-scope/current.json', pointer, false);
const task = read('../task.json'); task.notes = '云南不处理，继续九城。' + progress + '见research/jinan-tower-review-20261008.md；实体01-v2至34及独立图片01至03禁止重放。';
write('../task.json', task, false);
const prd = url('../prd.md');
fs.writeFileSync(prd, fs.readFileSync(prd, 'utf8').replace('## 已知事实\n', '## 已知事实\n\n### 最新进展：超然楼独立图片第三批及完整自查\n\n' + progress + '详见[超然楼本轮核查](research/jinan-tower-review-20261008.md)。以下为历史快照。\n'));
const resume = url('nine-cities-continuation-20261007.md');
fs.writeFileSync(resume, fs.readFileSync(resume, 'utf8').replace('## 本轮断点\n', '## 本轮断点\n\n当前以review-08为准。' + progress + '下一步继续普通重点地点（解放阁、泉城广场、济南府学文庙），教堂有新边界证据再补位置；其后继续其余八城。以下为历史断点。\n'));
console.log(JSON.stringify({ ledger: 'review-08', fullyReviewed: 6, nonPlace: 4, remaining: 88, independentPhotoBatch: 3 }));
