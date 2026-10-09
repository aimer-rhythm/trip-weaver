// 单次登记餐饮分店范围治理；不提交、归档或标记任务完成。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const url=p=>new URL(p,import.meta.url),read=p=>JSON.parse(fs.readFileSync(url(p),'utf8')),json=v=>JSON.stringify(v,null,2)+'\n';
const sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const dir='priority-cities/济南/',folder='all-cities/batch-60/sync-01/',report='batch60-jinan-remaining-food-20261009.md',at=new Date().toISOString();
const unique=(p,re)=>{const names=fs.readdirSync(url(p)).filter(n=>re.test(n));assert.equal(names.length,1);return p+names[0];};
const pointer=read('cleaning-scope/current.json'),before=structuredClone(pointer),task=read('../task.json');
assert.equal(pointer.latestAppliedEntityBatch,59);assert.equal(pointer.cityReviewLedgers['济南'],'../'+dir+'review-39.json');assert.equal(pointer.userAcceptance,false);
assert.equal(task.status,'in_progress');assert.equal(pointer.taskStatus,'in_progress');assert.deepEqual(pointer.pendingVerification,[]);
assert.equal(pointer.latestIndependentPhotoBatch,3);assert.equal(pointer.latestMetadataRefresh.run,1);assert.equal(pointer.imageComparisonPolicy.status,'deferred_by_user');assert.equal(pointer.mapCredentialGate.status,'rotation_required');assert.equal(pointer.unappliedFindings.length,3);
assert.equal(sha(url('cleaning-scope/'+pointer.scopeFile)),pointer.scopeSha256);const frozen=read('cleaning-scope/'+pointer.scopeFile);assert.deepEqual(frozen.summary,pointer.summary);
assert.equal(frozen.selected.length,978);assert.equal(frozen.dependencies.length,56);assert.equal(frozen.sourceIds.length,1135);assert.ok(frozen.selected.every(r=>r.place.city!=='云南'));
const source=read('all-cities/batch-60-source.json'),packet=read(dir+'remaining-food-source-packet-01.json'),scopes=read('all-cities/batch-60-scope-decisions.json'),decisions=read('all-cities/batch-60-decisions.json');
const westId='b8880b34d9a4e56942c76ea7a4e5555c',chenId='d342ff3eb8d541f17253786d0dd148fa',ids=packet.groups.map(g=>g.entity.entity_id);
assert.equal(sha(url('all-cities/batch-60-source.json')),'7556e3bc2c55be829354f5907ea4eaf103e1c33ef0750a1e97f9b60f4cb05fae');
assert.equal(sha(url(dir+'remaining-food-source-packet-01.json')),'48e8753038a64bdc397fb19083b4bf5cc2645f52eb8677815119caa573f6bfe4');
assert.equal(source.sources.length,4);assert.equal(source.mentions.length,10);assert.equal(source.notes.length,5);assert.equal(packet.notes.length,7);assert.equal(packet.mentions.length,12);
assert.equal(scopes.length,4);assert.equal(scopes.flatMap(s=>s.assignments).filter(a=>a.entityId===null).length,9);assert.equal(decisions.length,1);assert.deepEqual(decisions[0].overrides,{address:'济南西周边',lat:null,lng:null,geoStatus:'unresolvable'});
for(const k of ['preview','applied'])assert.equal(read(`all-cities/batch-60-${k}.json`).changes.length,5);assert.equal(read('all-cities/batch-60-applied.json').apply,true);
const sync=read(folder+'sync-state.json').cities['济南'];assert.ok(sync.importedAt&&sync.relationsImportedAt&&sync.embeddingRunAt);assert.equal(sync.relationSnapshotRevision,34);
assert.equal(sync.exportHash,sha(url(folder+'xhs-places-济南.json')));assert.equal(sync.relationHash,sha(url(folder+'xhs-place-relations-济南.json')));
const consumptionFile=unique(folder,/^remaining-food-consumption-\d+\.json$/),postFile=unique(folder,/^post-import-check-\d+\.json$/),dualFile=unique(folder+'preview-济南/',/^preview-\d+\.json$/);
const actual=read(dir+'remaining-food-downstream-check-01.json'),consumption=read(consumptionFile),pre=read(folder+'pre-import-check.json'),post=read(postFile);
for(const [k,v]of Object.entries({consumedFieldsVerified:228,assignmentRows:310,pendingMentions:126,scopesAdded:4,confirmed:1,pendingAdded:9,coordinatesCleared:1,newPreciseLocations:0,categoriesCorrected:0,ordinaryReviewed:1,withdrawals:3,withdrawnCoordinatesRemoved:3,sqlProbes:5,boundaryProbes:30,realVectorProbes:5,graph:19,directEdges:3}))assert.equal(actual[k],v);
assert.deepEqual(actual.fallbackObservedAtChanges,[]);assert.ok(actual.confirmedFactsAndDatesPreserved&&actual.unresolvedBranchFactsRemoved&&actual.priorReviewRowsPreserved);
assert.equal(actual.realVectors.length,5);assert.ok(actual.realVectors.every(v=>v.vector==='used'));assert.equal(actual.realVectors.filter(v=>v.withdrawn).length,3);
const vectors=read(folder+'verification-vectors.json');assert.equal(vectors.cities[0].vectorProbes.length,1);assert.ok(vectors.cities[0].vectorProbes.every(v=>v.diagnostics.vector==='used'));
assert.ok(consumption.actualPlaceFacts&&consumption.priorGovernedFactsPreserved&&consumption.independentSourceDigestUnchanged&&consumption.withdrawnFactExclusionVerified);
assert.deepEqual(consumption.media.map(r=>r.count),[3,1,2]);assert.deepEqual(consumption.mockEnqueueCalls,{before:5,after:1});assert.equal(consumption.actualEnqueues,0);
const media=read(dir+'remaining-food-photo-metadata-01.json');assert.ok(media.entities.every(p=>p.independentSources.length===0&&p.assignments.length===0));
assert.equal(pre.mode,'before');assert.equal(pre.cities[0].unchangedSincePreview,true);assert.ok(Date.parse(pre.at)<Date.parse(sync.importedAt));
assert.equal(post.cities[0].oldRowsPreserved,238);assert.equal(post.cities[0].photoFieldsPreserved,132);assert.equal(post.cities[0].independentPhotos,9);assert.deepEqual(post.trips,pre.trips);assert.deepEqual(post.trips,{count:201,digest:'e01d67cbf42a62fc595f4ef052f99e75'});
const isolated=read('all-cities/batch-60/scope-preview-1791497735217803400/report.json'),dual=read(dualFile),delta=read(folder+'preview-济南/relation-delta.json'),upstream=read('all-cities/batch-60-upstream-check.json');
assert.ok(isolated.idempotent&&isolated.reverseRollback&&isolated.originalSourcesAndMentionsUnchanged&&isolated.confirmedFactsAndDatesPreserved&&isolated.publicationDatesPreserved);assert.equal(isolated.withdrawals,3);
assert.ok(dual.reverseRollback&&dual.oldRowsPreserved&&dual.photosPreserved);assert.deepEqual(delta.changed,[]);assert.deepEqual(delta.removed,[]);
for(const [k,v]of Object.entries({rawSourcesUnchanged:107,originalMentionsUnchanged:662,originalNotesCovered:82,appliedEntitiesVerified:1,appliedScopesVerified:4,assignmentsVerified:10}))assert.equal(upstream[k],v);
assert.equal(upstream.finalEntityRevisions[westId],3);for(const g of source.groups)if(g.entity.entity_id!==westId)assert.equal(upstream.finalEntityRevisions[g.entity.entity_id],2);
const times=read(dir+'remaining-food-times-check-01.json');assert.equal(times.notes,7);assert.ok(times.publicationAndCollectionTimesPreserved&&times.rawJsonHashesPreserved);
const flow=read('all-cities/flow/run-62/report.json'),audit=read('all-cities/audit/run-59/report.json');
for(const r of [actual,consumption,pre,post,isolated,dual,upstream,flow,audit,vectors,times])assert.deepEqual(r.failures,[]);assert.equal(read('all-cities/flow/run-62/cleanup.json').removed,true);
assert.match(fs.readFileSync(url('downstream-place_identity_test_1791497961934.log'),'utf8'),/pass 1/);assert.match(fs.readFileSync(url('upstream-stage-place_identity_test_1791497733912.log'),'utf8'),/"reverseRollback": true/);
const stats={positive:flow.cities.reduce((n,c)=>n+c.probes.length,0),boundaries:flow.cities.reduce((n,c)=>n+c.negativeProbes.length,0),withdrawals:flow.cities.reduce((n,c)=>n+c.withdrawalProbes.length,0),pending:audit.cities.reduce((n,c)=>n+(c.statuses.PENDING??0),0)};assert.deepEqual(stats,{positive:324,boundaries:113,withdrawals:50,pending:306});
for(const id of isolated.withdrawnIds){const probe=flow.cities.find(c=>c.city==='济南').withdrawalProbes.find(p=>p.id===id);assert.ok(probe.sqlExcluded&&probe.nameRejected&&probe.oldIdRejected&&probe.persistence&&probe.historicalIdentityPreserved&&probe.newEditRejected);}
const install=read('upstream-install.json');assert.equal(install.files.length,61);for(const f of install.files)for(const p of [url('upstream/'+f.path),'D:/Project/xhs-travel-pipeline/'+f.path])assert.equal(sha(p),f.after);

