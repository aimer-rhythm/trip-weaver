// 第55批v2验证后的单次登记；不操作业务库、不提交、不归档。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const url=p=>new URL(p,import.meta.url),read=p=>JSON.parse(fs.readFileSync(url(p),'utf8'));
const sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex'),json=v=>JSON.stringify(v,null,2)+'\n';
const dir='priority-cities/济南/',batch='all-cities/batch-55-v2/',folder=batch+'sync-01/',report='batch55-jinan-laoshe-20261009.md',at=new Date().toISOString();
const unique=(p,pattern)=>{const names=fs.readdirSync(url(p)).filter(n=>pattern.test(n));assert.equal(names.length,1);return p+names[0];};
const pointer=read('cleaning-scope/current.json'),before=structuredClone(pointer),task=read('../task.json');
const museumId='6a111b28c08cc7853140187bfd852b16',wallId='c5a3fae3d839ec359cb0521d957e56df',ids=[museumId,wallId];
assert.equal(pointer.latestAppliedEntityBatch,54);assert.equal(pointer.cityReviewLedgers['济南'],'../'+dir+'review-34.json');
assert.equal(pointer.userAcceptance,false);assert.equal(pointer.taskStatus,'in_progress');assert.equal(task.status,'in_progress');
assert.equal(pointer.latestIndependentPhotoBatch,3);assert.equal(pointer.latestMetadataRefresh.run,1);assert.equal(pointer.imageComparisonPolicy.status,'deferred_by_user');
assert.equal(pointer.mapCredentialGate.status,'rotation_required');assert.deepEqual(pointer.pendingVerification,[]);
assert.equal(pointer.unappliedFindings.length,2);assert.deepEqual(pointer.unappliedMetadataFindings,[]);
assert.equal(sha(url('cleaning-scope/'+pointer.scopeFile)),pointer.scopeSha256);
const frozen=read('cleaning-scope/'+pointer.scopeFile);assert.deepEqual(frozen.summary,pointer.summary);
assert.equal(frozen.selected.length,978);assert.equal(frozen.dependencies.length,56);assert.equal(frozen.sourceIds.length,1135);assert.ok(frozen.selected.every(r=>r.place.city!=='云南'));
const source=read('all-cities/batch-55-v2-source.json'),scopes=read('all-cities/batch-55-v2-scope-decisions.json'),decisions=read('all-cities/batch-55-v2-decisions.json');
assert.equal(sha(url('all-cities/batch-55-v2-source.json')),'00cbcfdf8598983e1c49be46f173d3f3b429795796c01deb19f6ce7bc041c883');
assert.equal(sha(url(dir+'laoshe-source-packet-01.json')),'0e6805dfe255cbb6338ad89ae60dedc9d28f6de9cfe8261bf3f48762393a9df5');
assert.equal(source.sources.length,2);assert.equal(source.mentions.length,4);assert.equal(source.notes.length,3);assert.equal(scopes.length,1);assert.equal(decisions.length,2);
assert.equal(read('all-cities/batch-55-v2-applied.json').apply,true);
for(const kind of ['preview','applied'])assert.equal(read(`all-cities/batch-55-v2-${kind}.json`).changes.length,3);
assert.ok(!fs.existsSync(url('all-cities/batch-55-applied.json')),'被否决初案不能已应用');
const sync=read(folder+'sync-state.json').cities['济南'];assert.ok(sync.importedAt&&sync.relationsImportedAt&&sync.embeddingRunAt);assert.equal(sync.relationSnapshotRevision,29);
assert.equal(sync.exportHash,sha(url(folder+'xhs-places-济南.json')));assert.equal(sync.relationHash,sha(url(folder+'xhs-place-relations-济南.json')));
const consumptionFile=unique(folder,/^laoshe-consumption-\d+\.json$/),postFile=unique(folder,/^post-import-check-\d+\.json$/),dualFile=unique(folder+'preview-济南/',/^preview-\d+\.json$/);
const actual=read(dir+'laoshe-downstream-check-01.json'),consumption=read(consumptionFile);
for(const [k,v]of Object.entries({consumedFieldsVerified:228,assignmentRows:281,pendingMentions:112,scopesAdded:1,confirmed:1,ordinaryMentionsPreserved:3,pendingAdded:0,coordinatesCleared:1,newPreciseLocations:0,categoriesCorrected:1,addressesCorrected:2,sqlProbes:5,boundaryProbes:35,realVectorProbes:2}))assert.equal(actual[k],v);
assert.deepEqual(actual.fallbackObservedAtChanges,[]);
for(const r of [actual,consumption])assert.ok(r.contentAndEvidencePreserved&&r.museumScopeDeferred&&r.museumDescriptionFindingUnapplied&&r.confirmedIdentityPreserved);
assert.ok(consumption.actualPlaceFacts&&consumption.priorGovernedFactsPreserved&&consumption.independentSourceDigestUnchanged);
assert.deepEqual(consumption.media.map(r=>r.count),[3,1,2]);assert.deepEqual(consumption.mockEnqueueCalls,{before:1,after:0});assert.equal(consumption.actualEnqueues,0);
assert.equal(consumption.rawAliasProbeMockEnqueues,2);assert.ok(consumption.canonicalized.every(r=>r.canonicalName==='老舍故居'&&r.photos===2));assert.ok(consumption.rawAliases.every(r=>r.photos===0));
const pre=read(folder+'pre-import-check.json'),post=read(postFile);
assert.equal(pre.mode,'before');assert.equal(pre.cities[0].unchangedSincePreview,true);assert.ok(Date.parse(pre.at)<Date.parse(sync.importedAt));
assert.equal(post.cities[0].oldRowsPreserved,238);assert.equal(post.cities[0].photoFieldsPreserved,105);assert.equal(post.cities[0].independentPhotos,9);
assert.deepEqual(post.trips,pre.trips);assert.deepEqual(post.trips,{count:201,digest:'e01d67cbf42a62fc595f4ef052f99e75'});
const isolated=read(batch+'scope-preview-1791493722006262300/report.json'),dual=read(dualFile);
assert.ok(isolated.idempotent&&isolated.reverseRollback&&isolated.originalSourcesAndMentionsUnchanged);assert.equal(isolated.pendingAdded,0);assert.equal(isolated.ordinaryMentionsPreserved,3);
assert.ok(dual.reverseRollback&&dual.oldRowsPreserved&&dual.photosPreserved);
const delta=read(folder+'preview-济南/relation-delta.json');assert.deepEqual(delta.changed,[]);assert.deepEqual(delta.removed,[]);
const upstream=read('all-cities/batch-55-v2-upstream-check.json');
for(const [k,v]of Object.entries({rawSourcesUnchanged:107,originalMentionsUnchanged:662,originalNotesCovered:82,appliedEntitiesVerified:2,appliedScopesVerified:1,assignmentsVerified:1}))assert.equal(upstream[k],v);
assert.equal(upstream.finalEntityRevisions[museumId],2);assert.equal(upstream.finalEntityRevisions[wallId],3);
const flow=read('all-cities/flow/run-57/report.json'),audit=read('all-cities/audit/run-54/report.json');
for(const r of [actual,consumption,pre,post,isolated,dual,upstream,flow,audit,read(folder+'verification-vectors.json')])assert.deepEqual(r.failures,[]);
assert.equal(read('all-cities/flow/run-57/cleanup.json').removed,true);
assert.match(fs.readFileSync(url('downstream-place_identity_test_1791494055999.log'),'utf8'),/pass 1/);
assert.match(fs.readFileSync(url('upstream-stage-place_identity_test_1791493720737.log'),'utf8'),/"reverseRollback": true/);
const stats={positive:flow.cities.reduce((n,c)=>n+c.probes.length,0),boundaries:flow.cities.reduce((n,c)=>n+c.negativeProbes.length,0),withdrawals:flow.cities.reduce((n,c)=>n+c.withdrawalProbes.length,0),pending:audit.cities.reduce((n,c)=>n+(c.statuses.PENDING??0),0)};
assert.deepEqual(stats,{positive:316,boundaries:113,withdrawals:47,pending:292});
const install=read('upstream-install.json');assert.equal(install.files.length,61);
for(const f of install.files)for(const p of [url('upstream/'+f.path),'D:/Project/xhs-travel-pipeline/'+f.path])assert.equal(sha(p),f.after);

