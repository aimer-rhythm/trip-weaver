// 单次登记第58批与五个只读主体，保留待用户验收。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const url=p=>new URL(p,import.meta.url),read=p=>JSON.parse(fs.readFileSync(url(p),'utf8')),json=v=>JSON.stringify(v,null,2)+'\n';
const sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const dir='priority-cities/济南/',folder='all-cities/batch-58/sync-01/',report='batch58-jinan-river-outdoors-20261009.md',at=new Date().toISOString();
const unique=(p,re)=>{const names=fs.readdirSync(url(p)).filter(n=>re.test(n));assert.equal(names.length,1);return p+names[0];};
const pointer=read('cleaning-scope/current.json'),before=structuredClone(pointer),task=read('../task.json');
assert.equal(pointer.latestAppliedEntityBatch,57);assert.equal(pointer.cityReviewLedgers['济南'],'../'+dir+'review-37.json');
assert.equal(pointer.userAcceptance,false);assert.equal(task.status,'in_progress');assert.equal(pointer.taskStatus,'in_progress');assert.deepEqual(pointer.pendingVerification,[]);
assert.equal(pointer.latestIndependentPhotoBatch,3);assert.equal(pointer.latestMetadataRefresh.run,1);assert.equal(pointer.imageComparisonPolicy.status,'deferred_by_user');assert.equal(pointer.mapCredentialGate.status,'rotation_required');assert.equal(pointer.unappliedFindings.length,3);
assert.equal(sha(url('cleaning-scope/'+pointer.scopeFile)),pointer.scopeSha256);const frozen=read('cleaning-scope/'+pointer.scopeFile);assert.deepEqual(frozen.summary,pointer.summary);
assert.equal(frozen.selected.length,978);assert.equal(frozen.dependencies.length,56);assert.equal(frozen.sourceIds.length,1135);assert.ok(frozen.selected.every(r=>r.place.city!=='云南'));
const source=read('all-cities/batch-58-source.json'),scope=read('all-cities/batch-58-scope-decisions.json')[0],outdoors=read(dir+'ordinary-outdoors-source-packet-01.json');
const riverId='4dfda3371793b69de15122bb7e330eac',marketId='7950bfadd891932d01be8636aba8b51a',ids=outdoors.groups.map(g=>g.entity.entity_id);
assert.equal(sha(url('all-cities/batch-58-source.json')),'2d3a64d8740dba030c9e65c6b3133334d6a5bf0a5dbe2ed3edb29cbe91f8de2a');
assert.equal(sha(url(dir+'ordinary-outdoors-source-packet-01.json')),'d4b0c0d2b43cf56155bea2aa4c4844e7720566a303a6517f630fc1483971bd46');
assert.deepEqual(read('all-cities/batch-58-decisions.json'),[]);assert.equal(source.sources.length,1);assert.equal(source.mentions.length,2);assert.equal(source.notes.length,2);
assert.equal(outdoors.sources.length,6);assert.equal(outdoors.mentions.length,11);assert.equal(outdoors.notes.length,4);assert.equal(outdoors.supplementalImageFactNotes.length,11);
for(const k of ['preview','applied'])assert.equal(read(`all-cities/batch-58-${k}.json`).changes.length,1);assert.equal(read('all-cities/batch-58-applied.json').apply,true);
const sync=read(folder+'sync-state.json').cities['济南'];assert.ok(sync.importedAt&&sync.relationsImportedAt&&sync.embeddingRunAt);assert.equal(sync.relationSnapshotRevision,32);
assert.equal(sync.exportHash,sha(url(folder+'xhs-places-济南.json')));assert.equal(sync.relationHash,sha(url(folder+'xhs-place-relations-济南.json')));
const consumptionFile=unique(folder,/^river-outdoors-consumption-\d+\.json$/),postFile=unique(folder,/^post-import-check-\d+\.json$/),dualFile=unique(folder+'preview-济南/',/^preview-\d+\.json$/);
const actual=read(dir+'river-outdoors-downstream-check-01.json'),consumption=read(consumptionFile),pre=read(folder+'pre-import-check.json'),post=read(postFile);
for(const [k,v]of Object.entries({consumedFieldsVerified:228,assignmentRows:295,pendingMentions:116,scopesAdded:1,confirmed:2,pendingAdded:0,coordinatesCleared:0,newPreciseLocations:0,categoriesCorrected:0,ordinaryReviewed:5,sqlProbes:6,boundaryProbes:38,realVectorProbes:6,graph:19,directEdges:3}))assert.equal(actual[k],v);
assert.deepEqual(actual.fallbackObservedAtChanges,[]);assert.ok(actual.wrongTipExcluded&&actual.contentAndEvidencePreserved&&actual.supplementalImageTextPreserved&&actual.priorReviewRowsPreserved);
assert.equal(actual.realVectors.length,6);assert.ok(actual.realVectors.every(v=>v.vector==='used'));
assert.equal(read(folder+'verification-vectors.json').cities[0].vectorProbes.length,0,'通用纯scope探针不冒充真实向量覆盖');
assert.ok(consumption.actualPlaceFacts&&consumption.priorGovernedFactsPreserved&&consumption.independentSourceDigestUnchanged&&consumption.wrongTipExcluded);
assert.deepEqual(consumption.media.map(r=>r.count),[3,1,2]);assert.deepEqual(consumption.mockEnqueueCalls,{before:6,after:5});assert.equal(consumption.actualEnqueues,0);
assert.equal(pre.mode,'before');assert.equal(pre.cities[0].unchangedSincePreview,true);assert.ok(Date.parse(pre.at)<Date.parse(sync.importedAt));
assert.equal(post.cities[0].oldRowsPreserved,238);assert.equal(post.cities[0].photoFieldsPreserved,126);assert.equal(post.cities[0].independentPhotos,9);assert.deepEqual(post.trips,pre.trips);assert.deepEqual(post.trips,{count:201,digest:'e01d67cbf42a62fc595f4ef052f99e75'});
const isolated=read('all-cities/batch-58/scope-preview-1791496077350761700/report.json'),dual=read(dualFile),delta=read(folder+'preview-济南/relation-delta.json'),upstream=read('all-cities/batch-58-upstream-check.json');
assert.ok(isolated.idempotent&&isolated.reverseRollback&&isolated.originalSourcesAndMentionsUnchanged&&isolated.wrongTipReproducedBeforeScope&&isolated.wrongTipExcludedAfterScope&&isolated.supplementalImageTextPreserved);
assert.ok(dual.reverseRollback&&dual.oldRowsPreserved&&dual.photosPreserved);assert.deepEqual(delta.changed,[]);assert.deepEqual(delta.removed,[]);
for(const [k,v]of Object.entries({rawSourcesUnchanged:107,originalMentionsUnchanged:662,originalNotesCovered:82,appliedEntitiesVerified:0,appliedScopesVerified:1,assignmentsVerified:2}))assert.equal(upstream[k],v);assert.equal(upstream.finalEntityRevisions[riverId],2);
const flow=read('all-cities/flow/run-60/report.json'),audit=read('all-cities/audit/run-57/report.json');
for(const r of [actual,consumption,pre,post,isolated,dual,upstream,flow,audit,read(folder+'verification-vectors.json')])assert.deepEqual(r.failures,[]);
assert.equal(read('all-cities/flow/run-60/cleanup.json').removed,true);
assert.match(fs.readFileSync(url('downstream-place_identity_test_1791496229524.log'),'utf8'),/pass 1/);assert.match(fs.readFileSync(url('upstream-stage-place_identity_test_1791496075100.log'),'utf8'),/"reverseRollback": true/);
const stats={positive:flow.cities.reduce((n,c)=>n+c.probes.length,0),boundaries:flow.cities.reduce((n,c)=>n+c.negativeProbes.length,0),withdrawals:flow.cities.reduce((n,c)=>n+c.withdrawalProbes.length,0),pending:audit.cities.reduce((n,c)=>n+(c.statuses.PENDING??0),0)};assert.deepEqual(stats,{positive:322,boundaries:113,withdrawals:47,pending:296});
const install=read('upstream-install.json');assert.equal(install.files.length,61);for(const f of install.files)for(const p of [url('upstream/'+f.path),'D:/Project/xhs-travel-pipeline/'+f.path])assert.equal(sha(p),f.after);
assert.equal(read(dir+'night-market-web-review-01.json').businessMutations,false);
assert.equal(read(dir+'night-market-reference-01.json').ok,true);assert.equal(read(dir+'night-market-reference-03.json').ok,true);

