// 仅登记已验证批次进展；不提交、归档或标记任务完成。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const url=p=>new URL(p,import.meta.url),read=p=>JSON.parse(fs.readFileSync(url(p),'utf8')),json=v=>JSON.stringify(v,null,2)+'\n';
const sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const dir='priority-cities/济南/',folder='all-cities/batch-62/sync-01/',report='batch62-jinan-remaining-streets-20261009.md',at=new Date().toISOString();
const unique=(p,re)=>{const names=fs.readdirSync(url(p)).filter(n=>re.test(n));assert.equal(names.length,1);return p+names[0];};
const pointer=read('cleaning-scope/current.json'),before=structuredClone(pointer),task=read('../task.json');
assert.equal(pointer.latestAppliedEntityBatch,61);assert.equal(pointer.cityReviewLedgers['济南'],'../'+dir+'review-41.json');
assert.equal(pointer.userAcceptance,false);assert.equal(task.status,'in_progress');assert.equal(pointer.taskStatus,'in_progress');assert.deepEqual(pointer.pendingVerification,[]);
assert.equal(pointer.latestIndependentPhotoBatch,3);assert.equal(pointer.latestMetadataRefresh.run,1);assert.equal(pointer.imageComparisonPolicy.status,'deferred_by_user');assert.equal(pointer.mapCredentialGate.status,'rotation_required');assert.equal(pointer.unappliedFindings.length,3);
assert.equal(sha(url('cleaning-scope/'+pointer.scopeFile)),pointer.scopeSha256);const frozen=read('cleaning-scope/'+pointer.scopeFile);assert.deepEqual(frozen.summary,pointer.summary);
assert.equal(frozen.selected.length,978);assert.equal(frozen.dependencies.length,56);assert.equal(frozen.sourceIds.length,1135);assert.ok(frozen.selected.every(r=>r.place.city!=='云南'));
const packet=read(dir+'remaining-streets-source-packet-01.json'),source=read('all-cities/batch-62-source.json'),scopes=read('all-cities/batch-62-scope-decisions.json'),decisions=read('all-cities/batch-62-decisions.json');
assert.equal(sha(url('all-cities/batch-62-source.json')),'4a9b3d7ed4789bc055ec5c27596e2286c572be528cd1cb390c7a1e03708fbd1a');
assert.equal(sha(url(dir+'remaining-streets-source-packet-01.json')),'bad993b7d5bd657fe860c149c3ea66db204f37f08f99813e0c79805d1e0691e3');
assert.deepEqual([source.sources.length,source.mentions.length,source.notes.length,packet.mentions.length,packet.notes.length,scopes.length,decisions.length],[4,37,28,38,28,2,3]);
assert.equal(scopes.flatMap(s=>s.assignments).filter(a=>a.entityId===null).length,3);
for(const k of ['preview','applied'])assert.equal(read(`all-cities/batch-62-${k}.json`).changes.length,5);assert.equal(read('all-cities/batch-62-applied.json').apply,true);
const sync=read(folder+'sync-state.json').cities['济南'];assert.ok(sync.importedAt&&sync.relationsImportedAt&&sync.embeddingRunAt);assert.equal(sync.relationSnapshotRevision,36);
assert.equal(sync.exportHash,sha(url(folder+'xhs-places-济南.json')));assert.equal(sync.relationHash,sha(url(folder+'xhs-place-relations-济南.json')));
const consumptionFile=unique(folder,/^remaining-streets-consumption-\d+\.json$/),postFile=unique(folder,/^post-import-check-\d+\.json$/),dualFile=unique(folder+'preview-济南/',/^preview-\d+\.json$/);
const actual=read(dir+'remaining-streets-downstream-check-01.json'),consumption=read(consumptionFile),pre=read(folder+'pre-import-check.json'),post=read(postFile),vectors=read(folder+'verification-vectors-positive.json');
for(const [k,v]of Object.entries({consumedFieldsVerified:228,assignmentRows:318,pendingMentions:130,scopesAdded:2,confirmed:3,pendingAdded:3,coordinatesCleared:0,newPreciseLocations:0,categoriesCorrected:3,readOnlyBoundaryPending:1,withdrawals:1,withdrawnCoordinatesRemoved:1,sqlProbes:5,boundaryProbes:30,realVectorProbes:5,graph:19,directEdges:3,relationEndpointRevisionsUpdated:2}))assert.equal(actual[k],v);
assert.deepEqual(actual.fallbackObservedAtChanges,[]);assert.ok(actual.furongNegativeOpinionsPreserved&&actual.furongDescriptionGovernanceDeferred&&actual.relationEvidenceAndStrengthPreserved);
assert.ok(actual.realVectors.every(v=>v.vector==='used'));assert.equal(actual.realVectors.filter(v=>v.withdrawn).length,1);assert.equal(vectors.cities[0].vectorProbes.length,3);
assert.ok(consumption.actualPlaceFacts&&consumption.priorGovernedFactsPreserved&&consumption.independentSourceDigestUnchanged&&consumption.withdrawnFactExclusionVerified&&consumption.furongNegativeOpinionsPreserved);
assert.deepEqual(consumption.media.map(r=>r.count),[3,1,2]);assert.deepEqual(consumption.mockEnqueueCalls,{before:5,after:3});assert.equal(consumption.actualEnqueues,0);
const media=read(dir+'remaining-streets-photo-metadata-01.json'),photoPre=read(dir+'remaining-streets-photo-preflight-01.json');assert.equal(media.entities.length,5);assert.ok(media.entities.every(p=>p.independentSources.length===0&&p.assignments.length===0));assert.ok(photoPre.existingPhotoConsumptionPreserved);
assert.equal(pre.mode,'before');assert.equal(pre.cities[0].unchangedSincePreview,true);assert.ok(Date.parse(pre.at)<Date.parse(sync.importedAt));
assert.equal(post.cities[0].oldRowsPreserved,238);assert.equal(post.cities[0].photoFieldsPreserved,150);assert.equal(post.cities[0].independentPhotos,9);assert.deepEqual(post.trips,pre.trips);assert.deepEqual(post.trips,{count:201,digest:'e01d67cbf42a62fc595f4ef052f99e75'});
const isolated=read('all-cities/batch-62/scope-preview-1791499737776609800/report.json'),dual=read(dualFile),delta=read(folder+'preview-济南/relation-delta.json'),upstream=read('all-cities/batch-62-upstream-check.json');
assert.ok(isolated.idempotent&&isolated.reverseRollback&&isolated.originalSourcesAndMentionsUnchanged&&isolated.confirmedFactsAndDatesPreserved&&isolated.publicationDatesPreserved);
assert.ok(dual.reverseRollback&&dual.oldRowsPreserved&&dual.photosPreserved);assert.equal(delta.changed.length,2);assert.deepEqual(delta.removed,[]);
for(const [k,v]of Object.entries({rawSourcesUnchanged:107,originalMentionsUnchanged:662,originalNotesCovered:82,appliedEntitiesVerified:3,appliedScopesVerified:2,assignmentsVerified:6}))assert.equal(upstream[k],v);
const times=read(dir+'remaining-streets-times-check-01.json');assert.equal(times.batch,62);assert.equal(times.notes,28);assert.equal(times.supplementalNotes,1);assert.ok(times.publicationAndCollectionTimesPreserved&&times.rawJsonHashesPreserved&&times.supplementalAnalysisPreserved);
const flow=read('all-cities/flow/run-64/report.json'),audit=read('all-cities/audit/run-61/report.json');
for(const r of [actual,consumption,pre,post,isolated,dual,upstream,flow,audit,vectors,times,photoPre])assert.deepEqual(r.failures,[]);assert.equal(read('all-cities/flow/run-64/cleanup.json').removed,true);
assert.match(fs.readFileSync(url('downstream-place_identity_test_1791500031039.log'),'utf8'),/pass 1/);assert.match(fs.readFileSync(url('upstream-stage-place_identity_test_1791499736538.log'),'utf8'),/"reverseRollback": true/);
const stats={positive:flow.cities.reduce((n,c)=>n+c.probes.length,0),boundaries:flow.cities.reduce((n,c)=>n+c.negativeProbes.length,0),withdrawals:flow.cities.reduce((n,c)=>n+c.withdrawalProbes.length,0),pending:audit.cities.reduce((n,c)=>n+(c.statuses.PENDING??0),0)};assert.deepEqual(stats,{positive:326,boundaries:113,withdrawals:52,pending:310});
const shopId='e1cfa0121a1455efea5324938742d4f4',furongId='747792d1b5834255f5feaa6c2dc62925';
const probe=flow.cities.find(c=>c.city==='济南').withdrawalProbes.find(p=>p.id===shopId);assert.ok(probe.sqlExcluded&&probe.nameRejected&&probe.oldIdRejected&&probe.persistence&&probe.historicalIdentityPreserved&&probe.newEditRejected);
const install=read('upstream-install.json');assert.equal(install.files.length,61);for(const f of install.files)for(const p of [url('upstream/'+f.path),'D:/Project/xhs-travel-pipeline/'+f.path])assert.equal(sha(p),f.after);
const ledger=read(dir+'review-41.json'),oldRows=structuredClone(ledger.rows),review=read(dir+'remaining-streets-source-review-01.json'),ids=packet.groups.map(g=>g.entity.entity_id);
assert.deepEqual(ledger.rows.map(r=>[r.entityId,r.name]).sort(),frozen.selected.filter(r=>r.place.city==='济南').map(r=>[r.place.id,r.place.name]).sort());
for(const g of packet.groups){
  const eid=g.entity.entity_id,sid=g.entity.primary_place_id,row=ledger.rows.find(r=>r.entityId===eid),street=sid===5393,withdrawn=sid===5382,changed=sid!==6002;
  assert.equal(row.currentRevision,g.entity.revision);assert.equal(row.status,'pending');
  Object.assign(row,{currentName:g.entity.canonical_name,currentEntityId:eid,currentRevision:g.entity.revision+(street?2:changed?1:0),reviewBatch:62,
    status:street?'reviewed_scope_partial':withdrawn?'mixed_source_withdrawn_assignment_pending':'pending',
    dimensions:{...row.dimensions,identity:street?'street_route_subject_confirmed_walls_not_merged':withdrawn?'brand_specific_branch_unresolved_withdrawn':sid===5353?'historic_street_confirmed_restaurant_mentions_pending':sid===5403?'river_corridor_specific_segment_pending':'boundary_pending_after_text_review',
      category:withdrawn?'withdrawal_placeholder_original_food_retained':sid===5403?'nature_attraction_corrected':[5353,5393].includes(sid)?'culture_other_street_corrected':row.dimensions.category,
      location:withdrawn?'withdrawn_no_current_location_branch_pending':row.dimensions.location,media:'deferred_by_user',consumedFacts:street?'independent_30_minutes_and_wall_highlights_preserved':withdrawn?'pending_branch_content_not_consumed':sid===5353?'negative_opinions_and_all_facts_preserved_description_scope_unapplied':'current_facts_preserved'},
    followup:'第62批：'+review.rows.find(r=>r.entityId===eid).conclusion,
    mediaBoundary:'上游及独立来源/绑定0，实际图库null；只比较返回对象和元数据，未看图，不构成媒体验收。',
    reviewEvidence:[...(row.reviewEvidence??[]),dir+'remaining-streets-source-packet-01.json',dir+'remaining-streets-source-review-01.json',dir+'remaining-streets-web-review-01.json',dir+'remaining-streets-downstream-check-01.json',consumptionFile]});
  if(changed)row.changeBatch=62;
  if(street||withdrawn)Object.assign(row,{governedSourceIds:[sid],scopeMentionIds:g.mentionIds,currentMentionIds:street?g.mentionIds:[],pendingScopeMentionIds:withdrawn?g.mentionIds:[]});
}
for(let i=0;i<ledger.rows.length;i++)if(!ids.includes(ledger.rows[i].entityId))assert.deepEqual(ledger.rows[i],oldRows[i]);assert.deepEqual(ledger.rows.map(r=>[r.entityId,r.name]),oldRows.map(r=>[r.entityId,r.name]));
assert.equal(ledger.rows.filter(r=>['reviewed_scope_partial','mixed_source_withdrawn_assignment_pending'].includes(r.status)).length,44);assert.equal(ledger.rows.filter(r=>['pending','reviewed_identity_media_location_pending'].includes(r.status)).length,32);assert.equal(ledger.rows.filter(r=>r.status==='reviewed_identity_media_location_pending').length,16);
assert.equal(ledger.summary.governedScopeMentions,449);assert.equal(ledger.summary.wrongPointClearedPositionPending,24);
ledger.createdAt=at;ledger.previousLedger=dir+'review-41.json';Object.assign(ledger.summary,{partiallyReviewedScopeRows:44,governedScopeMentions:455,pendingScopeMentions:130,otherPendingPrimaryRows:32,confirmedRemainingStreetMentions:3,unappliedSemanticFindings:4,
  fullyReviewedMeaning:'18原入选行对应16现行主体；第62批类别修订、后宰门街scope与油旋张撤回，完整自查新增0。',
  scopeProgressMeaning:'98行保持：4非地点、18行AI自查、76未完成（44部分scope、32其余，其中16身份事实已查位置媒体待核）；180范围待审及4必去缺口。清点待定位24不变，撤回空点另计；原3文字发现保持，新增芙蓉街未应用描述治理。'});
