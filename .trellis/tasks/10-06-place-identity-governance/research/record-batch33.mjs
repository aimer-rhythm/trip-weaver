import fs from 'node:fs';
import assert from 'node:assert/strict';
const read = file => JSON.parse(fs.readFileSync(new URL(file,import.meta.url),'utf8'));
const write = (file,data,exclusive=true) => fs.writeFileSync(new URL(file,import.meta.url),JSON.stringify(data,null,2)+'\n',{flag:exclusive?'wx':'w'});
const sync = read('all-cities/batch-33/sync-01/sync-state.json').cities['济南'];
assert.ok(sync.importedAt && sync.relationsImportedAt && sync.embeddingRunAt);
const verification = read('all-cities/batch-33/sync-01/verification-vectors.json');
assert.deepEqual(verification.failures,[]);
assert.equal(verification.cities[0].vectorProbes.length,1);
assert.equal(verification.cities[0].vectorProbes[0].diagnostics.vector,'used');
assert.equal(verification.cities[0].withdrawals.length,5);
assert.ok(verification.cities[0].withdrawals.every(w=>w.diagnostics.vector==='used' && w.sqlExcluded));
const boundary = read('all-cities/batch-33/sync-01/boundary-check.json');
assert.deepEqual(boundary.failures,[]); assert.equal(boundary.assigned,25); assert.equal(boundary.pending,18);
const source = read('all-cities/batch-33-upstream-check.json');
assert.equal(source.originalMentionsUnchanged,662); assert.equal(source.rawSourcesUnchanged,107);
assert.deepEqual(source.failures,[]);
const flow = read('all-cities/flow/run-35/report.json');
assert.deepEqual(flow.failures,[]); assert.equal(read('all-cities/flow/run-35/cleanup.json').removed,true);
const audit = read('all-cities/audit/run-31/report.json');
assert.deepEqual(audit.failures,[]);
assert.equal(audit.cities.reduce((n,c)=>n+(c.statuses.PENDING??0),0),198);
const detail = read('priority-cities/济南/wulongtan-source-review-01.json');
const ledger = read('priority-cities/济南/review-03.json');
assert.equal(ledger.rows.length,98);
ledger.createdAt=new Date().toISOString(); ledger.previousLedger='priority-cities/济南/review-03.json';
const park = ledger.rows.find(r=>r.entityId==='d7dfe7ae5196779e613b8fa0d9bacf5a');
const mixed = ledger.rows.find(r=>r.entityId==='f65621879204866b17b645554f9848db');
for (const row of [park,mixed]) {
  assert.ok(row);
  row.currentEntityId=row.entityId; row.currentName=row.name; row.changeBatch=33;
  row.governedSourceIds=[5350,5359];
  row.scopeMentionIds=detail.rows.map(r=>r.mentionId);
  row.pendingScopeMentionIds=detail.rows.filter(r=>!r.entityId).map(r=>r.mentionId);
  row.evidenceFiles=['priority-cities/济南/wulongtan-source-review-01.json','all-cities/batch-33-applied.json',
    'all-cities/batch-33-upstream-check.json','all-cities/batch-33/sync-01/boundary-check.json',
    'all-cities/batch-33/sync-01/verification-vectors.json'];
}
Object.assign(park,{currentRevision:3,status:'reviewed_scope_partial',
  currentMentionIds:detail.rows.filter(r=>r.entityId===park.entityId).map(r=>r.mentionId),
  dimensions:{identity:'25_park_mentions_confirmed_18_scope_mentions_pending',category:'reviewed_nature',
    location:'reviewed_reference_point',media:'reviewed_empty_managed_gallery'},
  followup:'两源43提及/37原文已逐条核对，25提及归公园，18仍待补证。保留自然类别和公园本体参考点；不授予五龙潭裸名别名，不把主潭或门口并入园区。审核365未关闭，整组未验收。'});
Object.assign(mixed,{currentRevision:2,status:'mixed_source_withdrawn_assignment_pending',currentMentionIds:[],
  dimensions:{identity:'mixed_id_withdrawn_without_redirect',category:'withdrawn',location:'withdrawn_not_a_core_point',
    media:'reviewed_empty_managed_gallery'},
  followup:'旧裸名ID已显式撤回、未重定向；确认的公园提及逐条归入公园，18条范围/照片/酒店主语疑问仍待补证。不据旧源ID创建或认领主潭，不移出原98项台账。'});
