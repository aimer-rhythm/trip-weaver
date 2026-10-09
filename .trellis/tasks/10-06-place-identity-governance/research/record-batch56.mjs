// 第56批v2验证后的单次登记；不操作业务库、不提交、不归档。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const url=p=>new URL(p,import.meta.url),read=p=>JSON.parse(fs.readFileSync(url(p),'utf8'));
const sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex'),json=v=>JSON.stringify(v,null,2)+'\n';
const dir='priority-cities/济南/',batch='all-cities/batch-56-v2/',folder=batch+'sync-01/',report='batch56-jinan-park-culture-20261009.md',at=new Date().toISOString();
const unique=(p,pattern)=>{const names=fs.readdirSync(url(p)).filter(n=>pattern.test(n));assert.equal(names.length,1);return p+names[0];};
const pointer=read('cleaning-scope/current.json'),before=structuredClone(pointer),task=read('../task.json');
const parkId='69ab8bb674e8f0eea31c34c936bddf23',caveId='7ac1b9fdfb96a01db695da65d8e81830',templeId='c93e3216e2e3cc1b75d07097f2c78367',ids=[parkId,caveId,templeId];
assert.equal(pointer.latestAppliedEntityBatch,55);assert.equal(pointer.cityReviewLedgers['济南'],'../'+dir+'review-35.json');
assert.equal(pointer.userAcceptance,false);assert.equal(pointer.taskStatus,'in_progress');assert.equal(task.status,'in_progress');
assert.equal(pointer.latestIndependentPhotoBatch,3);assert.equal(pointer.latestMetadataRefresh.run,1);assert.equal(pointer.imageComparisonPolicy.status,'deferred_by_user');
assert.equal(pointer.mapCredentialGate.status,'rotation_required');assert.deepEqual(pointer.pendingVerification,[]);
assert.equal(pointer.unappliedFindings.length,3);assert.deepEqual(pointer.unappliedMetadataFindings,[]);
assert.equal(sha(url('cleaning-scope/'+pointer.scopeFile)),pointer.scopeSha256);
const frozen=read('cleaning-scope/'+pointer.scopeFile);assert.deepEqual(frozen.summary,pointer.summary);
assert.equal(frozen.selected.length,978);assert.equal(frozen.dependencies.length,56);assert.equal(frozen.sourceIds.length,1135);assert.ok(frozen.selected.every(r=>r.place.city!=='云南'));
const source=read('all-cities/batch-56-v2-source.json'),scopes=read('all-cities/batch-56-v2-scope-decisions.json'),decisions=read('all-cities/batch-56-v2-decisions.json');
assert.equal(sha(url('all-cities/batch-56-v2-source.json')),'c639ea73b67c9438e8477212c6339823b3b0b84f0c59cf48b0ca27603c1d40fb');
assert.equal(sha(url(dir+'park-culture-source-packet-01.json')),'fc1d52df872c1a50e09dcb9d0014a260fad59c636531a9b666304959d6e75880');
assert.equal(source.sources.length,3);assert.equal(source.mentions.length,4);assert.equal(source.notes.length,4);assert.equal(scopes.length,3);assert.equal(decisions.length,3);
assert.equal(read('all-cities/batch-56-v2-applied.json').apply,true);
for(const kind of ['preview','applied'])assert.equal(read(`all-cities/batch-56-v2-${kind}.json`).changes.length,6);
assert.ok(!fs.existsSync(url('all-cities/batch-56-applied.json')),'被否决初案不能已应用');
const sync=read(folder+'sync-state.json').cities['济南'];assert.ok(sync.importedAt&&sync.relationsImportedAt&&sync.embeddingRunAt);assert.equal(sync.relationSnapshotRevision,30);
assert.equal(sync.exportHash,sha(url(folder+'xhs-places-济南.json')));assert.equal(sync.relationHash,sha(url(folder+'xhs-place-relations-济南.json')));
const consumptionFile=unique(folder,/^park-culture-consumption-\d+\.json$/),postFile=unique(folder,/^post-import-check-\d+\.json$/),dualFile=unique(folder+'preview-济南/',/^preview-\d+\.json$/);
const actual=read(dir+'park-culture-downstream-check-01.json'),consumption=read(consumptionFile);
for(const [k,v]of Object.entries({consumedFieldsVerified:228,assignmentRows:285,pendingMentions:112,scopesAdded:3,confirmed:4,pendingAdded:0,coordinatesCleared:1,newPreciseLocations:0,categoriesCorrected:0,addressesCorrected:1,sqlProbes:4,boundaryProbes:35,realVectorProbes:3}))assert.equal(actual[k],v);
assert.deepEqual(actual.fallbackObservedAtChanges,[]);
for(const r of [actual,consumption])assert.ok(r.contentAndEvidencePreserved&&r.groupDurationExcluded&&r.historicLocationPreserved&&r.negativeMentionPreserved&&r.confirmedIdentityPreserved);
assert.ok(consumption.actualPlaceFacts&&consumption.priorGovernedFactsPreserved&&consumption.independentSourceDigestUnchanged);
assert.deepEqual(consumption.media.map(r=>r.count),[3,1,2]);assert.deepEqual(consumption.mockEnqueueCalls,{before:3,after:0});assert.equal(consumption.actualEnqueues,0);
assert.ok(consumption.canonicalized.every(r=>r.canonicalName==='老舍故居'&&r.photos===2));
const pre=read(folder+'pre-import-check.json'),post=read(postFile);
assert.equal(pre.mode,'before');assert.equal(pre.cities[0].unchangedSincePreview,true);assert.ok(Date.parse(pre.at)<Date.parse(sync.importedAt));
assert.equal(post.cities[0].oldRowsPreserved,238);assert.equal(post.cities[0].photoFieldsPreserved,108);assert.equal(post.cities[0].independentPhotos,9);
assert.deepEqual(post.trips,pre.trips);assert.deepEqual(post.trips,{count:201,digest:'e01d67cbf42a62fc595f4ef052f99e75'});
const isolated=read(batch+'scope-preview-1791494583164273000/report.json'),dual=read(dualFile);
assert.ok(isolated.idempotent&&isolated.reverseRollback&&isolated.originalSourcesAndMentionsUnchanged);assert.equal(isolated.pendingAdded,0);assert.equal(isolated.factExclusions,1);
assert.ok(dual.reverseRollback&&dual.oldRowsPreserved&&dual.photosPreserved);
const delta=read(folder+'preview-济南/relation-delta.json');assert.deepEqual(delta.changed,[]);assert.deepEqual(delta.removed,[]);
const upstream=read('all-cities/batch-56-v2-upstream-check.json');
for(const [k,v]of Object.entries({rawSourcesUnchanged:107,originalMentionsUnchanged:662,originalNotesCovered:82,appliedEntitiesVerified:3,appliedScopesVerified:3,assignmentsVerified:4}))assert.equal(upstream[k],v);
assert.equal(upstream.finalEntityRevisions[parkId],3);assert.equal(upstream.finalEntityRevisions[caveId],3);assert.equal(upstream.finalEntityRevisions[templeId],4);
const flow=read('all-cities/flow/run-58/report.json'),audit=read('all-cities/audit/run-55/report.json');
for(const r of [actual,consumption,pre,post,isolated,dual,upstream,flow,audit,read(folder+'verification-vectors.json')])assert.deepEqual(r.failures,[]);
assert.equal(read('all-cities/flow/run-58/cleanup.json').removed,true);
assert.match(fs.readFileSync(url('downstream-place_identity_test_1791494753133.log'),'utf8'),/pass 1/);
assert.match(fs.readFileSync(url('upstream-stage-place_identity_test_1791494581579.log'),'utf8'),/"reverseRollback": true/);
const stats={positive:flow.cities.reduce((n,c)=>n+c.probes.length,0),boundaries:flow.cities.reduce((n,c)=>n+c.negativeProbes.length,0),withdrawals:flow.cities.reduce((n,c)=>n+c.withdrawalProbes.length,0),pending:audit.cities.reduce((n,c)=>n+(c.statuses.PENDING??0),0)};
assert.deepEqual(stats,{positive:318,boundaries:113,withdrawals:47,pending:292});
const install=read('upstream-install.json');assert.equal(install.files.length,61);
for(const f of install.files)for(const p of [url('upstream/'+f.path),'D:/Project/xhs-travel-pipeline/'+f.path])assert.equal(sha(p),f.after);