assert.equal(ledger.summary.fullyReviewed,18);assert.equal(ledger.summary.remainingPrimaryToReview,76);
const progress='第62批芙蓉街由美食/food改文化/other，继承已纠正点与地址；两餐馆描述及混合tips未应用治理，补查note2568确定有效作者负面意见，全部现有正负评价保持。后宰门街3条完整scope确认，文化/other，独立30分钟及两看点/日期保持，1→3；腊山河廊道只改自然/attraction，未新定位；油旋张三裸名提及待审，旧单店1→2显式撤回，不造分店或标非地点；泉源之眼同体待核。5源38提及/28全文加1补充全文，正式4源37提及/28全文、2scope/6分配及3类别决定，3确认3待审1撤回。228记录/19关系/direct3、revision36，只有两处芙蓉街关系端点升版，证据强度保持；隔离SQL/幂等/倒序回滚及正常前置双导入通过。107原源/662提及/82全文、28篇时间/raw_json及补充note2568时间/raw_json/分析散列保持，318累计分配/130待审。5SQL/5真实向量（4正1撤回）/30边界、实际placeFacts/图库通过；通用向量正例误含撤回的首轮失败保留，另有正例报告和专项撤回排除。238旧行/150图片字段/9绑定/201行程保持，旧图库3/1/2、五目标null、mock5→3、真实入队0。全仓/扩展typecheck和7同步契约测试通过，61实装哈希保持，无生产安装。flow64为326正例/113边界/52撤回零失败，油旋张历史引用/持久化/新增编辑拒绝通过；audit61为310PENDING。review42仍98行：4非地点18行AI自查76未完成（44部分scope32其余，其中16身份事实已查位置媒体待核），scope提及455、清点待定位24、180范围待审及4必去缺口；4项文字发现未应用。实体62/元数据01/图片03，无待同步；图片暂缓、天地图凭据待轮换、云南长尾不扩入，未验收不提交归档。';
Object.assign(pointer,{latestAppliedEntityBatch:62,latestFlow:'../all-cities/flow/run-64',latestAudit:'../all-cities/audit/run-61',progressNote:progress,progressUpdatedAt:at,
  latestReviewEvidence:{file:'../'+dir+'remaining-streets-downstream-check-01.json',supplement:'../'+dir+'remaining-streets-source-review-01.json',fullReviewsAdded:0,partiallyReviewed:5,fullReviewsReopened:0}});