const ledger=read(dir+'review-39.json'),oldRows=structuredClone(ledger.rows);
assert.deepEqual(ledger.rows.map(r=>[r.entityId,r.name]).sort(),frozen.selected.filter(r=>r.place.city==='济南').map(r=>[r.place.id,r.place.name]).sort());
for(const g of packet.groups){
  const eid=g.entity.entity_id,row=ledger.rows.find(r=>r.entityId===eid),west=eid===westId,ordinary=eid===chenId;assert.equal(row.currentRevision,1);assert.equal(row.status,'pending');
  const mentionIds=ordinary?g.mentionIds:west?[11375]:[],pending=ordinary?[]:g.mentionIds.filter(id=>!mentionIds.includes(id));
  Object.assign(row,{currentName:g.entity.canonical_name,currentEntityId:eid,currentRevision:ordinary?1:west?3:2,reviewBatch:60,
    status:ordinary?'reviewed_identity_media_location_pending':west?'reviewed_scope_partial':'mixed_source_withdrawn_assignment_pending',
    dimensions:{...row.dimensions,identity:ordinary?'ordinary_identity_full_source_checked':west?'west_jinan_mention_confirmed_other_branch_pending':'brand_specific_branch_unresolved_withdrawn',category:ordinary||west?'food_preserved':'withdrawal_placeholder_original_food_retained',location:ordinary?'historical_address_supported_point_not_newly_verified':west?'wrong_point_cleared_position_pending':'withdrawn_no_current_location_branch_pending',media:'deferred_by_user',consumedFacts:ordinary?'current_content_and_policies_checked_unchanged':west?'confirmed_dishes_and_dates_preserved':'pending_branch_content_not_consumed'},
    followup:ordinary?'第60批两篇普通餐饮推荐和现行内容只读核查，2018公开文字支持经七路423-2号历史门牌；不证明当前精确点或唯一分店，位置媒体待核。':west?'第60批保留明确济南西的11375及两条菜品看点，12806裸名菜单待审；地址仅济南西周边、旧梁庄点清空，原名保留，精确位置媒体待核。':'第60批完整scope后无可确认具体分店，旧裸名单店显式撤回，原文和稳定ID保留。提及继续待审，不将网页候选自动绑定，不表示停业或非地点。',
    mediaBoundary:'上游及独立来源/绑定0，实际图库null；未看图，不构成媒体验收。',reviewEvidence:[...(row.reviewEvidence??[]),dir+'remaining-food-source-packet-01.json',dir+'remaining-food-source-review-01.json',dir+'remaining-food-web-review-01.json',dir+'remaining-food-downstream-check-01.json',consumptionFile]});
  if(!ordinary)Object.assign(row,{changeBatch:60,governedSourceIds:[g.entity.primary_place_id],scopeMentionIds:g.mentionIds,currentMentionIds:mentionIds,pendingScopeMentionIds:pending});
}
for(let i=0;i<ledger.rows.length;i++)if(!ids.includes(ledger.rows[i].entityId))assert.deepEqual(ledger.rows[i],oldRows[i]);assert.deepEqual(ledger.rows.map(r=>[r.entityId,r.name]),oldRows.map(r=>[r.entityId,r.name]));
assert.equal(ledger.rows.filter(r=>['reviewed_scope_partial','mixed_source_withdrawn_assignment_pending'].includes(r.status)).length,40);assert.equal(ledger.rows.filter(r=>['pending','reviewed_identity_media_location_pending'].includes(r.status)).length,36);assert.equal(ledger.rows.filter(r=>r.status==='reviewed_identity_media_location_pending').length,16);
assert.equal(ledger.summary.governedScopeMentions,437);assert.equal(ledger.summary.wrongPointClearedPositionPending,23);
ledger.createdAt=at;ledger.previousLedger=dir+'review-39.json';Object.assign(ledger.summary,{partiallyReviewedScopeRows:40,governedScopeMentions:447,pendingScopeMentions:126,otherPendingPrimaryRows:36,reviewedOrdinaryPrimaryRows:16,reviewedIdentityMediaLocationPending:16,wrongPointClearedPositionPending:24,confirmedRemainingFoodMentions:1,
  fullyReviewedMeaning:'18原入选行对应16现行主体；第60批三品牌单店撤回、一个西部店scope及陈氏只读，位置媒体/分店继续待核，完整自查新增0。',
  scopeProgressMeaning:'98行保持：4非地点、18行AI自查、76未完成（40部分scope、36其余，其中16身份事实已查位置媒体待核）；176范围待审及4必去缺口。三撤回空坐标另计，不增加已定位数量；原3文字发现未应用。'});