const ledger=read(dir+'review-34.json'),oldRows=structuredClone(ledger.rows);
assert.deepEqual(ledger.rows.map(r=>[r.entityId,r.name]).sort(),frozen.selected.filter(r=>r.place.city==='济南').map(r=>[r.place.id,r.place.name]).sort());
for(const g of source.groups) {
  const eid=g.entity.entity_id,row=ledger.rows.find(r=>r.entityId===eid),d=decisions.find(d=>d.entityId===eid),museum=eid===museumId;
  assert.equal(row.currentRevision,1);assert.equal(row.status,'pending');
  Object.assign(row,{currentName:d.canonicalName,currentEntityId:eid,currentRevision:museum?2:3,changeBatch:55,changeVariant:'v2',reviewBatch:55,
    status:museum?'reviewed_identity_media_location_pending':'reviewed_scope_partial',
    dimensions:{...row.dimensions,identity:museum?'museum_aliases_confirmed_canonical_name_preserved':'theme_wall_independent_full_scope',category:museum?'attraction_verified':'photo_spot_corrected',
      location:museum?'documented_address_added_existing_point_not_newly_verified':'wrong_point_cleared_precise_wall_location_pending',media:'deferred_by_user',consumedFacts:museum?'description_start_point_finding_unapplied':'original_content_and_evidence_preserved'},
    followup:museum?'第55批v2保留故居主名、增加纪念馆别名及南新街58号；旧2图保持，不加scope。距离起点描述、精确位置和媒体待核。':'第55批v2确认西更道街5号独立主题墙，保留12694及描述，补主名后缀、photo_spot细类并清旧点。精确坐标和媒体待核。',
    mediaBoundary:museum?'11独立来源中2 eligible、0绑定；规范名实际2图保持，直接新增别名仍0；不加scope或自动绑定，不构成视觉核查。':'无独立来源/绑定，上游图0；实际新旧名称均无图，仅核元数据和返回对象，不构成视觉核查。',
    reviewEvidence:[...(row.reviewEvidence??[]),dir+'laoshe-source-review-02.json',dir+'laoshe-downstream-check-01.json',consumptionFile]});
  if(museum)Object.assign(row,{ordinaryMentionIds:g.mentionIds,museumScopeDeferred:true,unappliedDescriptionMentionIds:[11619,12912]});
  else Object.assign(row,{governedSourceIds:[5957],scopeMentionIds:[12694],currentMentionIds:[12694],pendingScopeMentionIds:[]});
}
for(let i=0;i<ledger.rows.length;i++)if(!ids.includes(ledger.rows[i].entityId))assert.deepEqual(ledger.rows[i],oldRows[i]);
assert.deepEqual(ledger.rows.map(r=>[r.entityId,r.name]),oldRows.map(r=>[r.entityId,r.name]));
assert.equal(ledger.rows.filter(r=>['reviewed_scope_partial','mixed_source_withdrawn_assignment_pending'].includes(r.status)).length,28);
assert.equal(ledger.rows.filter(r=>['pending','reviewed_identity_media_location_pending'].includes(r.status)).length,48);
assert.equal(ledger.rows.filter(r=>r.status==='reviewed_identity_media_location_pending').length,10);
assert.equal(ledger.summary.governedScopeMentions,417);assert.equal(ledger.summary.wrongPointClearedPositionPending,18);
ledger.createdAt=at;ledger.previousLedger=dir+'review-34.json';
Object.assign(ledger.summary,{partiallyReviewedScopeRows:28,governedScopeMentions:418,wrongPointClearedPositionPending:19,pendingScopeMentions:112,otherPendingPrimaryRows:48,
  reviewedIdentityMediaLocationPending:10,unappliedSemanticFindings:3,confirmedLaosheWallMentions:1,
  fullyReviewedMeaning:'18原入选行对应16现行主体；第55批v2故居别名/地址、主题墙scope/类型/坏点已处理，位置媒体及故居距离描述仍待核，新增完整自查0，用户未验收。',
  scopeProgressMeaning:'98行保留：4非地点、18行AI自查、76未完成（28部分scope、48其余）；162正式范围审核/4必去缺口。老商埠、经三路、故居3项文字发现未应用，日期问题已修复。'});