pointer.cityReviewLedgers['济南']='../'+dir+'review-42.json';Object.assign(pointer.currentScopeReviews,{addedPendingMentions:130,currentReviewRows:180,meaning:'50固定重点实体对加130提及待审；第62批3确认、3具体分店待审，油旋张旧单店撤回未解决归属。4项文字发现未应用。'});
pointer.currentScopeReviews.evidence.push('../'+dir+'remaining-streets-source-review-01.json');pointer.latestReadOnlyFindings.remainingStreetsFollowup='../'+dir+'remaining-streets-source-review-01.json';
pointer.unappliedFindings.push({entityId:furongId,name:'芙蓉街',sourceIds:[5353],mentionIds:[12904,12948],supplementalNoteId:2568,status:'unapplied_description_scope_preserve_valid_negative_image_text_opinion',reason:review.furongUnapplied.reason,discoveredDuringEntityBatch:62,evidence:'../'+dir+'remaining-streets-source-review-01.json',fullReviewPassed:false});
pointer.resolvedFindings.push({entityId:'9dbf8ef94ec1777461c9d486973ce0c7',name:'后宰门街',status:'resolved_street_category_and_independent_duration_scope_batch62',resolvedByEntityBatch:62,confirmed:3,pending:0,evidence:'../'+dir+'remaining-streets-downstream-check-01.json',fullReviewPassed:false,coordinatesCleared:false,preciseLocationResolved:false});
assert.deepEqual(pointer.unappliedFindings.slice(0,3),before.unappliedFindings);
for(const k of ['unappliedMetadataFindings','resolvedMetadataFindings','latestMetadataRefresh','summary','scopeSha256','mapCredentialGate'])assert.deepEqual(pointer[k],before[k]);task.notes=progress+'见research/'+report+'。';
const prd=fs.readFileSync(url('../prd.md'),'utf8'),continuation=fs.readFileSync(url('nine-cities-continuation-20261007.md'),'utf8');const range=/^- 用户最新明确：\*\*云南不处理，继续其他城市直到验收通过\*\*。[^\n]*$/m;assert.ok(range.test(prd));assert.ok(prd.includes('## 已知事实\n')&&continuation.includes('## 本轮断点\n'));
const nextPrd=prd.replace(range,'- 用户最新明确：**云南不处理，继续其他城市直到验收通过**。九城固定978主体＋56依赖/1135源，180范围待审及4必去缺口。第62批街道/廊道类别修订、后宰门街scope和油旋张单店撤回；芙蓉街剩余描述为保留有效负面意见暂未应用。济南18行AI自查、76未完成，4项文字发现未应用。图片暂缓；天地图凭据待轮换，云南和普通长尾不扩入主动范围，未获用户验收。').replace('## 已知事实\n','## 已知事实\n\n### 最新进展：第62批街道廊道与分店\n\n'+progress+'见[第62批记录](research/'+report+')。以下为历史快照。\n');
const nextContinuation=continuation.replace('## 本轮断点\n','## 本轮断点\n\n当前以review42为准。'+progress+'下一实体批次63使用flow65/audit62/review43，继续原范围，不重放62。见['+report+']('+report+')。以下为历史断点。\n');
const fresh=new Map([[dir+'review-42.json',json(ledger)],[dir+'review-42.md','# 济南98项重点清单核查台账（第62批）\n\n'+progress+'\n\n| 原名称 | 当前名称 | 版本 | 进度 | 说明 |\n| --- | --- | ---: | --- | --- |\n'+ledger.rows.map(r=>`| ${r.name} | ${r.currentName??r.name} | ${r.currentRevision} | ${r.status} | ${r.followup} |`).join('\n')+'\n'],['cleaning-scope/current-before-batch62.json',json(before)],
  [dir+'remaining-streets-final-verification-01.json',json({batch:62,at,stats,productionCodeInstalled:false,installedManifestHashesVerified:61,isolatedSqlAndExport:true,reverseRollback:true,actualConsumptionTestPassed:true,rootTypecheck:true,extendedTypecheck:true,syncContractTests:7,preflightSucceeded:true,
    frozenMembershipPreserved:{primary:978,dependencies:56,sourceRows:1135},fullReviewsAdded:0,remainingPrimaryToReview:76,partiallyReviewedScopeRows:44,otherPendingPrimaryRows:32,reviewedIdentityMediaLocationPending:16,unappliedSemanticFindings:4,
    confirmed:3,pendingAdded:3,withdrawals:1,explicitPointCleared:0,withdrawnCoordinatesRemoved:1,publicationAndRawJsonPreserved:true,furongNegativeOpinionsPreserved:true,consumptionFile,postFile,dualFile,imageComparison:'deferred_by_user',mapCredentialStatus:'rotation_required',userAcceptance:false})]]);