const ledger=read(dir+'review-35.json'),oldRows=structuredClone(ledger.rows);
assert.deepEqual(ledger.rows.map(r=>[r.entityId,r.name]).sort(),frozen.selected.filter(r=>r.place.city==='济南').map(r=>[r.place.id,r.place.name]).sort());
for(const g of source.groups) {
  const eid=g.entity.entity_id,row=ledger.rows.find(r=>r.entityId===eid),d=decisions.find(d=>d.entityId===eid),park=eid===parkId,cave=eid===caveId;
  assert.equal(row.currentRevision,park||cave?1:2);assert.equal(row.status,'pending');
  assert.equal(g.entity.revision,park||cave?1:2);
  Object.assign(row,{currentName:d.canonicalName,currentEntityId:eid,currentRevision:park||cave?3:4,changeBatch:56,changeVariant:'v2',reviewBatch:56,status:'reviewed_scope_partial',
    governedSourceIds:[g.entity.primary_place_id],scopeMentionIds:g.mentionIds,currentMentionIds:g.mentionIds,pendingScopeMentionIds:[],
    dimensions:{...row.dimensions,identity:park?'park_distinct_from_springs_full_scope':cave?'replica_caves_full_scope':'specific_gongqingtuan_temple_full_scope',category:park?'natural_category_explicitly_preserved':'cultural_attraction_verified',
      location:cave?'wrong_point_cleared_precise_cave_entrance_pending':park?'existing_location_preserved_not_newly_verified':'batch30_corrected_location_preserved',media:'deferred_by_user',consumedFacts:park?'group_duration_excluded_other_content_preserved':'original_content_and_evidence_preserved'},
    followup:park?'第56批v2排除跨珍珠泉路线合计120分钟，独立时长未知；自然类及原观泉描述保持，位置媒体待核。':cave?'第56批v2保留正负提及，清城西坏点，仅写千佛山景区内；未借山体坐标，精确洞口和媒体待核。':'第56批v2补主名共青团路关帝庙及scope；第30批已修正的筐市街18-3和点位保持，不计本批新定位，媒体待核。',
    mediaBoundary:'上游图及独立来源/绑定均0，实际前后无图；仅比元数据及返回对象，不构成图片验收。',
    reviewEvidence:[...(row.reviewEvidence??[]),dir+'park-culture-source-review-03.json',dir+'park-culture-downstream-check-01.json',consumptionFile]});
  if(eid===templeId)row.historicalBaselineVerification={originalFrozenRevision:1,previousLedgerRevision:2,actualBeforeRevision:2,correctedByEntityBatch:30,currentLocationPreserved:true};
}
for(let i=0;i<ledger.rows.length;i++)if(!ids.includes(ledger.rows[i].entityId))assert.deepEqual(ledger.rows[i],oldRows[i]);
assert.deepEqual(ledger.rows.map(r=>[r.entityId,r.name]),oldRows.map(r=>[r.entityId,r.name]));
assert.equal(ledger.rows.filter(r=>['reviewed_scope_partial','mixed_source_withdrawn_assignment_pending'].includes(r.status)).length,31);
assert.equal(ledger.rows.filter(r=>['pending','reviewed_identity_media_location_pending'].includes(r.status)).length,45);
assert.equal(ledger.rows.filter(r=>r.status==='reviewed_identity_media_location_pending').length,10);
assert.equal(ledger.summary.governedScopeMentions,418);assert.equal(ledger.summary.wrongPointClearedPositionPending,19);
ledger.createdAt=at;ledger.previousLedger=dir+'review-35.json';
Object.assign(ledger.summary,{partiallyReviewedScopeRows:31,governedScopeMentions:422,wrongPointClearedPositionPending:20,pendingScopeMentions:112,otherPendingPrimaryRows:45,
  confirmedParkCultureMentions:4,
  fullyReviewedMeaning:'18原入选行对应16现行主体；第56批v2公园合计时长、石窟坏点、庙具体名称/scope已处理，位置媒体仍待核，新增完整自查0，用户未验收。',
  scopeProgressMeaning:'98行保留：4非地点、18行AI自查、76未完成（31部分scope、45其余）；162正式范围审核/4必去缺口。3项文字发现未应用，日期问题已修复，关帝庙既有位置继承第30批。'});
