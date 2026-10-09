// 第53批完成验证后的单次登记；不修改业务库、不提交、不归档。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const url=p=>new URL(p,import.meta.url),read=p=>JSON.parse(fs.readFileSync(url(p),'utf8'));
const sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex'),json=v=>JSON.stringify(v,null,2)+'\n';
const dir='priority-cities/济南/',batch='all-cities/batch-53/',folder=batch+'sync-01/',report='batch53-jinan-food-branches-20261009.md',at=new Date().toISOString();
const pointer=read('cleaning-scope/current.json'),before=structuredClone(pointer),task=read('../task.json');
const ids=['cc3ebff96b9f814d82ef808324a42400','97c845bd4afbe220afe8545ed5030c95'];
assert.equal(pointer.latestAppliedEntityBatch,52);assert.equal(pointer.cityReviewLedgers['济南'],'../'+dir+'review-32.json');
assert.equal(pointer.userAcceptance,false);assert.equal(pointer.taskStatus,'in_progress');assert.equal(task.status,'in_progress');
assert.equal(pointer.latestIndependentPhotoBatch,3);assert.equal(pointer.latestMetadataRefresh.run,1);assert.equal(pointer.imageComparisonPolicy.status,'deferred_by_user');
assert.equal(pointer.mapCredentialGate.status,'rotation_required');assert.deepEqual(pointer.pendingVerification,[]);
assert.equal(pointer.unappliedFindings.length,2);assert.deepEqual(pointer.unappliedMetadataFindings,[]);
assert.equal(sha(url('cleaning-scope/'+pointer.scopeFile)),pointer.scopeSha256);
const frozen=read('cleaning-scope/'+pointer.scopeFile);assert.deepEqual(frozen.summary,pointer.summary);
assert.equal(frozen.selected.length,978);assert.equal(frozen.dependencies.length,56);assert.equal(frozen.sourceIds.length,1135);assert.ok(frozen.selected.every(r=>r.place.city!=='云南'));
const source=read('all-cities/batch-53-source.json'),scopes=read('all-cities/batch-53-scope-decisions.json');
assert.equal(sha(url('all-cities/batch-53-source.json')),'63f73a5c07c562769ed6413129bbabecdbade9ac7a569d6ae671d28280789392');
assert.equal(sha(url(dir+'food-branches-source-packet-01.json')),'c6bb1c6ba7fab6a3691e93a37c7632190c9de1394406a0c4519244d92f7a25ff');
assert.equal(source.sources.length,2);assert.equal(source.mentions.length,6);assert.equal(source.notes.length,6);
assert.equal(scopes.length,2);const decisions=read('all-cities/batch-53-decisions.json');assert.equal(decisions.length,2);
assert.equal(read('all-cities/batch-53-applied.json').apply,true);
for(const kind of ['preview','applied'])assert.equal(read(`all-cities/batch-53-${kind}.json`).changes.length,4);
const sync=read(folder+'sync-state.json').cities['济南'];assert.ok(sync.importedAt&&sync.relationsImportedAt&&sync.embeddingRunAt);assert.equal(sync.relationSnapshotRevision,27);
assert.equal(sync.exportHash,sha(url(folder+'xhs-places-济南.json')));assert.equal(sync.relationHash,sha(url(folder+'xhs-place-relations-济南.json')));
const actual=read(dir+'food-branches-downstream-check-01.json'),consumption=read(folder+'food-branches-consumption-1791492100509.json');
for(const [k,v]of Object.entries({consumedFieldsVerified:228,assignmentRows:278,pendingMentions:112,scopesAdded:2,confirmed:3,pendingAdded:3,coordinatesCleared:0,newPreciseLocations:0,categoriesCorrected:0,addressesAdded:0,sqlProbes:4,boundaryProbes:18,realVectorProbes:2}))assert.equal(actual[k],v);
assert.deepEqual(actual.fallbackObservedAtChanges,[]);assert.ok(actual.priorReviewRowsPreserved&&actual.rawDerivedCachesPreserved&&actual.confirmedFactsPreserved);
assert.ok(consumption.actualPlaceFacts&&consumption.confirmedContentPreserved&&consumption.mixedBranchContentRemoved&&consumption.priorGovernedFactsPreserved&&consumption.independentSourceDigestUnchanged);
assert.deepEqual(consumption.media.map(r=>r.count),[3,1]);assert.deepEqual(consumption.mockEnqueueCalls,{before:2,after:0});assert.equal(consumption.actualEnqueues,0);
const pre=read(folder+'pre-import-check.json'),post=read(folder+'post-import-check-1791492023279.json');
assert.equal(pre.mode,'before');assert.equal(pre.cities[0].unchangedSincePreview,true);assert.ok(Date.parse(pre.at)<Date.parse(sync.importedAt));
assert.equal(post.cities[0].oldRowsPreserved,238);assert.equal(post.cities[0].photoFieldsPreserved,93);assert.equal(post.cities[0].independentPhotos,9);
assert.deepEqual(post.trips,pre.trips);assert.deepEqual(post.trips,{count:201,digest:'e01d67cbf42a62fc595f4ef052f99e75'});
const isolated=read(batch+'scope-preview-1791491956939237400/report.json'),dual=read(folder+'preview-济南/preview-1791491995525.json');
assert.ok(isolated.idempotent&&isolated.reverseRollback&&isolated.originalSourcesAndMentionsUnchanged);assert.equal(isolated.pendingAdded,3);
assert.ok(dual.reverseRollback&&dual.oldRowsPreserved&&dual.photosPreserved);
const delta=read(folder+'preview-济南/relation-delta.json');assert.deepEqual(delta.changed,[]);assert.deepEqual(delta.removed,[]);
const upstream=read('all-cities/batch-53-upstream-check.json');
for(const [k,v]of Object.entries({rawSourcesUnchanged:107,originalMentionsUnchanged:662,originalNotesCovered:82,appliedEntitiesVerified:2,appliedScopesVerified:2,assignmentsVerified:6}))assert.equal(upstream[k],v);
for(const eid of ids)assert.equal(upstream.finalEntityRevisions[eid],3);
const flow=read('all-cities/flow/run-55/report.json'),audit=read('all-cities/audit/run-52/report.json');
for(const r of [actual,consumption,pre,post,isolated,dual,upstream,flow,audit,read(folder+'verification-vectors.json')])assert.deepEqual(r.failures,[]);
assert.equal(read('all-cities/flow/run-55/cleanup.json').removed,true);
assert.match(fs.readFileSync(url('downstream-place_identity_test_1791492092618.log'),'utf8'),/pass 1/);
assert.match(fs.readFileSync(url('upstream-stage-place_identity_test_1791491955291.log'),'utf8'),/"reverseRollback": true/);
const stats={positive:flow.cities.reduce((n,c)=>n+c.probes.length,0),boundaries:flow.cities.reduce((n,c)=>n+c.negativeProbes.length,0),withdrawals:flow.cities.reduce((n,c)=>n+c.withdrawalProbes.length,0),pending:audit.cities.reduce((n,c)=>n+(c.statuses.PENDING??0),0)};
assert.deepEqual(stats,{positive:312,boundaries:113,withdrawals:47,pending:292});
const install=read('upstream-install.json');assert.equal(install.files.length,61);
for(const f of install.files)for(const p of [url('upstream/'+f.path),'D:/Project/xhs-travel-pipeline/'+f.path])assert.equal(sha(p),f.after);

