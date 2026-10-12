// 只更新工作证据与活动指针；不提交、归档或标记完成。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const url=p=>new URL(p,import.meta.url),read=p=>JSON.parse(fs.readFileSync(url(p),'utf8'));
const write=(p,v,fresh=true)=>fs.writeFileSync(url(p),JSON.stringify(v,null,2)+'\n',{flag:fresh?'wx':'w'});
const dir='priority-cities/济南/',batch='all-cities/batch-44/',at=new Date().toISOString();
const pointer=read('cleaning-scope/current.json');
assert.equal(pointer.latestAppliedEntityBatch,43);assert.equal(pointer.cityReviewLedgers['济南'],'../'+dir+'review-22.json');
assert.equal(pointer.userAcceptance,false);assert.equal(pointer.taskStatus,'in_progress');
assert.equal(pointer.imageComparisonPolicy.status,'deferred_by_user');assert.equal(pointer.latestIndependentPhotoBatch,3);
assert.deepEqual(pointer.pendingVerification,[]);assert.equal(pointer.unappliedFindings.length,3);
const applied=read('all-cities/batch-44-applied.json');assert.equal(applied.apply,true);assert.equal(applied.changes.length,5);
const sync=read(batch+'sync-01/sync-state.json').cities['济南'];assert.ok(sync.importedAt&&sync.relationsImportedAt&&sync.embeddingRunAt);
assert.equal(sync.relationSnapshotRevision,18);
const actual=read(dir+'shared-routes-downstream-check-01.json');assert.equal(actual.consumedFieldsVerified,228);assert.equal(actual.assignmentRows,248);
const consumption=read(batch+'sync-01/shared-routes-consumption-1791482561713.json');assert.equal(consumption.actualPlaceFacts,true);
assert.deepEqual(consumption.afterMinutes,{解放阁:30,曲水亭街:50,百花洲:null});
const post=read(batch+'sync-01/post-import-check-1791482508468.json');assert.equal(post.cities[0].photoFieldsPreserved,60);
const isolated=read(batch+'scope-preview-1791482313858674000/report.json');assert.ok(isolated.idempotent&&isolated.reverseRollback);
const flow=read('all-cities/flow/run-46/report.json'),audit=read('all-cities/audit/run-42/report.json');
for(const r of [actual,consumption,post,isolated,flow,audit,read('all-cities/batch-44-upstream-check.json'),read(batch+'sync-01/verification-vectors.json'),read(dir+'shared-routes-relation-check-01.json')])assert.deepEqual(r.failures,[]);
assert.equal(read('all-cities/flow/run-46/cleanup.json').removed,true);
assert.match(fs.readFileSync(url('upstream-installed-place_identity_test_1791482230628.log'),'utf8'),/610 passed/);
assert.match(fs.readFileSync(url('upstream-stage-place_identity_test_1791482102799.log'),'utf8'),/383 passed/);
assert.match(fs.readFileSync(url('downstream-place_identity_test_1791482554368.log'),'utf8'),/pass 1/);
const install=read('upstream-install.json');assert.equal(install.apply,true);
for(const f of install.files)for(const path of [url('upstream/'+f.path),'D:/Project/xhs-travel-pipeline/'+f.path])
  assert.equal(createHash('sha256').update(fs.readFileSync(path)).digest('hex'),f.after);
const stats={positive:flow.cities.reduce((n,c)=>n+c.probes.length,0),boundaries:flow.cities.reduce((n,c)=>n+c.negativeProbes.length,0),
  withdrawals:flow.cities.reduce((n,c)=>n+c.withdrawalProbes.length,0),pending:audit.cities.reduce((n,c)=>n+(c.statuses.PENDING??0),0)};
