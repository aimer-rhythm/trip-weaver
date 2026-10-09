// 登记已验证的文字范围治理；不提交、归档或标记任务完成。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const url=p=>new URL(p,import.meta.url),read=p=>JSON.parse(fs.readFileSync(url(p),'utf8')),json=v=>JSON.stringify(v,null,2)+'\n';
const sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const dir='priority-cities/济南/',folder='all-cities/batch-61/sync-01/',report='batch61-jinan-built-place-20261009.md',at=new Date().toISOString();
const unique=(p,re)=>{const names=fs.readdirSync(url(p)).filter(n=>re.test(n));assert.equal(names.length,1);return p+names[0];};
const pointer=read('cleaning-scope/current.json'),before=structuredClone(pointer),task=read('../task.json');
assert.equal(pointer.latestAppliedEntityBatch,60);assert.equal(pointer.cityReviewLedgers['济南'],'../'+dir+'review-40.json');assert.equal(pointer.userAcceptance,false);
assert.equal(task.status,'in_progress');assert.equal(pointer.taskStatus,'in_progress');assert.deepEqual(pointer.pendingVerification,[]);
assert.equal(pointer.latestIndependentPhotoBatch,3);assert.equal(pointer.latestMetadataRefresh.run,1);assert.equal(pointer.imageComparisonPolicy.status,'deferred_by_user');assert.equal(pointer.mapCredentialGate.status,'rotation_required');assert.equal(pointer.unappliedFindings.length,3);
assert.equal(sha(url('cleaning-scope/'+pointer.scopeFile)),pointer.scopeSha256);const frozen=read('cleaning-scope/'+pointer.scopeFile);assert.deepEqual(frozen.summary,pointer.summary);
assert.equal(frozen.selected.length,978);assert.equal(frozen.dependencies.length,56);assert.equal(frozen.sourceIds.length,1135);assert.ok(frozen.selected.every(r=>r.place.city!=='云南'));
const source=read('all-cities/batch-61-source.json'),packet=read(dir+'built-place-source-packet-01.json'),scopes=read('all-cities/batch-61-scope-decisions.json'),decisions=read('all-cities/batch-61-decisions.json');
const wallId='66c835ba565f34cbd12206d7169c8da1',shopId='dc445410375df79cab73ba2b18448910',ids=packet.groups.map(g=>g.entity.entity_id);
assert.equal(sha(url('all-cities/batch-61-source.json')),'f446be273e56ced83f9a1fb78022875ba968638b1372d8e953409ecf167bd334');
assert.equal(sha(url(dir+'built-place-source-packet-01.json')),'e1cf77506a8d66330bd8157a1ab0b02907f9fd990d44c482e4094823c2a5d84e');
assert.equal(source.sources.length,2);assert.equal(source.mentions.length,2);assert.equal(source.notes.length,2);assert.equal(packet.notes.length,4);assert.equal(packet.mentions.length,7);
assert.equal(scopes.length,2);assert.equal(scopes.flatMap(s=>s.assignments).filter(a=>a.entityId===null).length,1);assert.equal(decisions.length,0);
for(const k of ['preview','applied'])assert.equal(read(`all-cities/batch-61-${k}.json`).changes.length,2);assert.equal(read('all-cities/batch-61-applied.json').apply,true);
const sync=read(folder+'sync-state.json').cities['济南'];assert.ok(sync.importedAt&&sync.relationsImportedAt&&sync.embeddingRunAt);assert.equal(sync.relationSnapshotRevision,35);
assert.equal(sync.exportHash,sha(url(folder+'xhs-places-济南.json')));assert.equal(sync.relationHash,sha(url(folder+'xhs-place-relations-济南.json')));
const consumptionFile=unique(folder,/^built-place-consumption-\d+\.json$/),postFile=unique(folder,/^post-import-check-\d+\.json$/),dualFile=unique(folder+'preview-济南/',/^preview-\d+\.json$/);
const actual=read(dir+'built-place-downstream-check-01.json'),consumption=read(consumptionFile),pre=read(folder+'pre-import-check.json'),post=read(postFile);
for(const [k,v]of Object.entries({consumedFieldsVerified:228,assignmentRows:312,pendingMentions:127,scopesAdded:2,confirmed:1,pendingAdded:1,coordinatesCleared:0,newPreciseLocations:0,categoriesCorrected:0,readOnlyBoundaryPending:5,withdrawals:1,withdrawnCoordinatesRemoved:1,sqlProbes:7,boundaryProbes:42,realVectorProbes:7,graph:19,directEdges:3,foreignWallTipsRemoved:2}))assert.equal(actual[k],v);
assert.deepEqual(actual.fallbackObservedAtChanges,[]);assert.ok(actual.confirmedFactsAndDatesPreserved&&actual.unresolvedBranchFactsRemoved&&actual.priorReviewRowsPreserved);
assert.equal(actual.realVectors.length,7);assert.ok(actual.realVectors.every(v=>v.vector==='used'));assert.equal(actual.realVectors.filter(v=>v.withdrawn).length,1);
const vectors=read(folder+'verification-vectors.json');assert.equal(vectors.cities[0].vectorProbes.length,1);assert.ok(vectors.cities[0].vectorProbes.every(v=>v.diagnostics.vector==='used'));
assert.ok(consumption.actualPlaceFacts&&consumption.priorGovernedFactsPreserved&&consumption.independentSourceDigestUnchanged&&consumption.withdrawnFactExclusionVerified);
assert.deepEqual(consumption.media.map(r=>r.count),[3,1,2]);assert.deepEqual(consumption.mockEnqueueCalls,{before:7,after:5});assert.equal(consumption.actualEnqueues,0);
const media=read(dir+'built-place-photo-metadata-01.json');assert.equal(media.entities.length,7);assert.ok(media.entities.every(p=>p.independentSources.length===0&&p.assignments.length===0));
assert.equal(pre.mode,'before');assert.equal(pre.cities[0].unchangedSincePreview,true);assert.ok(Date.parse(pre.at)<Date.parse(sync.importedAt));
assert.equal(post.cities[0].oldRowsPreserved,238);assert.equal(post.cities[0].photoFieldsPreserved,144);assert.equal(post.cities[0].independentPhotos,9);assert.deepEqual(post.trips,pre.trips);assert.deepEqual(post.trips,{count:201,digest:'e01d67cbf42a62fc595f4ef052f99e75'});
const isolated=read('all-cities/batch-61/scope-preview-1791498615444625500/report.json'),dual=read(dualFile),delta=read(folder+'preview-济南/relation-delta.json'),upstream=read('all-cities/batch-61-upstream-check.json');
assert.ok(isolated.idempotent&&isolated.reverseRollback&&isolated.originalSourcesAndMentionsUnchanged&&isolated.confirmedFactsAndDatesPreserved&&isolated.publicationDatesPreserved);assert.equal(isolated.withdrawals,1);
assert.ok(dual.reverseRollback&&dual.oldRowsPreserved&&dual.photosPreserved);assert.deepEqual(delta.changed,[]);assert.deepEqual(delta.removed,[]);
for(const [k,v]of Object.entries({rawSourcesUnchanged:107,originalMentionsUnchanged:662,originalNotesCovered:82,appliedEntitiesVerified:0,appliedScopesVerified:2,assignmentsVerified:2}))assert.equal(upstream[k],v);
assert.deepEqual(upstream.finalEntityRevisions,{[wallId]:3,[shopId]:2});
const times=read(dir+'built-place-times-check-01.json');assert.equal(times.batch,61);assert.equal(times.notes,4);assert.ok(times.publicationAndCollectionTimesPreserved&&times.rawJsonHashesPreserved);
const flow=read('all-cities/flow/run-63/report.json'),audit=read('all-cities/audit/run-60/report.json');
for(const r of [actual,consumption,pre,post,isolated,dual,upstream,flow,audit,vectors,times])assert.deepEqual(r.failures,[]);assert.equal(read('all-cities/flow/run-63/cleanup.json').removed,true);
assert.match(fs.readFileSync(url('downstream-place_identity_test_1791498764453.log'),'utf8'),/pass 1/);assert.match(fs.readFileSync(url('upstream-stage-place_identity_test_1791498613528.log'),'utf8'),/"reverseRollback": true/);
const stats={positive:flow.cities.reduce((n,c)=>n+c.probes.length,0),boundaries:flow.cities.reduce((n,c)=>n+c.negativeProbes.length,0),withdrawals:flow.cities.reduce((n,c)=>n+c.withdrawalProbes.length,0),pending:audit.cities.reduce((n,c)=>n+(c.statuses.PENDING??0),0)};assert.deepEqual(stats,{positive:324,boundaries:113,withdrawals:51,pending:307});
const probe=flow.cities.find(c=>c.city==='济南').withdrawalProbes.find(p=>p.id===shopId);assert.ok(probe.sqlExcluded&&probe.nameRejected&&probe.oldIdRejected&&probe.persistence&&probe.historicalIdentityPreserved&&probe.newEditRejected);
const install=read('upstream-install.json');assert.equal(install.files.length,61);for(const f of install.files)for(const p of [url('upstream/'+f.path),'D:/Project/xhs-travel-pipeline/'+f.path])assert.equal(sha(p),f.after);
const ledger=read(dir+'review-40.json'),oldRows=structuredClone(ledger.rows),review=read(dir+'built-place-source-review-01.json');
assert.deepEqual(ledger.rows.map(r=>[r.entityId,r.name]).sort(),frozen.selected.filter(r=>r.place.city==='济南').map(r=>[r.place.id,r.place.name]).sort());
for(const g of packet.groups){
  const eid=g.entity.entity_id,row=ledger.rows.find(r=>r.entityId===eid),wall=eid===wallId,withdrawn=eid===shopId,changed=wall||withdrawn;
  assert.equal(row.currentRevision,g.entity.revision);assert.equal(row.status,'pending');
  Object.assign(row,{currentName:g.entity.canonical_name,currentEntityId:eid,currentRevision:g.entity.revision+(changed?1:0),reviewBatch:61,
    status:wall?'reviewed_scope_partial':withdrawn?'mixed_source_withdrawn_assignment_pending':'pending',
    dimensions:{...row.dimensions,identity:wall?'original_route_subject_confirmed_specific_wall_pending':withdrawn?'brand_specific_branch_unresolved_withdrawn':'boundary_pending_after_text_review',
      category:wall?'culture_photo_spot_preserved':withdrawn?'withdrawal_placeholder_original_shop_retained':row.dimensions.category,
      location:withdrawn?'withdrawn_no_current_location_branch_pending':row.dimensions.location,media:'deferred_by_user',consumedFacts:wall?'original_highlight_date_preserved_foreign_tips_removed':withdrawn?'pending_branch_content_not_consumed':'current_consumption_preserved_boundary_pending'},
    followup:'第61批：'+review.rows.find(r=>r.entityId===eid).conclusion,
    mediaBoundary:'上游及独立来源/绑定0，实际图库null；只比较返回对象和元数据，未看图，不构成媒体验收。',
    reviewEvidence:[...(row.reviewEvidence??[]),dir+'built-place-source-packet-01.json',dir+'built-place-source-review-01.json',dir+'built-place-web-review-01.json',dir+'built-place-downstream-check-01.json',consumptionFile]});
  if(changed)Object.assign(row,{changeBatch:61,governedSourceIds:[g.entity.primary_place_id],scopeMentionIds:g.mentionIds,currentMentionIds:wall?[12688]:[],pendingScopeMentionIds:withdrawn?[11536]:[]});
}
for(let i=0;i<ledger.rows.length;i++)if(!ids.includes(ledger.rows[i].entityId))assert.deepEqual(ledger.rows[i],oldRows[i]);assert.deepEqual(ledger.rows.map(r=>[r.entityId,r.name]),oldRows.map(r=>[r.entityId,r.name]));
assert.equal(ledger.rows.filter(r=>['reviewed_scope_partial','mixed_source_withdrawn_assignment_pending'].includes(r.status)).length,42);assert.equal(ledger.rows.filter(r=>['pending','reviewed_identity_media_location_pending'].includes(r.status)).length,34);assert.equal(ledger.rows.filter(r=>r.status==='reviewed_identity_media_location_pending').length,16);
assert.equal(ledger.summary.governedScopeMentions,447);assert.equal(ledger.summary.wrongPointClearedPositionPending,24);
ledger.createdAt=at;ledger.previousLedger=dir+'review-40.json';Object.assign(ledger.summary,{partiallyReviewedScopeRows:42,governedScopeMentions:449,pendingScopeMentions:127,otherPendingPrimaryRows:34,confirmedBuiltPlaceMentions:1,
  fullyReviewedMeaning:'18原入选行对应16现行主体；第61批文字墙完整scope、淘子单店撤回，其余五主体边界待核，完整自查新增0。',
  scopeProgressMeaning:'98行保持：4非地点、18行AI自查、76未完成（42部分scope、34其余，其中16身份事实已查位置媒体待核）；177范围待审及4必去缺口。清点待定位24不变，撤回空点另计；原3文字发现未应用。'});