const ledger=read(dir+'review-37.json'),oldRows=structuredClone(ledger.rows);
assert.deepEqual(ledger.rows.map(r=>[r.entityId,r.name]).sort(),frozen.selected.filter(r=>r.place.city==='济南').map(r=>[r.place.id,r.place.name]).sort());
for(const g of outdoors.groups){
  const eid=g.entity.entity_id,row=ledger.rows.find(r=>r.entityId===eid),river=eid===riverId;assert.equal(row.currentRevision,1);assert.equal(row.status,'pending');
  Object.assign(row,{currentName:g.entity.canonical_name,currentEntityId:eid,currentRevision:river?2:1,reviewBatch:58,status:river?'reviewed_scope_partial':'reviewed_identity_media_location_pending',
    dimensions:{...row.dimensions,identity:river?'river_full_scope_distinct_from_memorial_and_boats':'ordinary_identity_full_source_checked',category:eid==='80a33955c3f8381171f8493ae1ec0c4d'?'natural_attraction_preserved':'cultural_attraction_preserved',location:'existing_point_preserved_not_newly_verified',media:'deferred_by_user',consumedFacts:river?'memorial_image_tip_excluded_other_content_preserved':'current_content_and_policies_checked_unchanged'},
    followup:river?'第58批保留两条河道提及，完整scope隔离解放阁图片提示；原名/类别/位置和描述保持，位置媒体仍待核。':'第58批只读核查完整原文、现行事实、SQL/真实向量和名称边界；无业务修订，原版本和位置保留，精确位置及媒体待核。',
    mediaBoundary:'上游及独立来源/绑定0，实际图库null；未看图，不构成媒体验收。',
    reviewEvidence:[...(row.reviewEvidence??[]),dir+'ordinary-outdoors-source-packet-01.json',dir+(river?'river-source-review-01.json':'ordinary-outdoors-source-review-01.json'),dir+'river-outdoors-downstream-check-01.json',consumptionFile]});
  if(river)Object.assign(row,{changeBatch:58,governedSourceIds:[5477],scopeMentionIds:g.mentionIds,currentMentionIds:g.mentionIds,pendingScopeMentionIds:[]});
}
const market=ledger.rows.find(r=>r.entityId===marketId);assert.equal(market.status,'pending');assert.equal(market.currentRevision,1);
market.followup='已读5提及/4全文，2022报道1469号旧址与2025报道2023东迁西周相互印证；当前点未判属旧址或新址，须核来源时点与导航范围，未应用，不按采集时间判定新址。';
market.reviewEvidence=[...(market.reviewEvidence??[]),dir+'night-market-web-review-01.json'];
for(let i=0;i<ledger.rows.length;i++)if(![...ids,marketId].includes(ledger.rows[i].entityId))assert.deepEqual(ledger.rows[i],oldRows[i]);
assert.deepEqual(ledger.rows.map(r=>[r.entityId,r.name]),oldRows.map(r=>[r.entityId,r.name]));
assert.equal(ledger.rows.filter(r=>['reviewed_scope_partial','mixed_source_withdrawn_assignment_pending'].includes(r.status)).length,35);assert.equal(ledger.rows.filter(r=>['pending','reviewed_identity_media_location_pending'].includes(r.status)).length,41);assert.equal(ledger.rows.filter(r=>r.status==='reviewed_identity_media_location_pending').length,15);
assert.equal(ledger.summary.governedScopeMentions,430);assert.equal(ledger.summary.wrongPointClearedPositionPending,23);
ledger.createdAt=at;ledger.previousLedger=dir+'review-37.json';Object.assign(ledger.summary,{partiallyReviewedScopeRows:35,governedScopeMentions:432,pendingScopeMentions:116,otherPendingPrimaryRows:41,reviewedOrdinaryPrimaryRows:15,reviewedIdentityMediaLocationPending:15,confirmedRiverMentions:2,
  fullyReviewedMeaning:'18原入选行对应16现行主体；第58批河道错误提示隔离及5个普通主体只读核查，位置媒体仍待核，完整自查新增0。',
  scopeProgressMeaning:'98行保持：4非地点、18行AI自查、76未完成（35部分scope、41其余，其中15身份事实已查位置媒体待核）；166范围待审及4必去缺口。原3文字发现未应用，另登记环联夜市历史位置补证。'});