const ledger=read(dir+'review-32.json'),oldRows=structuredClone(ledger.rows),followup=read(dir+'beverage-followup-source-review-01.json');
assert.deepEqual(ledger.rows.map(r=>[r.entityId,r.name]).sort(),frozen.selected.filter(r=>r.place.city==='济南').map(r=>[r.place.id,r.place.name]).sort());
const touched=new Set(ids);
for(const g of source.groups) {
  const eid=g.entity.entity_id,row=ledger.rows.find(r=>r.entityId===eid),d=decisions.find(d=>d.entityId===eid),scope=scopes.find(s=>s.sourcePlaceId===g.entity.primary_place_id);
  assert.equal(row.currentRevision,1);assert.equal(row.status,'pending');
  Object.assign(row,{currentName:d.canonicalName,currentEntityId:eid,currentRevision:3,changeBatch:53,reviewBatch:53,status:'reviewed_scope_partial',
    governedSourceIds:[g.entity.primary_place_id],scopeMentionIds:g.mentionIds,
    currentMentionIds:scope.assignments.filter(a=>a.entityId).map(a=>a.mentionId),pendingScopeMentionIds:scope.assignments.filter(a=>!a.entityId).map(a=>a.mentionId),
    dimensions:{...row.dimensions,identity:'original_branch_name_restored_with_full_scope',category:'food_verified',location:'existing_location_preserved_not_newly_verified',media:'deferred_by_user',consumedFacts:'confirmed_branch_content_preserved_unqualified_mentions_pending'},
    followup:'第53批恢复原提及分店名并建立完整scope，明确分店内容保留，缺分店证据的正负评价均待审；旧裸名/ID及原地址坐标保持。精确位置与图片仍待核。',
    mediaBoundary:'上游图、独立图源/绑定及原图片字段均无；实际前后返回null，只核元数据和返回对象，不构成图像验收。',
    reviewEvidence:[...(row.reviewEvidence??[]),dir+'food-branches-source-review-01.json',dir+'food-branches-downstream-check-01.json',folder+'food-branches-consumption-1791492100509.json']});
}
for(const item of followup.rows) {
  const row=ledger.rows.find(r=>r.entityId===item.entityId);assert.ok(row);assert.equal(row.status,'pending');touched.add(row.entityId);
  row.followup=item.conclusion+'本批仅只读线索，未应用业务变更。';row.textReviewBatch=53;
  row.reviewEvidence=[...(row.reviewEvidence??[]),dir+'beverage-followup-source-review-01.json'];
  row.dimensions={...row.dimensions,media:'deferred_by_user'};
}
for(let i=0;i<ledger.rows.length;i++)if(!touched.has(ledger.rows[i].entityId))assert.deepEqual(ledger.rows[i],oldRows[i]);
assert.deepEqual(ledger.rows.map(r=>[r.entityId,r.name]),oldRows.map(r=>[r.entityId,r.name]));
assert.equal(ledger.rows.filter(r=>['reviewed_scope_partial','mixed_source_withdrawn_assignment_pending'].includes(r.status)).length,25);
assert.equal(ledger.rows.filter(r=>['pending','reviewed_identity_media_location_pending'].includes(r.status)).length,51);
assert.equal(ledger.rows.filter(r=>r.status==='reviewed_identity_media_location_pending').length,9);
assert.equal(ledger.summary.governedScopeMentions,409);assert.equal(ledger.summary.wrongPointClearedPositionPending,16);
ledger.createdAt=at;ledger.previousLedger=dir+'review-32.json';
Object.assign(ledger.summary,{partiallyReviewedScopeRows:25,governedScopeMentions:415,pendingScopeMentions:112,otherPendingPrimaryRows:51,confirmedFoodBranchMentions:3,
  fullyReviewedMeaning:'18原入选行对应16现行主体；第53批两店完成分店名与scope，位置及媒体仍待核，新增完整自查0，用户未验收。',
  scopeProgressMeaning:'98行保留：4非地点、18行AI自查、76未完成（25部分scope、51其余）；162正式范围审核/4必去缺口。两商业文字发现未应用，饮品两店只读线索另存，日期问题已修复。'});