assert.equal(ledger.summary.fullyReviewed,18);assert.equal(ledger.summary.remainingPrimaryToReview,76);
const progress='第55批v2老舍故居保留主名、增加纪念馆别名及南新街58号，revision1→2，3普通提及不加scope，原2图保持；主题墙补主名后缀、西更道街5号及photo_spot类型，清除不匹配旧点，1scope确认12694，revision1→2→3。2源4提及/3直接全文+1补充全文，无新主体/合并/撤回/新增待审。初案改纪念馆主名实际失图已否决且未应用；规范名解析后3入口均2图，裸新别名直接查询仍0。故居距离起点描述仍未修，文字发现2→3。228地点/18关系/direct3、revision29，关系内容0变化；107原源/662提及/82全文及旧280分配保持，总281/待审112。5SQL/2真实向量/35边界、实际placeFacts/图库、隔离幂等倒序回滚及全城双导入通过，前置检查成功。238旧行/105既有图片字段/9绑定/201行程保持，旧图库3/1/2保持，墙null，主流程mock1→0，新别名直接探针另2次mock，真实入队0。描述/语料/来源日期保持，仅compiledAt刷新；故居位置尚未新验证，墙精确点待核，不看图。61实装文件哈希保持，无生产安装，全仓/扩展typecheck通过。flow57为316正例/113边界/47撤回0失败，audit54为292PENDING。review35仍98行：4非地点、18行AI自查、76未完成（28部分scope、48其余），清坏点待定位19，身份已查位置媒体待核10，scope提及418，162范围审核/4必去缺口。实体55-v2/元数据01/图片03，无未同步或向量待核；图片暂缓、天地图凭据待轮换、云南及四家范围外路线店铺不主动清洗，未验收不提交归档。';
Object.assign(pointer,{latestAppliedEntityBatch:55,latestAppliedEntityBatchVariant:'v2',latestFlow:'../all-cities/flow/run-57',latestAudit:'../all-cities/audit/run-54',progressNote:progress,progressUpdatedAt:at,
  latestReviewEvidence:{file:'../'+dir+'laoshe-downstream-check-01.json',supplement:'../'+dir+'laoshe-source-review-02.json',fullReviewsAdded:0,partiallyReviewed:2,fullReviewsReopened:0}});
