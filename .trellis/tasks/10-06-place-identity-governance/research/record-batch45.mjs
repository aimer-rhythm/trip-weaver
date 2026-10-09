// 一次性登记已验证第45批；无提交、无归档，未验收状态保持。
import fs from 'node:fs';
import assert from 'node:assert/strict';
const url=p=>new URL(p,import.meta.url),read=p=>JSON.parse(fs.readFileSync(url(p),'utf8'));
const write=(p,v,fresh=true)=>fs.writeFileSync(url(p),JSON.stringify(v,null,2)+'\n',{flag:fresh?'wx':'w'});
const dir='priority-cities/济南/',batch='all-cities/batch-45/',at=new Date().toISOString();
const pointer=read('cleaning-scope/current.json');
assert.equal(pointer.latestAppliedEntityBatch,44);assert.equal(pointer.cityReviewLedgers['济南'],'../'+dir+'review-23.json');
assert.equal(pointer.userAcceptance,false);assert.equal(pointer.taskStatus,'in_progress');
assert.equal(pointer.imageComparisonPolicy.status,'deferred_by_user');assert.equal(pointer.latestIndependentPhotoBatch,3);
assert.deepEqual(pointer.pendingVerification,[]);assert.deepEqual(pointer.unappliedFindings,[]);
const applied=read('all-cities/batch-45-applied.json');assert.equal(applied.apply,true);assert.equal(applied.changes.length,4);
const sync=read(batch+'sync-01/sync-state.json').cities['济南'];assert.ok(sync.importedAt&&sync.relationsImportedAt&&sync.embeddingRunAt);assert.equal(sync.relationSnapshotRevision,19);
const actual=read(dir+'commercial-downstream-check-01.json');assert.equal(actual.consumedFieldsVerified,228);assert.equal(actual.assignmentRows,253);
const consumption=read(batch+'sync-01/commercial-consumption-1791484337290.json');assert.ok(consumption.actualPlaceFacts&&consumption.independentSourceDigestUnchanged);
assert.deepEqual(consumption.media.map(r=>[r.oldPhotoCount,r.currentPhotoCount,r.hypotheticalScopedPhotoCount]),[[3,3,0],[1,1,0]]);assert.equal(consumption.queued,0);
const post=read(batch+'sync-01/post-import-check-1791484197373.json');assert.equal(post.cities[0].photoFieldsPreserved,69);
const isolated=read(batch+'scope-preview-1791483888362657200/report.json');assert.ok(isolated.idempotent&&isolated.reverseRollback);
const flow=read('all-cities/flow/run-47/report.json'),audit=read('all-cities/audit/run-43/report.json');
for(const r of [actual,consumption,post,isolated,flow,audit,read('all-cities/batch-45-upstream-check.json'),read(batch+'sync-01/verification-vectors.json')])assert.deepEqual(r.failures,[]);
assert.equal(read('all-cities/flow/run-47/cleanup.json').removed,true);
assert.match(fs.readFileSync(url('downstream-place_identity_test_1791484329287.log'),'utf8'),/pass 1/);
const stats={positive:flow.cities.reduce((n,c)=>n+c.probes.length,0),boundaries:flow.cities.reduce((n,c)=>n+c.negativeProbes.length,0),
  withdrawals:flow.cities.reduce((n,c)=>n+c.withdrawalProbes.length,0),pending:audit.cities.reduce((n,c)=>n+(c.statuses.PENDING??0),0)};