assert.equal(ledger.summary.fullyReviewed,18);assert.equal(ledger.summary.remainingPrimaryToReview,76);
const progress='第58批护城河两条有效路线提及保留，以1个完整scope隔离note2810第5图解放阁提示，revision1→2；原名/ID/文化类别/位置/描述/语料保持，无新待审或坐标变更。另只读核查东更道、珍池街、双忠祠街、西公界街、华山湖公园5源9提及/2全文，不改原revision1或添加scope。六主体总6源11提及/4全文，11篇补充图片文字来源保持；隔离库复现旧错误tips后验证移除、幂等及倒序回滚。228地点/19关系/direct3、revision32，旧图关系0变化；正常前置与全城双导入通过。107原源/662提及/82全文、旧293分配保持，总295/待审116。专用6SQL/6真实向量/38边界、实际placeFacts和图库通过；通用纯scope探针0不计作覆盖，tips不进入调度事实，不虚报调度修复。238旧行/126图片字段/9绑定/201行程保持，图库3/1/2保持，六目标null、mock6→5、真实入队0。61实装文件哈希保持，无生产安装，全仓/扩展typecheck通过。flow60为322正例/113边界/47撤回零失败，audit57为296PENDING。review38仍98行：4非地点、18行AI自查、76未完成（35部分scope、41其余），身份事实已查位置媒体待核15，scope提及432，清旧点待定位23，166范围待审及4必去缺口。原3文字发现保持，另登记环联夜市2022旧址与2023东迁补证，现点未判属，不应用。实体58/元数据01/图片03，无待同步或向量待核；图片暂缓、天地图凭据待轮换、云南和长尾不扩入，未验收不提交归档。';
Object.assign(pointer,{latestAppliedEntityBatch:58,latestFlow:'../all-cities/flow/run-60',latestAudit:'../all-cities/audit/run-57',progressNote:progress,progressUpdatedAt:at,
  latestReviewEvidence:{file:'../'+dir+'river-outdoors-downstream-check-01.json',supplement:'../'+dir+'ordinary-outdoors-source-review-01.json',fullReviewsAdded:0,partiallyReviewed:6,fullReviewsReopened:0}});
