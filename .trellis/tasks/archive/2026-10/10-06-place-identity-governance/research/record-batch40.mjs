// 核对本批证据后更新工作记录；不提交、不归档、不标记任务完成。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const url=p=>new URL(p,import.meta.url);
const read=p=>JSON.parse(fs.readFileSync(url(p),'utf8'));
const write=(p,data,fresh=true)=>fs.writeFileSync(url(p),JSON.stringify(data,null,2)+'\n',{flag:fresh?'wx':'w'});
const dir='priority-cities/济南/', batch='all-cities/batch-40/';
const pointer=read('cleaning-scope/current.json');
assert.equal(pointer.latestAppliedEntityBatch,39);
assert.equal(pointer.cityReviewLedgers['济南'],'../'+dir+'review-17.json');
assert.equal(pointer.latestIndependentPhotoBatch,3);
const applied=read('all-cities/batch-40-applied.json'); assert.equal(applied.apply,true); assert.equal(applied.changes.length,4);
const sync=read(batch+'sync-01/sync-state.json').cities['济南'];
assert.ok(sync.importedAt && sync.relationsImportedAt && sync.embeddingRunAt);
const actual=read(dir+'description-downstream-check-01.json');
assert.deepEqual(actual.failures,[]); assert.equal(actual.consumedFieldsVerified,228);
assert.equal(actual.oldEvidenceActuallyRemoved,true); assert.equal(actual.excludedDescriptionFields,4);
for(const file of ['all-cities/batch-40-upstream-check.json',batch+'sync-01/verification-vectors.json',batch+'sync-01/post-import-check-1791476695719.json'])
  assert.deepEqual(read(file).failures,[]);
const isolated=read(batch+'scope-preview-1791476387748737600/report.json');
assert.ok(isolated.reverseRollback && isolated.badDescriptionsNotConsumed && isolated.independentFieldsPreserved);
const flow=read('all-cities/flow/run-42/report.json'),audit=read('all-cities/audit/run-38/report.json');
assert.deepEqual(flow.failures,[]); assert.deepEqual(audit.failures,[]);
assert.equal(read('all-cities/flow/run-42/cleanup.json').removed,true);
assert.match(fs.readFileSync(url('upstream-installed-place_identity_test_1791476215787.log'),'utf8'),/577 passed/);
assert.match(fs.readFileSync(url('downstream-place_identity_test_1791476125939.log'),'utf8'),/pass 1/);
const install=read('upstream-install.json'); assert.equal(install.apply,true);
for(const item of install.files) {
  const digest=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  assert.equal(item.after,digest(url('upstream/'+item.path)));
  assert.equal(item.after,digest('D:/Project/xhs-travel-pipeline/'+item.path));
}
const ledger=read(dir+'review-17.json'),beforeIds=ledger.rows.map(r=>r.entityId);
const scopes=read('all-cities/batch-40-scope-decisions.json');
for(const s of scopes) {
  const eid=Object.keys(s.expectedRevisions)[0];
  const row=ledger.rows.find(r=>r.entityId===eid); assert.ok(row); assert.equal(row.status,'pending');
  row.currentRevision=3; row.changeBatch=40; row.reviewBatch=40; row.status='reviewed_scope_partial';
  row.governedSourceIds=[s.sourcePlaceId];row.scopeMentionIds=s.assignments.map(a=>a.mentionId);
  row.currentMentionIds=row.scopeMentionIds;row.pendingScopeMentionIds=[];
  row.dimensions={...row.dimensions,identity:'text_mention_scope_confirmed_boundary_review_continues',
    category:'retained_pending_review',location:'pending',media:'deferred_by_user',
    consumedFacts:'subject_mismatch_fields_excluded_other_fields_preserved'};
  row.mediaBoundary='用户本轮明确暂不对图片进行比对；数据库图片字段保留不代表视觉核查。';
  row.followup=row.name==='明水古城'
    ?'第40批排除12581整城概述3字段，3有效提及及12786拍照语境保留；原娱乐类别/位置保持待核，图片比对暂缓。完整自查未通过。'
    :'第40批排除12787误称济南动物园的reason，唯一有效提及及evidence_text保留；旧坐标精确对应geo14公厕候选，接续园区本体定位与类别，图片比对暂缓。';
  row.evidenceFiles=[...new Set([...(row.evidenceFiles??[]),dir+'description-source-review-01.json',dir+'description-downstream-check-01.json',
    'all-cities/batch-40-applied.json','all-cities/batch-40-upstream-check.json',batch+'sync-01/verification-vectors.json'])];
}
assert.deepEqual(ledger.rows.map(r=>r.entityId),beforeIds);assert.equal(ledger.rows.length,98);
assert.equal(ledger.rows.filter(r=>['reviewed_identity','reviewed_same_entity','reviewed_alias_redirect'].includes(r.status)).length,19);
ledger.createdAt=new Date().toISOString();ledger.previousLedger=dir+'review-17.json';
Object.assign(ledger.summary,{partiallyReviewedScopeRows:8,otherPendingPrimaryRows:67,governedScopeMentions:152,
  fullyReviewedMeaning:'AI自查19原入选行对应17现行主体；第40批新增完整自查0，用户未验收。',
  scopeProgressMeaning:'98行保留：4非地点、19行AI自查、75未完成，其中8行部分scope治理、其余67继续；110范围内审核行和4必去缺口保持。',
  imageComparisonPolicy:'deferred_by_user'});