assert.equal(ledger.summary.fullyReviewed,18);assert.equal(ledger.summary.remainingPrimaryToReview,76);
const progress='第61批济南文字墙12688仅确认note2817第②站原主体，完整scope移除老商埠喜艾旁和月下观棠附近墙两条未归属提示，原看点/日期、文化photo_spot及既有空点保持，revision2→3。淘子外单全文列三分店但到访裸名，11536待审，旧单店显式撤回1→2，无not_a_place/新分店。七主体7源7提及/4全文，正式2源2提及/2全文、2scope及0实体决定，1确认/1待审/1撤回；其余五主体消费不变且边界继续待核，官网仅补证山东大厦酒店门牌。228记录/19关系/direct3、revision35，关系证据零变化；SQL隔离、幂等/逆序回滚和正常前置全城双导入通过。107原源/662提及/82全文、四篇发表采集时间/raw_json散列保持，累计312分配/127待审；专项7SQL/7真实向量（6正1撤回）/42边界和实际placeFacts/图库通过。238旧行/144图片字段/9绑定/201行程保持，旧图库3/1/2保持，七目标null、mock7→5、真实入队0。全仓/扩展typecheck通过，61实装文件哈希保持，无生产安装。flow63为324正例/113边界/51撤回零失败，淘子撤回历史持久化/身份保存及编辑拒绝通过；audit60为307PENDING。review41仍98行：4非地点、18行AI自查、76未完成（42部分scope、34其余，其中16身份事实已查位置媒体待核），scope提及449、清点待定位24不变、177范围待审及4必去缺口。原3文字发现保持，五项本组边界另见原文复核。实体61/元数据01/图片03，无待同步或向量待核；图片暂缓、天地图凭据待轮换、云南和长尾不扩入，未验收不提交归档。';
Object.assign(pointer,{latestAppliedEntityBatch:61,latestFlow:'../all-cities/flow/run-63',latestAudit:'../all-cities/audit/run-60',progressNote:progress,progressUpdatedAt:at,
  latestReviewEvidence:{file:'../'+dir+'built-place-downstream-check-01.json',supplement:'../'+dir+'built-place-source-review-01.json',fullReviewsAdded:0,partiallyReviewed:7,fullReviewsReopened:0}});