assert.deepEqual(stats,{positive:295,boundaries:113,withdrawals:47,pending:288});
const packet=read(dir+'shared-routes-source-packet-01.json');
const priorNotes=[...read(dir+'daminghu-source-packet-01.json').notes,...read(dir+'main-sights-source-packet-01.json').notes];
const reused=packet.notes.filter(n=>priorNotes.some(p=>p.id===n.id&&p.title===n.title&&p.desc===n.desc));assert.equal(reused.length,48);
const ledger=read(dir+'review-22.json'),originalRows=ledger.rows.map(r=>[r.entityId,r.name]);
const scopes=read('all-cities/batch-44-scope-decisions.json');
for(const result of actual.results) {
  const row=ledger.rows.find(r=>r.entityId===result.entityId);assert.ok(row);assert.equal(row.status,'pending');
  const scope=scopes.find(s=>s.expectedRevisions[result.entityId]!==undefined);assert.ok(scope);
  const confirmed=scope.assignments.filter(a=>a.entityId).map(a=>a.mentionId),pending=scope.assignments.filter(a=>!a.entityId).map(a=>a.mentionId);
  Object.assign(row,{currentName:row.name,currentEntityId:result.entityId,currentRevision:3,changeBatch:44,reviewBatch:44,status:'reviewed_scope_partial',
    governedSourceIds:scope.sources?.map(s=>s.sourcePlaceId)??[scope.sourcePlaceId],scopeMentionIds:scope.assignments.map(a=>a.mentionId),
    currentMentionIds:confirmed,pendingScopeMentionIds:pending,
    dimensions:{...row.dimensions,identity:'main_subject_confirmed_with_partial_pending',category:'cultural_subject_confirmed',
      location:row.dimensions.location==='reviewed_reference_point'?'reviewed_reference_point':'existing_coordinates_preserved_review_pending',
      media:'deferred_by_user',consumedFacts:result.name==='解放阁'?'group_duration_excluded_independent_30':result.name==='曲水亭街'?'lead_time_and_group_duration_excluded_independent_50':'group_duration_excluded_photo_subject_pending_visit_unknown'},
    followup:`第44批${confirmed.length}确认/${pending.length}待审已双同步，原ID/坐标保持，文化类revision3；有效时长${result.effectiveMinutes??'未知'}${result.effectiveMinutes===null?'':'分钟'}。共享时长和提前量错误停止消费；保留待审，图片暂缓，尚未完成整项自查。`,
    mediaBoundary:'本轮仅验证既有图片数据和绑定保留，未查看或比对原图，不计为完整视觉核查。',
    evidenceFiles:[...new Set([...(row.evidenceFiles??[]),dir+'shared-routes-source-review-01.json',dir+'shared-routes-downstream-check-01.json',
      dir+'shared-routes-duration-provenance-01.json',dir+'shared-routes-relation-check-01.json','all-cities/batch-44-applied.json',
      'all-cities/batch-44-upstream-check.json',batch+'sync-01/verification-vectors.json',batch+'sync-01/shared-routes-consumption-1791482561713.json'])]});
}
assert.deepEqual(ledger.rows.map(r=>[r.entityId,r.name]),originalRows);assert.equal(ledger.rows.length,98);
assert.equal(ledger.rows.filter(r=>['reviewed_identity','reviewed_same_entity','reviewed_alias_redirect'].includes(r.status)).length,18);
assert.equal(ledger.rows.filter(r=>['reviewed_scope_partial','mixed_source_withdrawn_assignment_pending'].includes(r.status)).length,15);
Object.assign(ledger,{createdAt:at,previousLedger:dir+'review-22.json'});
Object.assign(ledger.summary,{fullyReviewed:18,remainingPrimaryToReview:76,partiallyReviewedScopeRows:15,otherPendingPrimaryRows:61,
  unappliedSemanticFindings:0,governedScopeMentions:385,pendingScopeMentions:108,confirmedJiefangMentions:34,confirmedQushuitingMentions:44,confirmedBaihuazhouMentions:12,
  fullyReviewedMeaning:'18原入选行对应16现行主体；第44批新增完整自查0，3行推进部分scope，用户未验收。',
  scopeProgressMeaning:'98行保留：4非地点、18行AI自查、76未完成（15部分scope、其余61）；158正式范围审核、4必去缺口，3旧共享时长发现已处理。'});
const progress='第44批解放阁/曲水亭街/百花洲四源107提及、51全文完整scope已双同步：90确认/17待审，分别34/1、44/12、12/4；有效时长30/50/未知，三个根revision3、原ID/别名/坐标保持，文化类。提前一天妆造建议被误抽为360分钟已复现修复，共享60/90分钟与错误reason及全城泛化描述排除；原派生缓存保留。610上游全套、真实上下游导入回滚、4名称SQL/3真实向量/14独立主体边界及全仓/扩展typecheck通过。228地点/18关系/direct3、来源revision18；两关联移除、三强关联降级均逐位置核实。107原源/662提及/82全文、238旧行/60图片字段/9绑定/审核366及201行程保持。flow46为295正例/113边界/47撤回0失败，audit42为288PENDING。review23仍98行：4非地点、18行AI自查、76未完成（15部分scope、其余61）；158正式范围审核、4必去缺口；3旧发现已解决，无未同步或向量待复核。实体44/图片03，图片暂缓、云南不处理，未验收不提交归档。';
const docs=[['../prd.md','## 已知事实\n','\n### 最新进展：第44批共享时长及提前量误抽取\n\n'+progress+'见[第44批记录](research/batch44-jinan-shared-routes-20261009.md)。以下为历史快照。\n'],
  ['nine-cities-continuation-20261007.md','## 本轮断点\n','\n当前以review23为准。'+progress+'继续原固定范围剩余主体及17条新待审；下次实体变更后使用新回归flow47/audit43。以下为历史断点。\n']];