pointer.cityReviewLedgers['济南']='../'+dir+'review-35.json';
Object.assign(pointer.currentScopeReviews,{addedPendingMentions:112,currentReviewRows:162,meaning:'50固定重点实体对加112提及待审；第55批v2墙1条确认分配，故居3普通提及保持，无待审新增。3项文字发现未应用，日期问题已修复。'});
pointer.currentScopeReviews.evidence.push('../'+dir+'laoshe-source-review-02.json');
pointer.latestReadOnlyFindings.laosheFollowup=dir+'laoshe-source-review-02.json';
pointer.latestReadOnlyFindings.laosheFollowupStatus='museum_alias_address_wall_identity_wrong_point_resolved_batch55_v2_description_media_location_pending';
pointer.unappliedFindings.push({entityId:museumId,name:'老舍故居',sourceIds:[5498],mentionIds:[11619,12912],noteId:2624,
  status:'unapplied_description_scope_preserve_existing_photo_consumption',reason:'抽取把含歧义南门固化为五龙潭南门500米；现有2图使直接新增scope失图，保留原描述待后续治理，不伪造新起点或距离。',
  discoveredDuringEntityBatch:55,evidence:'../'+dir+'laoshe-source-review-02.json',fullReviewPassed:false});
pointer.resolvedFindings.push({entityId:wallId,name:'老舍笔下的济南主题墙',status:'resolved_theme_wall_identity_type_and_wrong_point_batch55_v2',resolvedByEntityBatch:55,variant:'v2',confirmed:1,pending:0,
  evidence:'../'+dir+'laoshe-downstream-check-01.json',fullReviewPassed:false,coordinatesCleared:true,preciseLocationResolved:false});