assert.equal(ledger.summary.fullyReviewed,18);assert.equal(ledger.summary.remainingPrimaryToReview,76);
const progress='第60批超意兴/春水锅贴/草包包子因原文缺具体分店，以完整scope显式撤回旧单店消费，3根revision1→2、8提及待审；没有把网页候选当原文门店，没有not_a_place或停业判断。天天过年保留济南西明确11375及菜品看点，12806裸名待审，原名/ID保持，地址济南西周边、旧梁庄点清空，1→2→3。陈氏肥蛤两篇普通提及及消费保持，只读核历史门牌，不新定位。五主体5源12提及/7全文，正式4源10提及/5全文、4scope+1实体决定，1确认/9待审、无新实体/合并。228记录/19关系/direct3、revision34，关系内容0变化；SQL预演、幂等/逆序回滚和正常前置全城双导入通过。107原源/662提及/82全文、七篇发表采集日期/raw_json散列保持，累计310分配/126待审；专项5SQL/5真实向量（2正3撤回）/30边界和实际placeFacts/图库通过。238旧行/132图片字段/9绑定/201行程保持，旧图库3/1/2保持，五目标null、mock5→1、真实入队0。全仓/扩展typecheck通过，61实装文件哈希保持，无生产安装。flow62为324正例/113边界/50撤回零失败，三新增撤回历史持久化和编辑拒绝通过；audit59为306PENDING。review40仍98行：4非地点、18行AI自查、76未完成（40部分scope、36其余，其中16身份事实已查位置媒体待核），scope提及447，清点待定位24另有3撤回空点，176范围待审及4必去缺口。原3文字发现保持。实体60/元数据01/图片03，无待同步或向量待核；图片暂缓、天地图凭据待轮换、云南和长尾不扩入，未验收不提交归档。';
Object.assign(pointer,{latestAppliedEntityBatch:60,latestFlow:'../all-cities/flow/run-62',latestAudit:'../all-cities/audit/run-59',progressNote:progress,progressUpdatedAt:at,
  latestReviewEvidence:{file:'../'+dir+'remaining-food-downstream-check-01.json',supplement:'../'+dir+'remaining-food-source-review-01.json',fullReviewsAdded:0,partiallyReviewed:5,fullReviewsReopened:0}});