assert.equal(ledger.summary.fullyReviewed,18);assert.equal(ledger.summary.remainingPrimaryToReview,76);
const progress='第56批v2济南环城公园排除跨珍珠泉合计120分钟，显式保持自然类/原观泉描述与点位；四窟万象保留两篇正负评价，清城西坏点，仅写千佛山景区内；关帝庙补主名共青团路关帝庙，保留第30批已修正的筐市街18-3及点位。3源4提及/4全文，3scope+3决定共6变化，版本分别1→2→3、1→2→3、2→3→4；无新主体/合并/撤回/新增待审。初案预演发现公园类别漂移与sentiment断言误用，未应用，正式仅v2。228地点/18关系/direct3、revision30，关系内容0变化；107原源/662提及/82全文及旧281分配保持，总285/待审112。4SQL/3真实向量/35边界、实际placeFacts/图库、隔离幂等倒序回滚和全城双导入通过，正常前置检查成功。238旧行/108既有图片字段/9绑定/201行程保持，旧图库3/1/2不变，3目标均null、mock3→0、真实入队0。描述/语料/来源日期保持，仅compiledAt刷新；原始缓存保留，不看图、不进行地图请求。61实装文件哈希保持，无生产安装，全仓/扩展typecheck通过。flow58为318正例/113边界/47撤回0失败，audit55为292PENDING。review36仍98行：4非地点、18行AI自查、76未完成（31部分scope、45其余），清坏点待定位20，身份已查位置媒体待核10，scope提及422，162范围审核/4必去缺口。3文字发现未应用，实体56-v2/元数据01/图片03，无未同步或向量待核；图片暂缓、天地图凭据待轮换、云南和长尾不扩入，未验收不提交归档。';
Object.assign(pointer,{latestAppliedEntityBatch:56,latestAppliedEntityBatchVariant:'v2',latestFlow:'../all-cities/flow/run-58',latestAudit:'../all-cities/audit/run-55',progressNote:progress,progressUpdatedAt:at,
  latestReviewEvidence:{file:'../'+dir+'park-culture-downstream-check-01.json',supplement:'../'+dir+'park-culture-source-review-03.json',fullReviewsAdded:0,partiallyReviewed:3,fullReviewsReopened:0}});