for(const p of fresh.keys())assert.ok(!fs.existsSync(url(p)),p+'已存在，不可重放');assert.ok(fs.existsSync(url(report)));
const replace=new Map([['../task.json',json(task)],['../prd.md',nextPrd],['nine-cities-continuation-20261007.md',nextContinuation]]);
for(const kind of ['implement','check']){const p=`../${kind}.jsonl`,entry={file:'.trellis/tasks/10-06-place-identity-governance/research/'+report,reason:'第62批街道/廊道类别、后宰门街scope和油旋张撤回；芙蓉街有效负面意见保留，剩余描述未应用。review42/flow64/audit61，318分配/130待审，76未完成，不重放，不看图、未验收不提交归档'};const original=fs.readFileSync(url(p),'utf8');assert.ok(!original.includes(entry.file));replace.set(p,original+JSON.stringify(entry)+'\n');}
for(const [p,value]of fresh)fs.writeFileSync(url(p),value,{flag:'wx'});for(const [p,value]of replace)fs.writeFileSync(url(p),value);fs.writeFileSync(url('cleaning-scope/current.json'),json(pointer));
console.log(JSON.stringify({batch:62,ledger:'review-42',fullyReviewed:18,remaining:76,partialScope:44,otherPending:32,identityMediaLocationPending:16,pendingMentions:130,currentReviewRows:180,unappliedFindings:4,stats}));