assert.equal(ledger.summary.fullyReviewed,18);assert.equal(ledger.summary.remainingPrimaryToReview,76);
const progress='第53批鑫龙火锅（北园大街店）/七九刘家烧烤(纬九路店)按原提及恢复分店名，2源6提及/6全文完整scope已双同步，实体1→2→3；确认3/待审3，缺分店正负评价同等待审，原文保留。原ID/裸名别名/美食food/地址坐标保持，位置未新验证，无新实体/合并/撤回。228地点/18关系/direct3、来源revision27、关系内容0变化；107原源/662提及/82全文、旧272分配保持，现278分配/112待审。4SQL/2真实向量/18边界、实际placeFacts、隔离幂等/倒序回滚、真实双导入通过，正常前置检查成功。238旧行/93既有图片字段/9绑定/201行程保持，图库3/1不变；两店前后无图，mock回调2→0、真实入队0，未看图。来源日期稳定、向量无待回填。喜茶/山耶云耶分店与装置粒度线索只读保存，未应用。61实装文件哈希保持，无生产安装；flow55为312正例/113边界/47撤回0失败，audit52为292PENDING，全仓/扩展typecheck通过。review33仍98行：4非地点、18行AI自查、76未完成（25部分scope、51其余）；162范围审核/4必去缺口，清坏点待定位16及身份已查位置媒体待核9不变。两商业文字发现未应用，日期问题已修复。实体53/元数据01/图片03，无未同步或向量待核；图片暂缓、天地图凭据待轮换、云南不主动清洗，未验收不提交归档。';
Object.assign(pointer,{latestAppliedEntityBatch:53,latestFlow:'../all-cities/flow/run-55',latestAudit:'../all-cities/audit/run-52',progressNote:progress,progressUpdatedAt:at,
  latestReviewEvidence:{file:'../'+dir+'food-branches-downstream-check-01.json',supplement:'../'+dir+'beverage-followup-source-review-01.json',fullReviewsAdded:0,partiallyReviewed:2,fullReviewsReopened:0}});
