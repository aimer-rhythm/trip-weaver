// 第57批自查结果登记；保留待验收，不提交或归档。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const url=p=>new URL(p,import.meta.url),read=p=>JSON.parse(fs.readFileSync(url(p),'utf8'));
const sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex'),json=v=>JSON.stringify(v,null,2)+'\n';
const dir='priority-cities/济南/',batch='all-cities/batch-57/',folder=batch+'sync-01/',report='batch57-jinan-restaurant-branches-20261009.md',at=new Date().toISOString();
const unique=(p,pattern)=>{const names=fs.readdirSync(url(p)).filter(n=>pattern.test(n));assert.equal(names.length,1);return p+names[0];};
const pointer=read('cleaning-scope/current.json'),before=structuredClone(pointer),task=read('../task.json');
assert.equal(pointer.latestAppliedEntityBatch,56);assert.equal(pointer.latestAppliedEntityBatchVariant,'v2');assert.equal(pointer.cityReviewLedgers['济南'],'../'+dir+'review-36.json');
assert.equal(pointer.userAcceptance,false);assert.equal(pointer.taskStatus,'in_progress');assert.equal(task.status,'in_progress');
assert.equal(pointer.latestIndependentPhotoBatch,3);assert.equal(pointer.latestMetadataRefresh.run,1);assert.equal(pointer.imageComparisonPolicy.status,'deferred_by_user');
assert.equal(pointer.mapCredentialGate.status,'rotation_required');assert.deepEqual(pointer.pendingVerification,[]);assert.equal(pointer.unappliedFindings.length,3);
assert.equal(sha(url('cleaning-scope/'+pointer.scopeFile)),pointer.scopeSha256);
const frozen=read('cleaning-scope/'+pointer.scopeFile);assert.deepEqual(frozen.summary,pointer.summary);
assert.equal(frozen.selected.length,978);assert.equal(frozen.dependencies.length,56);assert.equal(frozen.sourceIds.length,1135);assert.ok(frozen.selected.every(r=>r.place.city!=='云南'));
const source=read('all-cities/batch-57-source.json'),scopes=read('all-cities/batch-57-scope-decisions.json'),decisions=read('all-cities/batch-57-decisions.json'),ids=source.groups.map(g=>g.entity.entity_id);
assert.equal(sha(url('all-cities/batch-57-source.json')),'1d01897c1e894bc5addaebf8f216e65a4e935bf4610933b38a859086a6f5fc78');
assert.equal(sha(url(dir+'restaurant-branches-source-packet-01.json')),'523ec194d950d9e512b781acc6ab965394008f487e57492fbaaf8ae38feff33e');
assert.equal(source.sources.length,3);assert.equal(source.mentions.length,8);assert.equal(source.notes.length,6);assert.equal(scopes.length,3);assert.equal(decisions.length,3);
assert.equal(read('all-cities/batch-57-applied.json').apply,true);
for(const kind of ['preview','applied'])assert.equal(read(`all-cities/batch-57-${kind}.json`).changes.length,6);
const sync=read(folder+'sync-state.json').cities['济南'];assert.ok(sync.importedAt&&sync.relationsImportedAt&&sync.embeddingRunAt);assert.equal(sync.relationSnapshotRevision,31);
assert.equal(sync.exportHash,sha(url(folder+'xhs-places-济南.json')));assert.equal(sync.relationHash,sha(url(folder+'xhs-place-relations-济南.json')));
const consumptionFile=unique(folder,/^restaurant-branches-consumption-\d+\.json$/),postFile=unique(folder,/^post-import-check-\d+\.json$/),dualFile=unique(folder+'preview-济南/',/^preview-\d+\.json$/);
const actual=read(dir+'restaurant-branches-downstream-check-01.json'),consumption=read(consumptionFile);
for(const [k,v]of Object.entries({consumedFieldsVerified:228,assignmentRows:293,pendingMentions:116,scopesAdded:3,confirmed:4,pendingAdded:4,coordinatesCleared:3,newPreciseLocations:0,categoriesCorrected:0,addressesCorrected:3,sqlProbes:6,boundaryProbes:27,realVectorProbes:3,graph:19,directEdges:3,weakRelationAdded:1}))assert.equal(actual[k],v);
assert.deepEqual(actual.fallbackObservedAtChanges,[]);assert.ok(actual.confirmedFactsPreserved&&actual.priorReviewRowsPreserved&&actual.priorRelationEvidenceAndStrengthPreserved);
assert.ok(consumption.actualPlaceFacts&&consumption.priorGovernedFactsPreserved&&consumption.independentSourceDigestUnchanged&&consumption.confirmedContentAndEvidencePreserved);assert.equal(consumption.pendingContentExcluded,4);
assert.deepEqual(consumption.media.map(r=>r.count),[3,1,2]);assert.deepEqual(consumption.mockEnqueueCalls,{before:3,after:0});assert.equal(consumption.actualEnqueues,0);
assert.ok(consumption.canonicalized.every(r=>r.canonicalName==='老舍故居'&&r.photos===2));
const pre=read(folder+'pre-import-check.json'),post=read(postFile);
assert.equal(pre.mode,'before');assert.equal(pre.cities[0].unchangedSincePreview,true);assert.ok(Date.parse(pre.at)<Date.parse(sync.importedAt));
assert.equal(post.cities[0].oldRowsPreserved,238);assert.equal(post.cities[0].photoFieldsPreserved,117);assert.equal(post.cities[0].independentPhotos,9);
assert.deepEqual(post.trips,pre.trips);assert.deepEqual(post.trips,{count:201,digest:'e01d67cbf42a62fc595f4ef052f99e75'});
const isolated=read(batch+'scope-preview-1791495417422987800/report.json'),dual=read(dualFile);
assert.ok(isolated.idempotent&&isolated.reverseRollback&&isolated.originalSourcesAndMentionsUnchanged);assert.equal(isolated.pendingAdded,4);
assert.ok(dual.reverseRollback&&dual.oldRowsPreserved&&dual.photosPreserved);
const delta=read(folder+'preview-济南/relation-delta.json');assert.equal(delta.before,18);assert.equal(delta.after,19);assert.equal(delta.changed.length,1);assert.deepEqual(delta.removed,[]);
assert.equal(delta.changed[0].strength,'weak');assert.equal(delta.changed[0].evidence[0].quote,'燕喜堂（CBD店）→山东博物馆');
const upstream=read('all-cities/batch-57-upstream-check.json');
for(const [k,v]of Object.entries({rawSourcesUnchanged:107,originalMentionsUnchanged:662,originalNotesCovered:82,appliedEntitiesVerified:3,appliedScopesVerified:3,assignmentsVerified:8}))assert.equal(upstream[k],v);
for(const id of ids)assert.equal(upstream.finalEntityRevisions[id],3);
const flow=read('all-cities/flow/run-59/report.json'),audit=read('all-cities/audit/run-56/report.json');
for(const r of [actual,consumption,pre,post,isolated,dual,upstream,flow,audit,read(folder+'verification-vectors.json')])assert.deepEqual(r.failures,[]);
assert.equal(read('all-cities/flow/run-59/cleanup.json').removed,true);
assert.match(fs.readFileSync(url('downstream-place_identity_test_1791495574329.log'),'utf8'),/pass 1/);
assert.match(fs.readFileSync(url('upstream-stage-place_identity_test_1791495416118.log'),'utf8'),/"reverseRollback": true/);
const stats={positive:flow.cities.reduce((n,c)=>n+c.probes.length,0),boundaries:flow.cities.reduce((n,c)=>n+c.negativeProbes.length,0),withdrawals:flow.cities.reduce((n,c)=>n+c.withdrawalProbes.length,0),pending:audit.cities.reduce((n,c)=>n+(c.statuses.PENDING??0),0)};
assert.deepEqual(stats,{positive:321,boundaries:113,withdrawals:47,pending:296});
const install=read('upstream-install.json');assert.equal(install.files.length,61);
for(const f of install.files)for(const p of [url('upstream/'+f.path),'D:/Project/xhs-travel-pipeline/'+f.path])assert.equal(sha(p),f.after);
const ledger=read(dir+'review-36.json'),oldRows=structuredClone(ledger.rows);
assert.deepEqual(ledger.rows.map(r=>[r.entityId,r.name]).sort(),frozen.selected.filter(r=>r.place.city==='济南').map(r=>[r.place.id,r.place.name]).sort());
for(const g of source.groups) {
  const eid=g.entity.entity_id,row=ledger.rows.find(r=>r.entityId===eid),d=decisions.find(d=>d.entityId===eid),s=scopes.find(s=>s.sourcePlaceId===g.entity.primary_place_id);
  assert.equal(row.currentRevision,1);assert.equal(row.status,'pending');assert.equal(g.entity.revision,1);
  const confirmed=s.assignments.filter(a=>a.entityId).map(a=>a.mentionId).sort((a,b)=>a-b),pending=s.assignments.filter(a=>!a.entityId).map(a=>a.mentionId).sort((a,b)=>a-b);
  Object.assign(row,{currentName:d.canonicalName,currentEntityId:eid,currentRevision:3,changeBatch:57,reviewBatch:57,status:'reviewed_scope_partial',
    governedSourceIds:[g.entity.primary_place_id],scopeMentionIds:g.mentionIds,currentMentionIds:confirmed,pendingScopeMentionIds:pending,
    dimensions:{...row.dimensions,identity:'original_full_body_branch_scope',category:'food_verified',location:'unsupported_branch_point_cleared_precise_location_pending',media:'deferred_by_user',consumedFacts:'confirmed_branch_content_preserved_pending_content_excluded'},
    followup:`第57批主名采用原文${d.canonicalName}，${confirmed.length}条确认、${pending.length}条缺分店证据待审；清无充分支持旧点、概略地址${d.overrides.address}，精确位置及媒体待核。`,
    mediaBoundary:'上游图和独立来源/绑定0，实际新旧名均无图；仅比元数据与返回对象，未看图，不构成媒体验收。',
    reviewEvidence:[...(row.reviewEvidence??[]),dir+'restaurant-branches-source-review-01.json',dir+'restaurant-branches-web-review-01.json',dir+'restaurant-branches-downstream-check-01.json',consumptionFile]});
}
for(let i=0;i<ledger.rows.length;i++)if(!ids.includes(ledger.rows[i].entityId))assert.deepEqual(ledger.rows[i],oldRows[i]);
assert.deepEqual(ledger.rows.map(r=>[r.entityId,r.name]),oldRows.map(r=>[r.entityId,r.name]));
assert.equal(ledger.rows.filter(r=>['reviewed_scope_partial','mixed_source_withdrawn_assignment_pending'].includes(r.status)).length,34);
assert.equal(ledger.rows.filter(r=>['pending','reviewed_identity_media_location_pending'].includes(r.status)).length,42);
assert.equal(ledger.rows.filter(r=>r.status==='reviewed_identity_media_location_pending').length,10);
assert.equal(ledger.summary.governedScopeMentions,422);assert.equal(ledger.summary.wrongPointClearedPositionPending,20);
ledger.createdAt=at;ledger.previousLedger=dir+'review-36.json';
Object.assign(ledger.summary,{partiallyReviewedScopeRows:34,governedScopeMentions:430,wrongPointClearedPositionPending:23,pendingScopeMentions:116,otherPendingPrimaryRows:42,confirmedRestaurantBranchMentions:4,
  fullyReviewedMeaning:'18原入选行对应16现行主体；第57批三店分店scope和概略地址已处理，精确位置及媒体待核，完整自查新增0，用户未验收。',
  scopeProgressMeaning:'98行保持：4非地点、18行AI自查、76未完成（34部分scope、42其余）；166范围待审记录和4必去缺口。3项文字发现未应用，日期问题已修复。'});