pointer.cityReviewLedgers['济南']='../'+dir+'review-36.json';
Object.assign(pointer.currentScopeReviews,{addedPendingMentions:112,currentReviewRows:162,meaning:'50固定重点实体对加112提及待审；第56批v2新增4条确认分配，无待审新增。3项文字发现未应用，日期问题已修复。'});
pointer.currentScopeReviews.evidence.push('../'+dir+'park-culture-source-review-03.json');
pointer.latestReadOnlyFindings.parkCultureFollowup='../'+dir+'park-culture-source-review-03.json';
for(const result of actual.results)pointer.resolvedFindings.push({entityId:result.entityId,name:result.name,status:result.groupDurationExcluded?'resolved_group_duration_batch56_v2':result.historicLocationPreserved?'resolved_specific_temple_name_scope_batch56_v2':'resolved_cave_wrong_point_scope_batch56_v2',
  resolvedByEntityBatch:56,variant:'v2',confirmed:result.confirmed,pending:0,evidence:'../'+dir+'park-culture-downstream-check-01.json',fullReviewPassed:false,
  coordinatesCleared:result.wrongPointClearedPreciseLocationPending,preciseLocationResolved:false,historicLocationPreserved:result.historicLocationPreserved});
for(const k of ['unappliedFindings','unappliedMetadataFindings','resolvedMetadataFindings','latestMetadataRefresh','summary','scopeSha256','mapCredentialGate'])assert.deepEqual(pointer[k],before[k]);
task.notes=progress+'见research/'+report+'。';
const prd=fs.readFileSync(url('../prd.md'),'utf8'),continuation=fs.readFileSync(url('nine-cities-continuation-20261007.md'),'utf8');
const range=/^- 用户最新明确：\*\*云南不处理，继续其他城市直到验收通过\*\*。[^\n]*$/m;
assert.ok(range.test(prd));assert.ok(prd.includes('## 已知事实\n')&&continuation.includes('## 本轮断点\n'));
const nextPrd=prd.replace(range,'- 用户最新明确：**云南不处理，继续其他城市直到验收通过**。九城固定978主体＋56依赖/1135源，162范围内待审及4必去缺口。第56批v2公园合计时长、四窟万象坏点、共青团路关帝庙具体名称/scope已双同步；济南18行AI自查、76未完成，3项文字发现未应用，日期问题已修复。图片比对暂缓；天地图凭据待轮换但其余文字清洗继续。云南、89普通长尾和37已隔离错城来源归属不扩入主动范围，未获用户验收。')
  .replace('## 已知事实\n','## 已知事实\n\n### 最新进展：第56批v2公园时长与文化地点\n\n'+progress+'见[第56批记录](research/'+report+')。以下为历史快照。\n');