pointer.cityReviewLedgers['济南']='../'+dir+'review-38.json';Object.assign(pointer.currentScopeReviews,{addedPendingMentions:116,currentReviewRows:166,meaning:'50固定重点实体对加116提及待审；第58批2条确认分配，待审不增加。原3文字发现未应用，环联夜市历史位置另待补证。'});
pointer.currentScopeReviews.evidence.push('../'+dir+'river-source-review-01.json');pointer.latestReadOnlyFindings.ordinaryOutdoorsFollowup='../'+dir+'ordinary-outdoors-source-review-01.json';pointer.latestReadOnlyFindings.nightMarketRelocationFollowup='../'+dir+'night-market-web-review-01.json';
pointer.resolvedFindings.push({entityId:riverId,name:'护城河',status:'resolved_memorial_image_tip_contamination_batch58',resolvedByEntityBatch:58,confirmed:2,pending:0,evidence:'../'+dir+'river-outdoors-downstream-check-01.json',fullReviewPassed:false,preciseLocationResolved:false});
for(const k of ['unappliedFindings','unappliedMetadataFindings','resolvedMetadataFindings','latestMetadataRefresh','summary','scopeSha256','mapCredentialGate'])assert.deepEqual(pointer[k],before[k]);
task.notes=progress+'见research/'+report+'。';
const prd=fs.readFileSync(url('../prd.md'),'utf8'),continuation=fs.readFileSync(url('nine-cities-continuation-20261007.md'),'utf8');const range=/^- 用户最新明确：\*\*云南不处理，继续其他城市直到验收通过\*\*。[^\n]*$/m;assert.ok(range.test(prd));assert.ok(prd.includes('## 已知事实\n')&&continuation.includes('## 本轮断点\n'));
const nextPrd=prd.replace(range,'- 用户最新明确：**云南不处理，继续其他城市直到验收通过**。九城固定978主体＋56依赖/1135源，166范围待审及4必去缺口。第58批护城河错误图片提示已隔离双同步，5个普通户外主体只读身份事实已查；济南18行AI自查、76未完成，原3文字发现未应用，另有环联夜市迁址补证。图片暂缓；天地图凭据待轮换，其余文字继续。云南、89普通长尾和37已隔离错城来源归属不扩入主动范围，未获用户验收。').replace('## 已知事实\n','## 已知事实\n\n### 最新进展：第58批河道提示与普通户外主体\n\n'+progress+'见[第58批记录](research/'+report+')。以下为历史快照。\n');
const nextContinuation=continuation.replace('## 本轮断点\n','## 本轮断点\n\n当前以review38为准。'+progress+'下一实体批次59使用flow61/audit58/review39，优先核环联夜市迁址前后时点和位置，不重放58。见['+report+']('+report+')。以下为历史断点。\n');
const fresh=new Map([[dir+'review-38.json',json(ledger)],[dir+'review-38.md','# 济南98项重点清单核查台账（第58批）\n\n'+progress+'\n\n| 原名称 | 当前名称 | 版本 | 进度 | 说明 |\n| --- | --- | ---: | --- | --- |\n'+ledger.rows.map(r=>`| ${r.name} | ${r.currentName??r.name} | ${r.currentRevision} | ${r.status} | ${r.followup} |`).join('\n')+'\n'],['cleaning-scope/current-before-batch58.json',json(before)],
  [dir+'river-outdoors-final-verification-01.json',json({batch:58,at,stats,productionCodeInstalled:false,installedManifestHashesVerified:61,isolatedSqlAndExport:true,reverseRollback:true,actualConsumptionTestPassed:true,rootTypecheck:true,extendedTypecheck:true,preflightSucceeded:true,
    frozenMembershipPreserved:{primary:978,dependencies:56,sourceRows:1135},fullReviewsAdded:0,remainingPrimaryToReview:76,partiallyReviewedScopeRows:35,otherPendingPrimaryRows:41,reviewedIdentityMediaLocationPending:15,ordinaryReviewed:5,unappliedSemanticFindings:3,nightMarketLocationFollowup:true,
    confirmed:2,pendingAdded:0,wrongTipExcluded:true,consumptionFile,postFile,dualFile,imageComparison:'deferred_by_user',mapCredentialStatus:'rotation_required',userAcceptance:false})]]);
