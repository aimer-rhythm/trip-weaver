import fs from 'node:fs';
import assert from 'node:assert/strict';
const read = file => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), 'utf8'));
const write = (file, data, exclusive = true) => fs.writeFileSync(new URL(file, import.meta.url),
  JSON.stringify(data, null, 2) + '\n', {flag:exclusive?'wx':'w'});
const sync = read('all-cities/batch-32/sync-01/sync-state.json').cities['济南'];
assert.ok(sync.importedAt && sync.relationsImportedAt && sync.embeddingRunAt);
const verification = read('all-cities/batch-32/sync-01/verification-vectors.json');
assert.deepEqual(verification.failures, []);
assert.equal(verification.cities[0].probes.length, 4);
assert.equal(verification.cities[0].vectorProbes.length, 2);
assert.deepEqual(read('all-cities/batch-32/sync-01/boundary-check.json').failures, []);
const sourceCheck = read('all-cities/batch-32-upstream-check.json');
assert.equal(sourceCheck.originalMentionsUnchanged, 662);
assert.deepEqual(sourceCheck.failures, []);
const flow = read('all-cities/flow/run-34/report.json');
assert.deepEqual(flow.failures, []);
assert.equal(read('all-cities/flow/run-34/cleanup.json').removed, true);
const ledger = read('priority-cities/济南/review-02.json');
ledger.createdAt = new Date().toISOString();
ledger.previousLedger = 'priority-cities/济南/review-02.json';
const decisions = read('all-cities/batch-32-decisions.json');
for (const decision of decisions) {
  for (const id of [decision.entityId, ...decision.mergeEntityIds]) {
    const row = ledger.rows.find(r => r.entityId === id);
    assert.ok(row);
    row.currentRevision = 2;
    row.currentEntityId = decision.entityId;
    row.currentName = decision.canonicalName;
    row.status = id === decision.entityId ? 'reviewed_same_entity' : 'reviewed_alias_redirect';
    row.dimensions = {identity:'reviewed_same_entity',category:'reviewed_source_category',
      location:'reviewed_reference_point',media:'no_current_images_verified'};
    row.changeBatch = 32;
    row.evidenceFiles = ['all-cities/batch-32-decisions.json','all-cities/batch-32-applied.json',
      'all-cities/batch-32-upstream-check.json','all-cities/batch-32/sync-01/verification-vectors.json',
      'all-cities/batch-32/sync-01/boundary-check.json'];
    row.followup = `已核对完整来源并归入“${decision.canonicalName}”稳定ID；${id === decision.entityId ? '主实体保留' : '旧ID保留重定向'}。坐标为地图本体参考点；${decision.canonicalName === '宽厚里' ? '错误地址文字已清空，按原文商业街区类别保留' : '楼体与大明湖及摄影机位独立'}。仍待用户验收。`;
  }
}
Object.assign(ledger.summary, {fullyReviewed:4,reviewedNonPlaceExcluded:4,reviewedIdentityPairs:2,
  remainingPrimaryToReview:90,fullyReviewedMeaning:'AI已核对来源、主体、类别、参考位置、旧ID和当前图片；不是用户验收，4旧入选行对应2个现行实体。'});
write('priority-cities/济南/review-03.json', ledger);
fs.writeFileSync(new URL('priority-cities/济南/review-03.md',import.meta.url),
  '# 济南98项重点清单核查台账（第32批后）\n\n保留原98项：4项非地点已排除、4行已归一为2个主体并自查，其余90行继续核查。7项仍待定位；整城未验收。\n\n'
  + '| 原入选名称 | 现行名称 | 版本 | 进度 | 说明 |\n| --- | --- | ---: | --- | --- |\n'
  + ledger.rows.map(r=>`| ${r.name} | ${r.currentName??r.name} | ${r.currentRevision} | ${r.status} | ${r.followup} |`).join('\n')+'\n', {flag:'wx'});
const pointer = read('cleaning-scope/current.json');
write('cleaning-scope/current-before-batch32.json', pointer);
Object.assign(pointer, {latestAppliedEntityBatch:32,latestFlow:'../all-cities/flow/run-34',latestAudit:'../all-cities/audit/run-30',
  cityReviewLedgers:{...pointer.cityReviewLedgers,济南:'../priority-cities/济南/review-03.json'},progressUpdatedAt:new Date().toISOString(),
  progressNote:'scope06仍保留batch29后固定入选集合。batch30修正10项位置，batch31排除4非地点/8提及，batch32将超然楼和宽厚里两组4实体归为2主体，已双同步。济南原98项保留：4非地点排除，4行归一自查，其余90行继续，7项仍待定位。未验收，不以旧清单版本或无坐标剔除宣称完成。'});
write('cleaning-scope/current.json', pointer, false);
const task=read('../task.json');
task.notes='用户目标：云南不处理，继续九城至明确验收。scope06保留batch29固定入选基线978主体+56依赖/1135源，50重点实体对+4必去缺口；89普通长尾暂缓、37已隔离错城来源归属待审保留。最新research/batch32-jinan-tower-street-20261008.md：完整核对两组56提及/36原文，超然楼与大明湖超然楼、宽厚里与宽厚里美食街各自归一，清宽厚里错地址。228行（224有效+4撤回）/25关系（13强边）双同步，4名称/2真实向量及5独立边界通过；238旧行、107原源/662提及和201历史行程摘要不变。flow/run-34为12城281正例/113独立包含/45撤回0失败，audit/run-30仍180PENDING、图片0异常0。非地点能力519上游/26下游及全仓typecheck通过。济南review-03保留98项：4非地点、4行归一为2主体自查，其余90继续，7仍待定位。01-v2至32禁止重放，无batch33或待同步步骤。未验收，不提交/归档/标记完成/push。';
write('../task.json',task,false);
console.log(JSON.stringify({batch:32,ledger:'review-03',reviewedRows:4,nonPlaceRows:4,pendingRows:90,
  flows:flow.cities.reduce((n,c)=>n+c.probes.length,0),negative:flow.cities.reduce((n,c)=>n+c.negativeProbes.length,0),
  withdrawals:flow.cities.reduce((n,c)=>n+c.withdrawalProbes.length,0)}));