pointer.cityReviewLedgers['济南']='../'+dir+'review-40.json';Object.assign(pointer.currentScopeReviews,{addedPendingMentions:126,currentReviewRows:176,meaning:'50固定重点实体对加126提及待审；第60批1确认、9具体分店待审，三旧单店显式撤回仍未解决归属。原3文字发现未应用。'});
pointer.currentScopeReviews.evidence.push('../'+dir+'remaining-food-source-review-01.json');pointer.latestReadOnlyFindings.remainingFoodFollowup='../'+dir+'remaining-food-source-review-01.json';
pointer.resolvedFindings.push({entityId:westId,name:'天天过年',status:'resolved_partial_west_jinan_scope_and_unsupported_point_batch60',resolvedByEntityBatch:60,confirmed:1,pending:1,evidence:'../'+dir+'remaining-food-downstream-check-01.json',fullReviewPassed:false,coordinatesCleared:true,preciseLocationResolved:false});
for(const k of ['unappliedFindings','unappliedMetadataFindings','resolvedMetadataFindings','latestMetadataRefresh','summary','scopeSha256','mapCredentialGate'])assert.deepEqual(pointer[k],before[k]);task.notes=progress+'见research/'+report+'。';
const prd=fs.readFileSync(url('../prd.md'),'utf8'),continuation=fs.readFileSync(url('nine-cities-continuation-20261007.md'),'utf8');const range=/^- 用户最新明确：\*\*云南不处理，继续其他城市直到验收通过\*\*。[^\n]*$/m;assert.ok(range.test(prd));assert.ok(prd.includes('## 已知事实\n')&&continuation.includes('## 本轮断点\n'));
const nextPrd=prd.replace(range,'- 用户最新明确：**云南不处理，继续其他城市直到验收通过**。九城固定978主体＋56依赖/1135源，176范围待审及4必去缺口。第60批三裸名餐饮停止代指单店、天天过年西部范围及旧点已治理、陈氏只读核查；济南18行AI自查、76未完成。原3文字发现未应用，具体分店、位置/媒体继续待核。图片暂缓；天地图凭据待轮换，其余文字继续。云南、89普通长尾和37已隔离错城来源归属不扩入主动范围，未获用户验收。').replace('## 已知事实\n','## 已知事实\n\n### 最新进展：第60批餐饮品牌与具体门店\n\n'+progress+'见[第60批记录](research/'+report+')。以下为历史快照。\n');
const nextContinuation=continuation.replace('## 本轮断点\n','## 本轮断点\n\n当前以review40为准。'+progress+'下一实体批次61使用flow63/audit60/review41，继续原范围，不重放60。见['+report+']('+report+')。以下为历史断点。\n');
const fresh=new Map([[dir+'review-40.json',json(ledger)],[dir+'review-40.md','# 济南98项重点清单核查台账（第60批）\n\n'+progress+'\n\n| 原名称 | 当前名称 | 版本 | 进度 | 说明 |\n| --- | --- | ---: | --- | --- |\n'+ledger.rows.map(r=>`| ${r.name} | ${r.currentName??r.name} | ${r.currentRevision} | ${r.status} | ${r.followup} |`).join('\n')+'\n'],['cleaning-scope/current-before-batch60.json',json(before)],
  [dir+'remaining-food-final-verification-01.json',json({batch:60,at,stats,productionCodeInstalled:false,installedManifestHashesVerified:61,isolatedSqlAndExport:true,reverseRollback:true,actualConsumptionTestPassed:true,rootTypecheck:true,extendedTypecheck:true,preflightSucceeded:true,
    frozenMembershipPreserved:{primary:978,dependencies:56,sourceRows:1135},fullReviewsAdded:0,remainingPrimaryToReview:76,partiallyReviewedScopeRows:40,otherPendingPrimaryRows:36,reviewedIdentityMediaLocationPending:16,unappliedSemanticFindings:3,
    confirmed:1,pendingAdded:9,withdrawals:3,explicitPointCleared:1,withdrawnCoordinatesRemoved:3,publicationAndRawJsonPreserved:true,consumptionFile,postFile,dualFile,imageComparison:'deferred_by_user',mapCredentialStatus:'rotation_required',userAcceptance:false})]]);