const stats={positive:flow.cities.reduce((n,c)=>n+c.probes.length,0),boundaries:flow.cities.reduce((n,c)=>n+c.negativeProbes.length,0),
  withdrawals:flow.cities.reduce((n,c)=>n+c.withdrawalProbes.length,0),pending:audit.cities.reduce((n,c)=>n+(c.statuses.PENDING??0),0)};
assert.deepEqual(stats,{positive:291,boundaries:113,withdrawals:47,pending:240});
const progress='第40批两处描述字段已应用并完成228地点/20关系双同步；明水古城12581的3错误字段及野生动物园12787错误reason停止消费，4有效提及、稳定ID保留，两实体revision3。原107源/662提及/82原文、238旧行/42既有图片字段/9绑定及201历史行程保持。577上游全套、16描述专项、真实上下游导入/回滚及全仓和扩展typecheck通过；2名称SQL/2真实向量、flow42的291正例/113边界/47撤回均0失败，audit38为240PENDING。review18仍98行：4非地点、19行AI自查、75未完成，其中8行部分scope治理；110正式待审和4必去缺口不变。实体40、图片03，无未同步或向量待复核；图片按用户要求暂不比对，类别和位置继续，云南不处理。未验收，不提交归档。';
write(dir+'review-18.json',ledger);
fs.writeFileSync(url(dir+'review-18.md'),'# 济南98项重点清单核查台账（第40批）\n\n'+progress+'\n\n| 原入选名称 | 版本 | 进度 | 说明 |\n| --- | ---: | --- | --- |\n'+ledger.rows.map(r=>`| ${r.name} | ${r.currentRevision} | ${r.status} | ${r.followup} |`).join('\n')+'\n',{flag:'wx'});
write('cleaning-scope/current-before-batch40.json',pointer);
Object.assign(pointer,{latestAppliedEntityBatch:40,latestFlow:'../all-cities/flow/run-42',latestAudit:'../all-cities/audit/run-38',
  progressNote:progress,progressUpdatedAt:ledger.createdAt,imageComparisonPolicy:{status:'deferred_by_user',
    instruction:'图片触发安全审查，暂不对图片进行比对',appliesTo:'本任务后续图片比对，恢复须有用户新指令',acceptedAsPassed:false},
  latestReviewEvidence:{file:'../'+dir+'description-downstream-check-01.json',fullReviewsAdded:0,partiallyReviewed:2}});
pointer.cityReviewLedgers['济南']='../'+dir+'review-18.json';
pointer.resolvedFindings.push(...scopes.map(s=>({entityId:Object.keys(s.expectedRevisions)[0],sourceId:s.sourcePlaceId,
  mentionIds:s.assignments.filter(a=>a.factExclusions).map(a=>a.mentionId),status:'resolved_description_fields_batch40',
  resolvedByEntityBatch:40,evidence:'../'+dir+'description-downstream-check-01.json',fullReviewPassed:false})));
assert.deepEqual(pointer.pendingVerification,[]);write('cleaning-scope/current.json',pointer,false);
const task=read('../task.json');assert.equal(task.status,'in_progress');task.notes=progress+'见research/batch40-jinan-descriptions-20261009.md。';write('../task.json',task,false);
for(const [file,marker,insert] of [
  ['../prd.md','## 已知事实\n','\n### 最新进展：第40批描述字段治理，图片比对暂缓\n\n'+progress+'见[第40批记录](research/batch40-jinan-descriptions-20261009.md)。以下为历史快照。\n'],
  ['nine-cities-continuation-20261007.md','## 本轮断点\n','\n当前以review18为准。'+progress+'接续两处类别/位置及其余济南和八城重点；禁止重放已应用批次。以下为历史断点。\n']]) {
  let content=fs.readFileSync(url(file),'utf8');assert.ok(content.includes(marker));content=content.replace(marker,marker+insert);
  if(file==='../prd.md') content=content.replace('第39批已双同步，济南19行AI自查、75未完成','第40批已双同步，图片比对暂缓；济南19行AI自查、75未完成');
  fs.writeFileSync(url(file),content);
}
for(const kind of ['implement','check']) {
  const file=url(`../${kind}.jsonl`),entry={file:'.trellis/tasks/10-06-place-identity-governance/research/batch40-jinan-descriptions-20261009.md',
    reason:'第40批已双同步；描述4字段排除、4有效提及保留，图片比对依用户要求暂缓；review18仍75未完成，不重放已应用批次'};
  assert.ok(!fs.readFileSync(file,'utf8').includes(entry.file));fs.appendFileSync(file,JSON.stringify(entry)+'\n');
}
write(dir+'description-final-verification-01.json',{batch:40,at:ledger.createdAt,stats,fullUpstreamTests:577,
  descriptionTests:16,fullReviewsAdded:0,remainingPrimaryToReview:75,imageComparison:'deferred_by_user',userAcceptance:false});
console.log(JSON.stringify({ledger:'review-18',fullyReviewed:19,remaining:75,partiallyReviewed:8,stats,entityBatch:40}));