assert.deepEqual(stats,{positive:297,boundaries:113,withdrawals:47,pending:288});
const ledger=read(dir+'review-23.json'),originalRows=ledger.rows.map(r=>[r.entityId,r.name]);
const scopes=read('all-cities/batch-45-scope-decisions.json');
for(const result of actual.results) {
  const row=ledger.rows.find(r=>r.entityId===result.entityId);assert.ok(row);assert.equal(row.status,'pending');
  const scope=scopes.find(s=>s.expectedRevisions[result.entityId]!==undefined);assert.ok(scope);
  const ids=scope.assignments.map(a=>a.mentionId),daguan=row.name==='大观园';
  Object.assign(row,{currentName:row.name,currentEntityId:result.entityId,currentRevision:3,changeBatch:45,reviewBatch:45,status:'reviewed_scope_partial',
    governedSourceIds:[scope.sourcePlaceId],scopeMentionIds:ids,currentMentionIds:ids,pendingScopeMentionIds:[],
    dimensions:{...row.dimensions,identity:'main_subject_confirmed',category:'cultural_subject_confirmed',
      location:daguan?'wrong_point_cleared_position_pending':'existing_coordinates_preserved_review_pending',media:'deferred_by_user',
      consumedFacts:daguan?'commercial_cultural_subject_confirmed_wrong_geo_cleared':'crosswalk_subject_separate_from_light_route_duration_not_inherited'},
    followup:daguan?'第45批4提及完整scope已双同步，原ID与文化类别保持，revision3；经二路728西侧错点已清空，保留经四路与纬二路概略地址，精确点待核。图片比对暂缓，未整项自查通过。':
      '第45批1提及完整scope已双同步，爱心斑马线路口与红绿灯/道路/街区独立，原坐标和ID保持，revision3；整线路时长不继承，精确机位与图片比对仍待核。',
    mediaBoundary:'仅检查旧图片字段、上游与独立图库元数据；本主体匹配0，图片暂缓不等于视觉验收。',
    reviewEvidence:[...(row.reviewEvidence??[]),dir+'commercial-source-review-01.json',dir+'commercial-downstream-check-01.json']});
}
const findings=[
  {entityId:'46bf462d545dc6435d6de296ba099d0f',name:'融汇老商埠',sourceIds:[5371,5380,5962],mentionIds:[12785,12799],
    status:'unapplied_text_scope_preserve_existing_photo_consumption',reason:'附近未具名咖啡店、混合红绿灯及旧大商埠简介范围仍需完整scope；当前实际3图，直接scope会阻断旧路由，图片暂缓时不自动绑定。'},
  {entityId:'c11648e477180d1b3f97da06808da5e7',name:'经三路',sourceIds:[5394],mentionIds:[12617],
    status:'unapplied_reason_exclusion_preserve_existing_photo_consumption',reason:'reason遗漏纬三路红绿灯限定，placeContent保留限定；当前实际1图，需同时处理文字治理后的旧图库保全。'},
  {entityId:'ce733b67e45f0d657e53ff9bff8cbbce',name:'经三路爱心红绿灯',sourceIds:[5970],mentionIds:[12776],
    status:'unapplied_noncontiguous_name_fact_quote',reason:'三描述字段混入独立夹心胡同；拼接原名在正文不连续，现有字段排除摘录校验拒绝。须设计可靠主体引用，不伪造摘录、不改原文。'},
].map(f=>({...f,discoveredDuringEntityBatch:45,evidence:'../'+dir+'commercial-source-review-01.json',fullReviewPassed:false}));
for(const finding of findings) {
  const row=ledger.rows.find(r=>r.entityId===finding.entityId);assert.ok(row);assert.equal(row.status,'pending');
  row.followup=finding.reason;row.reviewBatch=45;row.dimensions.media='deferred_by_user';
  row.unappliedFinding=finding;row.reviewEvidence=[...(row.reviewEvidence??[]),dir+'commercial-source-review-01.json'];
}
assert.deepEqual(ledger.rows.map(r=>[r.entityId,r.name]),originalRows);
ledger.createdAt=at;ledger.previousLedger=dir+'review-23.json';
Object.assign(ledger.summary,{wrongPointClearedPositionPending:8,partiallyReviewedScopeRows:17,governedScopeMentions:390,otherPendingPrimaryRows:59,
  unappliedSemanticFindings:3,confirmedCommercialMentions:5,
  fullyReviewedMeaning:'18原入选行对应16现行主体；第45批新增完整自查0，2行推进部分scope，用户未验收。',
  scopeProgressMeaning:'98行保留：4非地点、18行AI自查、76未完成（17部分scope、59其余）；158正式范围审核、4必去缺口，3项新文字发现未应用。'});