for(const k of ['unappliedMetadataFindings','resolvedMetadataFindings','latestMetadataRefresh','summary','scopeSha256','mapCredentialGate'])assert.deepEqual(pointer[k],before[k]);
assert.deepEqual(pointer.unappliedFindings.slice(0,2),before.unappliedFindings);
task.notes=progress+'见research/'+report+'。';
const prd=fs.readFileSync(url('../prd.md'),'utf8'),continuation=fs.readFileSync(url('nine-cities-continuation-20261007.md'),'utf8');
const range=/^- 用户最新明确：\*\*云南不处理，继续其他城市直到验收通过\*\*。[^\n]*$/m;
assert.ok(range.test(prd));assert.ok(prd.includes('## 已知事实\n')&&continuation.includes('## 本轮断点\n'));
const nextPrd=prd.replace(range,'- 用户最新明确：**云南不处理，继续其他城市直到验收通过**。九城固定978主体＋56依赖/1135源，162范围内待审及4必去缺口。第55批v2故居别名与地址、主题墙scope/细类/坏点清除已双同步；济南18行AI自查、76未完成，3项文字发现未应用，日期问题已修复。图片比对暂缓；天地图凭据待轮换但其余文字清洗继续。云南、89普通长尾和37已隔离错城来源归属不扩入主动范围，未获用户验收。')
  .replace('## 已知事实\n','## 已知事实\n\n### 最新进展：第55批v2故居与主题墙独立\n\n'+progress+'见[第55批记录](research/'+report+')。以下为历史快照。\n');
const nextContinuation=continuation.replace('## 本轮断点\n','## 本轮断点\n\n当前以review35为准。'+progress+'下一实体批次56使用flow58/audit55/review36，禁止重放；55正式应用仅v2，初案被否决。见['+report+']('+report+')。以下为历史断点。\n');
const fresh=new Map([
  [dir+'review-35.json',json(ledger)],
  [dir+'review-35.md','# 济南98项重点清单核查台账（第55批v2）\n\n'+progress+'\n\n| 原名称 | 当前名称 | 版本 | 进度 | 说明 |\n| --- | --- | ---: | --- | --- |\n'+ledger.rows.map(r=>`| ${r.name} | ${r.currentName??r.name} | ${r.currentRevision} | ${r.status} | ${r.followup} |`).join('\n')+'\n'],
  ['cleaning-scope/current-before-batch55.json',json(before)],
  [dir+'laoshe-final-verification-01.json',json({batch:55,variant:'v2',at,stats,productionCodeInstalled:false,installedManifestHashesVerified:61,isolatedSqlAndExport:true,reverseRollback:true,actualConsumptionTestPassed:true,
    rootTypecheck:true,extendedTypecheck:true,preflightSucceeded:true,frozenMembershipPreserved:{primary:978,dependencies:56,sourceRows:1135},fullReviewsAdded:0,remainingPrimaryToReview:76,partiallyReviewedScopeRows:28,
    otherPendingPrimaryRows:48,unappliedSemanticFindings:3,unappliedMetadataFindings:0,museumScopeDeferred:true,museumDescriptionFindingUnapplied:true,consumptionFile,postFile,dualFile,imageComparison:'deferred_by_user',mapCredentialStatus:'rotation_required',userAcceptance:false})],
]);
for(const p of fresh.keys())assert.ok(!fs.existsSync(url(p)),p+'已存在，不可重放');assert.ok(fs.existsSync(url(report)));
const replace=new Map([['../task.json',json(task)],['../prd.md',nextPrd],['nine-cities-continuation-20261007.md',nextContinuation]]);
for(const kind of ['implement','check']) {
  const p=`../${kind}.jsonl`,entry={file:'.trellis/tasks/10-06-place-identity-governance/research/'+report,reason:'第55批仅v2已正式应用：故居保持主名和2图/别名地址，主题墙scope/type/坏点；review35/flow57/audit54。281分配/112待审，76未完成，3文字发现未应用，图片暂缓，不重放初案或已应用批次'};
  const original=fs.readFileSync(url(p),'utf8');assert.ok(!original.includes(entry.file));replace.set(p,original+JSON.stringify(entry)+'\n');
}
for(const [p,value]of fresh)fs.writeFileSync(url(p),value,{flag:'wx'});
for(const [p,value]of replace)fs.writeFileSync(url(p),value);
fs.writeFileSync(url('cleaning-scope/current.json'),json(pointer));
console.log(JSON.stringify({batch:55,variant:'v2',ledger:'review-35',fullyReviewed:18,remaining:76,partialScope:28,otherPending:48,pendingMentions:112,currentReviewRows:162,unappliedFindings:3,stats}));