const nextContinuation=continuation.replace('## 本轮断点\n','## 本轮断点\n\n当前以review36为准。'+progress+'下一实体批次57使用flow59/audit56/review37，禁止重放；56正式应用仅v2，初案未应用。见['+report+']('+report+')。以下为历史断点。\n');
const fresh=new Map([
  [dir+'review-36.json',json(ledger)],
  [dir+'review-36.md','# 济南98项重点清单核查台账（第56批v2）\n\n'+progress+'\n\n| 原名称 | 当前名称 | 版本 | 进度 | 说明 |\n| --- | --- | ---: | --- | --- |\n'+ledger.rows.map(r=>`| ${r.name} | ${r.currentName??r.name} | ${r.currentRevision} | ${r.status} | ${r.followup} |`).join('\n')+'\n'],
  ['cleaning-scope/current-before-batch56.json',json(before)],
  [dir+'park-culture-final-verification-01.json',json({batch:56,variant:'v2',at,stats,productionCodeInstalled:false,installedManifestHashesVerified:61,isolatedSqlAndExport:true,reverseRollback:true,actualConsumptionTestPassed:true,
    rootTypecheck:true,extendedTypecheck:true,preflightSucceeded:true,frozenMembershipPreserved:{primary:978,dependencies:56,sourceRows:1135},fullReviewsAdded:0,remainingPrimaryToReview:76,partiallyReviewedScopeRows:31,
    otherPendingPrimaryRows:45,unappliedSemanticFindings:3,unappliedMetadataFindings:0,groupDurationExcluded:true,historicLocationPreserved:true,negativeMentionPreserved:true,consumptionFile,postFile,dualFile,imageComparison:'deferred_by_user',mapCredentialStatus:'rotation_required',userAcceptance:false})],
]);
for(const p of fresh.keys())assert.ok(!fs.existsSync(url(p)),p+'已存在，不可重放');assert.ok(fs.existsSync(url(report)));
const replace=new Map([['../task.json',json(task)],['../prd.md',nextPrd],['nine-cities-continuation-20261007.md',nextContinuation]]);
for(const kind of ['implement','check']) {
  const p=`../${kind}.jsonl`,entry={file:'.trellis/tasks/10-06-place-identity-governance/research/'+report,reason:'第56批仅v2已应用：公园合计时长/类别保持、石窟坏点/正负评价、共青团路关帝庙名称和第30批位置继承；review36/flow58/audit55。285分配/112待审、76未完成，3文字发现未应用，图片暂缓，不重放'};
  const original=fs.readFileSync(url(p),'utf8');assert.ok(!original.includes(entry.file));replace.set(p,original+JSON.stringify(entry)+'\n');
}
for(const [p,value]of fresh)fs.writeFileSync(url(p),value,{flag:'wx'});
for(const [p,value]of replace)fs.writeFileSync(url(p),value);
fs.writeFileSync(url('cleaning-scope/current.json'),json(pointer));
console.log(JSON.stringify({batch:56,variant:'v2',ledger:'review-36',fullyReviewed:18,remaining:76,partialScope:31,otherPending:45,pendingMentions:112,currentReviewRows:162,unappliedFindings:3,stats}));