for(const p of fresh.keys())assert.ok(!fs.existsSync(url(p)),p+'已存在，不可重放');assert.ok(fs.existsSync(url(report)));
const replace=new Map([['../task.json',json(task)],['../prd.md',nextPrd],['nine-cities-continuation-20261007.md',nextContinuation]]);
for(const kind of ['implement','check']){const p=`../${kind}.jsonl`,entry={file:'.trellis/tasks/10-06-place-identity-governance/research/'+report,reason:'第60批三裸名餐饮显式撤回、天天过年西部scope及旧点清除、陈氏只读；review40/flow62/audit59，总310分配/126待审，76未完成，不重放，不看图、未验收不提交归档'};const original=fs.readFileSync(url(p),'utf8');assert.ok(!original.includes(entry.file));replace.set(p,original+JSON.stringify(entry)+'\n');}
for(const [p,value]of fresh)fs.writeFileSync(url(p),value,{flag:'wx'});for(const [p,value]of replace)fs.writeFileSync(url(p),value);fs.writeFileSync(url('cleaning-scope/current.json'),json(pointer));
console.log(JSON.stringify({batch:60,ledger:'review-40',fullyReviewed:18,remaining:76,partialScope:40,otherPending:36,identityMediaLocationPending:16,pendingMentions:126,currentReviewRows:176,unappliedFindings:3,stats}));