for(const p of fresh.keys())assert.ok(!fs.existsSync(url(p)),p+'已存在，不可重放');assert.ok(fs.existsSync(url(report)));
const replace=new Map([['../task.json',json(task)],['../prd.md',nextPrd],['nine-cities-continuation-20261007.md',nextContinuation]]);
for(const kind of ['implement','check']){const p=`../${kind}.jsonl`,entry={file:'.trellis/tasks/10-06-place-identity-governance/research/'+report,reason:'第58批河道错误图片提示隔离、5普通主体只读核查；review38/flow60/audit57，总295分配/116待审，76未完成；环联夜市迁址另待补证，不重放，不看图、未验收不提交归档'};const original=fs.readFileSync(url(p),'utf8');assert.ok(!original.includes(entry.file));replace.set(p,original+JSON.stringify(entry)+'\n');}
for(const [p,value]of fresh)fs.writeFileSync(url(p),value,{flag:'wx'});for(const [p,value]of replace)fs.writeFileSync(url(p),value);fs.writeFileSync(url('cleaning-scope/current.json'),json(pointer));
console.log(JSON.stringify({batch:58,ledger:'review-38',fullyReviewed:18,remaining:76,partialScope:35,otherPending:41,identityMediaLocationPending:15,pendingMentions:116,currentReviewRows:166,unappliedFindings:3,stats}));