assert.equal(ledger.summary.fullyReviewed,18);assert.equal(ledger.summary.remainingPrimaryToReview,76);
const progress='第57批燕喜堂（CBD店）、刘小忙把子肉（联四路）、亮亮拉面（经十一路）按原文确认分店，3源8提及/6全文，4确认4待审，3scope+3决定共6变化，均revision1→2→3。稳定ID/裸名别名及food/美食保持；清三店缺充分分店依据的旧点，仅留原文概略地址，精确位置待核，无新主体/合并/撤回。公开页抓取为空，未采用搜索摘要坐标或其他分店地址。228地点/19关系/direct3，revision31，新增note2830燕喜堂CBD与山东博物馆1条weak关系，原18条保持。107原源/662提及/82全文及旧285分配保持，总293/待审116。6SQL/3真实向量/27边界、实际placeFacts/图库、隔离幂等倒序回滚和完整城市双导入通过，正常前置成功。238旧行/117既有图片字段/9绑定/201行程保持，旧图库3/1/2保持，三店新旧名null、mock3→0、真实入队0。只消费确认内容，来源日期保持，仅compiledAt刷新；原始资料保持，不看图、未调用地图API。61实装文件哈希保持，无生产安装，全仓/扩展typecheck通过。flow59为321正例/113边界/47撤回零失败，audit56为296PENDING。review37仍98行：4非地点、18行AI自查、76未完成（34部分scope、42其余），清旧点待定位23，身份已查位置媒体待核10，scope提及430，166范围待审/4必去缺口。3文字发现未应用，实体57/元数据01/图片03，无待同步或向量待核；图片暂缓、天地图凭据待轮换、云南及普通长尾不扩入，未验收不提交归档。';
Object.assign(pointer,{latestAppliedEntityBatch:57,latestFlow:'../all-cities/flow/run-59',latestAudit:'../all-cities/audit/run-56',progressNote:progress,progressUpdatedAt:at,
  latestReviewEvidence:{file:'../'+dir+'restaurant-branches-downstream-check-01.json',supplement:'../'+dir+'restaurant-branches-source-review-01.json',fullReviewsAdded:0,partiallyReviewed:3,fullReviewsReopened:0}});