for(const [p,marker]of docs)assert.ok(fs.readFileSync(url(p),'utf8').includes(marker));
for(const p of [dir+'review-23.json',dir+'review-23.md','cleaning-scope/current-before-batch44.json',dir+'shared-routes-final-verification-01.json'])assert.ok(!fs.existsSync(url(p)));
write(dir+'review-23.json',ledger);
fs.writeFileSync(url(dir+'review-23.md'),'# 济南98项重点清单核查台账（第44批）\n\n'+progress+'\n\n| 原名称 | 当前名称 | 版本 | 进度 | 说明 |\n| --- | --- | ---: | --- | --- |\n'+ledger.rows.map(r=>`| ${r.name} | ${r.currentName??r.name} | ${r.currentRevision} | ${r.status} | ${r.followup} |`).join('\n')+'\n',{flag:'wx'});
write('cleaning-scope/current-before-batch44.json',pointer);
for(const finding of pointer.unappliedFindings) {
  const result=actual.results.find(r=>r.entityId===finding.entityId);assert.ok(result);
  pointer.resolvedFindings.push({...finding,status:'resolved_shared_duration_and_lead_time_batch44',resolvedByEntityBatch:44,
    currentTypicalMinutes:result.effectiveMinutes,evidence:'../'+dir+'shared-routes-downstream-check-01.json',fullReviewPassed:false,
    confirmed:result.confirmed,pending:result.pending,additionalConcern:null});
}
Object.assign(pointer,{latestAppliedEntityBatch:44,latestFlow:'../all-cities/flow/run-46',latestAudit:'../all-cities/audit/run-42',
  progressNote:progress,progressUpdatedAt:at,unappliedFindings:[],
  latestReviewEvidence:{file:'../'+dir+'shared-routes-downstream-check-01.json',fullReviewsAdded:0,partiallyReviewed:3,fullReviewsReopened:0}});
pointer.cityReviewLedgers['济南']='../'+dir+'review-23.json';
Object.assign(pointer.currentScopeReviews,{addedPendingMentions:108,currentReviewRows:158,
  meaning:'50固定重点实体对加108当前提及待审；第44批新增17提及待审，原3条未应用共享时长发现均已处理。'});
pointer.currentScopeReviews.evidence.push('../'+dir+'shared-routes-source-review-01.json');write('cleaning-scope/current.json',pointer,false);
const task=read('../task.json');assert.equal(task.status,'in_progress');task.notes=progress+'见research/batch44-jinan-shared-routes-20261009.md。';write('../task.json',task,false);
for(const [p,marker,insert]of docs) {
  let t=fs.readFileSync(url(p),'utf8').replace(marker,marker+insert);
  if(p==='../prd.md')t=t.replace('110范围内待审及4必去缺口。第43批已双同步，图片比对暂缓；济南19行AI自查、75未完成','158范围内待审及4必去缺口。第44批已双同步，图片比对暂缓；济南18行AI自查、76未完成');
  fs.writeFileSync(url(p),t);
}
for(const kind of ['implement','check']) {
  const p=url(`../${kind}.jsonl`),entry={file:'.trellis/tasks/10-06-place-identity-governance/research/batch44-jinan-shared-routes-20261009.md',reason:'第44批已双同步，3共享时长发现已解决，review23仍76未完成；图片暂缓，不重放'};
  assert.ok(!fs.readFileSync(p,'utf8').includes(entry.file));fs.appendFileSync(p,JSON.stringify(entry)+'\n');
}
write(dir+'shared-routes-final-verification-01.json',{batch:44,at,stats,fullUpstreamTests:610,stagedTests:383,rootTypecheck:true,extendedTypecheck:true,
  fullReviewsAdded:0,remainingPrimaryToReview:76,partiallyReviewed:15,unappliedFindings:0,imageComparison:'deferred_by_user',userAcceptance:false});
console.log(JSON.stringify({batch:44,ledger:'review-23',fullyReviewed:18,remaining:76,partial:15,unapplied:0,stats}));