pointer.cityReviewLedgers['济南']='../'+dir+'review-41.json';Object.assign(pointer.currentScopeReviews,{addedPendingMentions:127,currentReviewRows:177,meaning:'50固定重点实体对加127提及待审；第61批1确认、1具体分店待审，淘子旧单店显式撤回仍未解决归属。原3文字发现未应用。'});
pointer.currentScopeReviews.evidence.push('../'+dir+'built-place-source-review-01.json');pointer.latestReadOnlyFindings.builtPlaceFollowup='../'+dir+'built-place-source-review-01.json';
pointer.resolvedFindings.push({entityId:wallId,name:'济南文字墙',status:'resolved_foreign_wall_tips_batch61_specific_wall_location_pending',resolvedByEntityBatch:61,confirmed:1,pending:0,evidence:'../'+dir+'built-place-downstream-check-01.json',fullReviewPassed:false,coordinatesCleared:false,preciseLocationResolved:false});
for(const k of ['unappliedFindings','unappliedMetadataFindings','resolvedMetadataFindings','latestMetadataRefresh','summary','scopeSha256','mapCredentialGate'])assert.deepEqual(pointer[k],before[k]);task.notes=progress+'见research/'+report+'。';
const prd=fs.readFileSync(url('../prd.md'),'utf8'),continuation=fs.readFileSync(url('nine-cities-continuation-20261007.md'),'utf8');const range=/^- 用户最新明确：\*\*云南不处理，继续其他城市直到验收通过\*\*。[^\n]*$/m;assert.ok(range.test(prd));assert.ok(prd.includes('## 已知事实\n')&&continuation.includes('## 本轮断点\n'));
const nextPrd=prd.replace(range,'- 用户最新明确：**云南不处理，继续其他城市直到验收通过**。九城固定978主体＋56依赖/1135源，177范围待审及4必去缺口。第61批文字墙外来提示隔离、淘子外单裸名单店撤回；其余五主体边界仍待核。济南18行AI自查、76未完成，原3文字发现未应用。图片暂缓；天地图凭据待轮换，其余文字继续。云南、89普通长尾和37已隔离错城来源归属不扩入主动范围，未获用户验收。').replace('## 已知事实\n','## 已知事实\n\n### 最新进展：第61批通用墙名提示与购物分店\n\n'+progress+'见[第61批记录](research/'+report+')。以下为历史快照。\n');
const nextContinuation=continuation.replace('## 本轮断点\n','## 本轮断点\n\n当前以review41为准。'+progress+'下一实体批次62使用flow64/audit61/review42，继续原范围，不重放61。见['+report+']('+report+')。以下为历史断点。\n');
const fresh=new Map([[dir+'review-41.json',json(ledger)],[dir+'review-41.md','# 济南98项重点清单核查台账（第61批）\n\n'+progress+'\n\n| 原名称 | 当前名称 | 版本 | 进度 | 说明 |\n| --- | --- | ---: | --- | --- |\n'+ledger.rows.map(r=>`| ${r.name} | ${r.currentName??r.name} | ${r.currentRevision} | ${r.status} | ${r.followup} |`).join('\n')+'\n'],['cleaning-scope/current-before-batch61.json',json(before)],
  [dir+'built-place-final-verification-01.json',json({batch:61,at,stats,productionCodeInstalled:false,installedManifestHashesVerified:61,isolatedSqlAndExport:true,reverseRollback:true,actualConsumptionTestPassed:true,rootTypecheck:true,extendedTypecheck:true,preflightSucceeded:true,
    frozenMembershipPreserved:{primary:978,dependencies:56,sourceRows:1135},fullReviewsAdded:0,remainingPrimaryToReview:76,partiallyReviewedScopeRows:42,otherPendingPrimaryRows:34,reviewedIdentityMediaLocationPending:16,unappliedSemanticFindings:3,
    confirmed:1,pendingAdded:1,withdrawals:1,explicitPointCleared:0,withdrawnCoordinatesRemoved:1,publicationAndRawJsonPreserved:true,consumptionFile,postFile,dualFile,imageComparison:'deferred_by_user',mapCredentialStatus:'rotation_required',userAcceptance:false})]]);