delete pointer.latestAppliedEntityBatchVariant;
pointer.cityReviewLedgers['济南']='../'+dir+'review-37.json';
Object.assign(pointer.currentScopeReviews,{addedPendingMentions:116,currentReviewRows:166,meaning:'50固定重点实体对加116提及待审；第57批三分店4确认4待审。3项文字发现未应用，日期问题已修复。'});
pointer.currentScopeReviews.evidence.push('../'+dir+'restaurant-branches-source-review-01.json');
pointer.latestReadOnlyFindings.restaurantBranchesFollowup='../'+dir+'restaurant-branches-source-review-01.json';
for(const result of actual.results)pointer.resolvedFindings.push({entityId:result.entityId,name:result.name,status:'resolved_partial_branch_scope_and_unsupported_point_batch57',resolvedByEntityBatch:57,
  confirmed:result.confirmed,pending:result.pending,evidence:'../'+dir+'restaurant-branches-downstream-check-01.json',fullReviewPassed:false,coordinatesCleared:true,preciseLocationResolved:false});
for(const k of ['unappliedFindings','unappliedMetadataFindings','resolvedMetadataFindings','latestMetadataRefresh','summary','scopeSha256','mapCredentialGate'])assert.deepEqual(pointer[k],before[k]);
task.notes=progress+'见research/'+report+'。';
const prd=fs.readFileSync(url('../prd.md'),'utf8'),continuation=fs.readFileSync(url('nine-cities-continuation-20261007.md'),'utf8');
const range=/^- 用户最新明确：\*\*云南不处理，继续其他城市直到验收通过\*\*。[^\n]*$/m;
assert.ok(range.test(prd));assert.ok(prd.includes('## 已知事实\n')&&continuation.includes('## 本轮断点\n'));
const nextPrd=prd.replace(range,'- 用户最新明确：**云南不处理，继续其他城市直到验收通过**。九城固定978主体＋56依赖/1135源，166范围内待审及4必去缺口。第57批三家餐饮分店scope、主名和旧点清除已双同步；济南18行AI自查、76未完成，3项文字发现未应用，日期问题已修复。图片比对暂缓；天地图凭据待轮换但其余文字清洗继续。云南、89普通长尾和37已隔离错城来源归属不扩入主动范围，未获用户验收。')
  .replace('## 已知事实\n','## 已知事实\n\n### 最新进展：第57批三家餐饮分店\n\n'+progress+'见[第57批记录](research/'+report+')。以下为历史快照。\n');