Object.assign(ledger.summary,{partiallyReviewedScopeRows:2,governedScopeMentions:43,confirmedParkMentions:25,
  pendingScopeMentions:18,otherPendingPrimaryRows:88,remainingPrimaryToReview:90,
  scopeProgressMeaning:'90个未完成原入选行中，2行已逐提及治理但整组仍待补证，另88行继续；4个已归一自查行与4非地点排除项保持。'});
write('priority-cities/济南/review-04.json',ledger);
fs.writeFileSync(new URL('priority-cities/济南/review-04.md',import.meta.url),
  '# 济南98项重点清单核查台账（第33批后）\n\n原98项保留：4非地点排除、4行归一为2主体完成自查，90行仍未完成。其中五龙潭两行已完成43条提及核查和部分分配：25归公园、18待补证；另88行继续。7项仍待定位。整城未验收。\n\n'
  +'| 原入选名称 | 现行名称 | 版本 | 进度 | 说明 |\n| --- | --- | ---: | --- | --- |\n'
  +ledger.rows.map(r=>`| ${r.name} | ${r.currentName??r.name} | ${r.currentRevision} | ${r.status} | ${r.followup} |`).join('\n')+'\n',{flag:'wx'});
const pointer = read('cleaning-scope/current.json');
assert.equal(pointer.latestAppliedEntityBatch,32);
write('cleaning-scope/current-before-batch33.json',pointer);
Object.assign(pointer,{latestAppliedEntityBatch:33,latestFlow:'../all-cities/flow/run-35',latestAudit:'../all-cities/audit/run-31',
  cityReviewLedgers:{...pointer.cityReviewLedgers,济南:'../priority-cities/济南/review-04.json'},progressUpdatedAt:new Date().toISOString(),
  summaryMeaning:'summary为scope06固定入选时统计；后续逐提及待审增量见currentScopeReviews，不重排或静默删除原入选行。',
  currentScopeReviews:{frozenEntityPairs:50,addedPendingMentions:18,currentReviewRows:68,referenceNeedsReview:4,
    evidence:'../priority-cities/济南/wulongtan-source-review-01.json',
    meaning:'第33批18条提及已读但具体主体/语义证据不足，scope以null保留；原50重点实体对未关闭，不能将新增提及待审混算成长尾。'},
  progressNote:'scope06保留batch29固定入选集合978主体+56依赖/1135源。batch33已逐条核对五龙潭两源43提及/37原文，25归公园、18待补证；裸名旧ID撤回不重定向，公园保留自然类别及本体点。228行（223有效+5撤回）/23关系双同步、真实检索/向量/旧ID/原源/历史行程通过。济南原98项中4非地点、4归一自查，90行未完成（其中2行本批部分治理、另88继续），7仍待定位。未验收，不提交归档。'});
write('cleaning-scope/current.json',pointer,false);
const task = read('../task.json');
assert.equal(task.status,'in_progress');
task.notes='云南不处理，九城持续至明确验收。scope06固定978主体+56依赖/1135源、50重点实体对+4必去缺口；batch33新增18条已读但缺证据的范围内提及待审，现范围内68审核行，89普通长尾及37已隔离错城来源归属待审保持。最新research/batch33-jinan-wulongtan-20261008.md：43提及/37原文逐条核对，25归五龙潭公园、18保持null待审；裸名ID显式撤回不重定向，公园category自然且revision3。228行（223有效+5撤回）/23关系（12强边）已双同步；1公园真实向量及5撤回向量、旧ID边界、107原源/662提及和201历史行程保持检查通过。flow/run-35为282正例/113独立包含/46撤回0失败；audit/run-31为198PENDING（139实体对行/138对+59提及）、图片0异常0。review-04保留98项：4非地点、4行归一自查、90未完成（其中2行本批部分治理，另88继续），7仍待定位。01-v2至33禁止重放，无batch34或待同步步骤。未验收，不提交/归档/标记完成/push。';
write('../task.json',task,false);
console.log(JSON.stringify({batch:33,ledger:'review-04',assignedMentions:25,pendingMentions:18,
  remainingPrimaryRows:90,frozenEntityPairs:50,currentInScopeReviewRows:68,taskStatus:task.status}));