pointer.cityReviewLedgers['济南']='../'+dir+'review-33.json';
Object.assign(pointer.currentScopeReviews,{addedPendingMentions:112,currentReviewRows:162,meaning:'50固定重点实体对加112当前提及待审；第53批新增鑫龙缺分店限定待审3，正负评价同等处理，无主体删除。两商业发现保持，饮品线索只读保存，日期已修复。'});
pointer.currentScopeReviews.evidence.push('../'+dir+'food-branches-source-review-01.json');
pointer.latestReadOnlyFindings.beverageFollowup='../'+dir+'beverage-followup-source-review-01.json';
for(const r of actual.results)pointer.resolvedFindings.push({entityId:r.entityId,name:r.name,status:'resolved_original_branch_name_and_scope_batch53',resolvedByEntityBatch:53,confirmed:r.confirmed,pending:r.pending,evidence:'../'+dir+'food-branches-downstream-check-01.json',fullReviewPassed:false,preciseLocationResolved:false});
for(const k of ['unappliedFindings','unappliedMetadataFindings','resolvedMetadataFindings','latestMetadataRefresh','summary','scopeSha256','mapCredentialGate'])assert.deepEqual(pointer[k],before[k]);
task.notes=progress+'见research/'+report+'。';
const prd=fs.readFileSync(url('../prd.md'),'utf8'),continuation=fs.readFileSync(url('nine-cities-continuation-20261007.md'),'utf8');
const range=/^- 用户最新明确：\*\*云南不处理，继续其他城市直到验收通过\*\*。[^\n]*$/m;
assert.ok(range.test(prd));assert.ok(prd.includes('## 已知事实\n')&&continuation.includes('## 本轮断点\n'));
const nextPrd=prd.replace(range,'- 用户最新明确：**云南不处理，继续其他城市直到验收通过**。九城固定978主体＋56依赖/1135源，162范围内待审及4必去缺口。第53批两家餐饮原分店名与scope已双同步；济南18行AI自查、76未完成，饮品两店线索只读保存，两商业文字问题未应用，日期问题已修复。图片比对暂缓；天地图凭据待轮换但其余文字清洗继续。云南、89普通长尾和37已隔离错城来源归属不扩入主动范围，未获用户验收。')
  .replace('## 已知事实\n','## 已知事实\n\n### 最新进展：第53批恢复餐饮原始分店名\n\n'+progress+'见[第53批记录](research/'+report+')。以下为历史快照。\n');
const nextContinuation=continuation.replace('## 本轮断点\n','## 本轮断点\n\n当前以review33为准。'+progress+'下一实体批次54使用flow56/audit53，禁止重放已应用批次。饮品门店与装置粒度须单独核实。见['+report+']('+report+')。以下为历史断点。\n');
const fresh=new Map([
  [dir+'review-33.json',json(ledger)],
  [dir+'review-33.md','# 济南98项重点清单核查台账（第53批）\n\n'+progress+'\n\n| 原名称 | 当前名称 | 版本 | 进度 | 说明 |\n| --- | --- | ---: | --- | --- |\n'+ledger.rows.map(r=>`| ${r.name} | ${r.currentName??r.name} | ${r.currentRevision} | ${r.status} | ${r.followup} |`).join('\n')+'\n'],
  ['cleaning-scope/current-before-batch53.json',json(before)],
  [dir+'food-branches-final-verification-01.json',json({batch:53,at,stats,productionCodeInstalled:false,installedManifestHashesVerified:61,isolatedSqlAndExport:true,reverseRollback:true,actualConsumptionTestPassed:true,rootTypecheck:true,extendedTypecheck:true,preflightSucceeded:true,frozenMembershipPreserved:{primary:978,dependencies:56,sourceRows:1135},fullReviewsAdded:0,remainingPrimaryToReview:76,partiallyReviewedScopeRows:25,otherPendingPrimaryRows:51,unappliedSemanticFindings:2,unappliedMetadataFindings:0,readOnlyBeverageCandidates:2,imageComparison:'deferred_by_user',mapCredentialStatus:'rotation_required',userAcceptance:false})],
]);
for(const p of fresh.keys())assert.ok(!fs.existsSync(url(p)),p+'已存在，不可重放');assert.ok(fs.existsSync(url(report)));
const replace=new Map([['../task.json',json(task)],['../prd.md',nextPrd],['nine-cities-continuation-20261007.md',nextContinuation]]);
for(const kind of ['implement','check']) {
  const p=`../${kind}.jsonl`,entry={file:'.trellis/tasks/10-06-place-identity-governance/research/'+report,reason:'第53批原始餐饮分店名/scope已双同步，review33/flow55/audit52；112待审、仍76未完成，饮品两店只读线索，元数据01保持、地图凭据待轮换、图片暂缓，不重放'};
  const original=fs.readFileSync(url(p),'utf8');assert.ok(!original.includes(entry.file));replace.set(p,original+JSON.stringify(entry)+'\n');
}
for(const [p,value]of fresh)fs.writeFileSync(url(p),value,{flag:'wx'});
for(const [p,value]of replace)fs.writeFileSync(url(p),value);
fs.writeFileSync(url('cleaning-scope/current.json'),json(pointer));
console.log(JSON.stringify({batch:53,ledger:'review-33',fullyReviewed:18,remaining:76,partialScope:25,otherPending:51,pendingMentions:112,currentReviewRows:162,stats}));