const nextContinuation=continuation.replace('## 本轮断点\n','## 本轮断点\n\n当前以review37为准。'+progress+'下一实体批次58使用flow60/audit57/review38，禁止重放第57批。见['+report+']('+report+')。以下为历史断点。\n');
const fresh=new Map([
  [dir+'review-37.json',json(ledger)],
  [dir+'review-37.md','# 济南98项重点清单核查台账（第57批）\n\n'+progress+'\n\n| 原名称 | 当前名称 | 版本 | 进度 | 说明 |\n| --- | --- | ---: | --- | --- |\n'+ledger.rows.map(r=>`| ${r.name} | ${r.currentName??r.name} | ${r.currentRevision} | ${r.status} | ${r.followup} |`).join('\n')+'\n'],
  ['cleaning-scope/current-before-batch57.json',json(before)],
  [dir+'restaurant-branches-final-verification-01.json',json({batch:57,at,stats,productionCodeInstalled:false,installedManifestHashesVerified:61,isolatedSqlAndExport:true,reverseRollback:true,actualConsumptionTestPassed:true,
    rootTypecheck:true,extendedTypecheck:true,preflightSucceeded:true,frozenMembershipPreserved:{primary:978,dependencies:56,sourceRows:1135},fullReviewsAdded:0,remainingPrimaryToReview:76,partiallyReviewedScopeRows:34,
    otherPendingPrimaryRows:42,unappliedSemanticFindings:3,unappliedMetadataFindings:0,confirmed:4,pendingAdded:4,unsupportedBranchPointsCleared:3,newPreciseLocations:0,weakRelationAdded:1,consumptionFile,postFile,dualFile,imageComparison:'deferred_by_user',mapCredentialStatus:'rotation_required',userAcceptance:false})],
]);
for(const p of fresh.keys())assert.ok(!fs.existsSync(url(p)),p+'已存在，不可重放');assert.ok(fs.existsSync(url(report)));
const replace=new Map([['../task.json',json(task)],['../prd.md',nextPrd],['nine-cities-continuation-20261007.md',nextContinuation]]);
for(const kind of ['implement','check']) {
  const p=`../${kind}.jsonl`,entry={file:'.trellis/tasks/10-06-place-identity-governance/research/'+report,reason:'第57批三分店原文范围/明确主名/清无支持旧点：review37/flow59/audit56，293分配/116待审，新增1条weak关系。76未完成、3文字发现未应用，图片暂缓、未验收不提交归档，不重放'};
  const original=fs.readFileSync(url(p),'utf8');assert.ok(!original.includes(entry.file));replace.set(p,original+JSON.stringify(entry)+'\n');
}
for(const [p,value]of fresh)fs.writeFileSync(url(p),value,{flag:'wx'});
for(const [p,value]of replace)fs.writeFileSync(url(p),value);
fs.writeFileSync(url('cleaning-scope/current.json'),json(pointer));
console.log(JSON.stringify({batch:57,ledger:'review-37',fullyReviewed:18,remaining:76,partialScope:34,otherPending:42,pendingMentions:116,currentReviewRows:166,unappliedFindings:3,stats}));