for(const p of fresh.keys())assert.ok(!fs.existsSync(url(p)),p+'已存在，不可重放');assert.ok(fs.existsSync(url(report)));
const replace=new Map([['../task.json',json(task)],['../prd.md',nextPrd],['nine-cities-continuation-20261007.md',nextContinuation]]);
for(const kind of ['implement','check']){const p=`../${kind}.jsonl`,entry={file:'.trellis/tasks/10-06-place-identity-governance/research/'+report,reason:'第61批通用墙名提示隔离与淘子单店撤回，五主体边界待核；review41/flow63/audit60，312分配/127待审，76未完成，不重放，不看图、未验收不提交归档'};const original=fs.readFileSync(url(p),'utf8');assert.ok(!original.includes(entry.file));replace.set(p,original+JSON.stringify(entry)+'\n');}
for(const [p,value]of fresh)fs.writeFileSync(url(p),value,{flag:'wx'});for(const [p,value]of replace)fs.writeFileSync(url(p),value);fs.writeFileSync(url('cleaning-scope/current.json'),json(pointer));
console.log(JSON.stringify({batch:61,ledger:'review-41',fullyReviewed:18,remaining:76,partialScope:42,otherPending:34,identityMediaLocationPending:16,pendingMentions:127,currentReviewRows:177,unappliedFindings:3,stats}));