const progress='第45批大观园/纬三路与经三路交叉口两源5提及、4篇全文完整scope已双同步；两原ID/名称及文化类保持，revision3。大观园经二路728西侧错点已清空，保留经四路与纬二路概略地址，精确点待核；路口保留爱心斑马线和原坐标。228地点/18关系/direct3、来源revision19；关系逐项不变。2SQL/2真实向量/10边界、253新旧分配、真实导入逆序回滚及全仓/扩展typecheck通过。107原源/662提及/82全文、238旧行/69图片字段/9绑定和201行程保持。老商埠3图/经三路1图旧消费保持，内存仅加mentionSources就变0已复现；两主体文字scope暂不应用。红绿灯不连续原名无法通过现字段引用校验，另记未应用。flow47为297正例/113边界/47撤回0失败，audit43为288PENDING。review24仍98行：4非地点、18行AI自查、76未完成（17部分scope、59其余）；158正式范围审核/4必去缺口不变，3项新未应用发现。实体45/图片03，无未同步或向量待复核，图片暂缓、云南不处理，未验收不提交归档。';
const docs=[['../prd.md','## 已知事实\n','\n### 最新进展：第45批商业区与机位边界\n\n'+progress+'见[第45批记录](research/batch45-jinan-commercial-20261009.md)。以下为历史快照。\n'],
  ['nine-cities-continuation-20261007.md','## 本轮断点\n','\n当前以review24为准。'+progress+'继续原固定范围及三项未应用文字发现；下次实体变更使用flow48/audit44。以下为历史断点。\n']];
for(const [p,marker]of docs)assert.ok(fs.readFileSync(url(p),'utf8').includes(marker));
for(const p of [dir+'review-24.json',dir+'review-24.md','cleaning-scope/current-before-batch45.json',dir+'commercial-final-verification-01.json'])assert.ok(!fs.existsSync(url(p)));
write(dir+'review-24.json',ledger);
fs.writeFileSync(url(dir+'review-24.md'),'# 济南98项重点清单核查台账（第45批）\n\n'+progress+'\n\n| 原名称 | 当前名称 | 版本 | 进度 | 说明 |\n| --- | --- | ---: | --- | --- |\n'+ledger.rows.map(r=>`| ${r.name} | ${r.currentName??r.name} | ${r.currentRevision} | ${r.status} | ${r.followup} |`).join('\n')+'\n',{flag:'wx'});
write('cleaning-scope/current-before-batch45.json',pointer);
Object.assign(pointer,{latestAppliedEntityBatch:45,latestFlow:'../all-cities/flow/run-47',latestAudit:'../all-cities/audit/run-43',
  progressNote:progress,progressUpdatedAt:at,unappliedFindings:findings,
  latestReviewEvidence:{file:'../'+dir+'commercial-downstream-check-01.json',fullReviewsAdded:0,partiallyReviewed:2,fullReviewsReopened:0}});
pointer.cityReviewLedgers['济南']='../'+dir+'review-24.json';
pointer.currentScopeReviews.meaning='50固定重点实体对加108当前提及待审；第45批未增加正式待审，3项新文字发现另列未应用。';
pointer.currentScopeReviews.evidence.push('../'+dir+'commercial-source-review-01.json');write('cleaning-scope/current.json',pointer,false);
const task=read('../task.json');assert.equal(task.status,'in_progress');task.notes=progress+'见research/batch45-jinan-commercial-20261009.md。';write('../task.json',task,false);
for(const [p,marker,insert]of docs) {
  let t=fs.readFileSync(url(p),'utf8').replace(marker,marker+insert);
  if(p==='../prd.md')t=t.replace('158范围内待审及4必去缺口。第44批已双同步','158范围内待审及4必去缺口。第45批已双同步');
  fs.writeFileSync(url(p),t);
}
for(const kind of ['implement','check']) {
  const p=url(`../${kind}.jsonl`),entry={file:'.trellis/tasks/10-06-place-identity-governance/research/batch45-jinan-commercial-20261009.md',reason:'第45批两主体已双同步；三项文字发现未应用，旧图库3/1保留，review24仍76未完成；图片暂缓，不重放'};
  assert.ok(!fs.readFileSync(p,'utf8').includes(entry.file));fs.appendFileSync(p,JSON.stringify(entry)+'\n');
}
write(dir+'commercial-final-verification-01.json',{batch:45,at,stats,rootTypecheck:true,extendedTypecheck:true,
  fullReviewsAdded:0,remainingPrimaryToReview:76,partiallyReviewed:17,unappliedFindings:3,imageComparison:'deferred_by_user',userAcceptance:false});
console.log(JSON.stringify({batch:45,ledger:'review-24',fullyReviewed:18,remaining:76,partial:17,unapplied:3,stats}));
