// 第51批验证后单次登记；不触碰业务库、不提交、不归档。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const url=p=>new URL(p,import.meta.url),read=p=>JSON.parse(fs.readFileSync(url(p),'utf8'));
const sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const json=v=>JSON.stringify(v,null,2)+'\n',at=new Date().toISOString();
const dir='priority-cities/济南/',batch='all-cities/batch-51/',folder=batch+'sync-01/';
const report='batch51-jinan-food-address-20261009.md';
const pointer=read('cleaning-scope/current.json'),beforePointer=structuredClone(pointer),task=read('../task.json');
assert.equal(pointer.latestAppliedEntityBatch,50);assert.equal(pointer.cityReviewLedgers['济南'],'../'+dir+'review-30.json');
assert.equal(pointer.userAcceptance,false);assert.equal(pointer.taskStatus,'in_progress');assert.equal(task.status,'in_progress');
assert.equal(pointer.latestIndependentPhotoBatch,3);assert.equal(pointer.latestMetadataRefresh.run,1);
assert.equal(pointer.imageComparisonPolicy.status,'deferred_by_user');assert.deepEqual(pointer.pendingVerification,[]);
assert.equal(pointer.unappliedFindings.length,2);assert.deepEqual(pointer.unappliedMetadataFindings,[]);
assert.equal(sha(url('cleaning-scope/'+pointer.scopeFile)),pointer.scopeSha256);
const frozen=read('cleaning-scope/'+pointer.scopeFile);
assert.deepEqual(frozen.summary,pointer.summary);assert.equal(frozen.selected.length,978);assert.equal(frozen.dependencies.length,56);assert.equal(frozen.sourceIds.length,1135);
assert.ok(frozen.selected.every(r=>r.place.city!=='云南'));
const source=read('all-cities/batch-51-source.json'),targets=source.groups.map(g=>g.entity.entity_id);
assert.equal(targets.length,6);assert.equal(source.mentions.length,12);assert.equal(source.notes.length,1);
assert.equal(sha(url('all-cities/batch-51-source.json')),'b09a52110ec2d34818fe494c2042a707e6d3ef2571356a6d7a74db3992204793');
assert.equal(sha(url(dir+'food-address-source-packet-01.json')),'23bc32bd7e3707dd1aff3c0eaa942e833c878ec8afc305429cf797c9b06882c7');
assert.deepEqual(read('all-cities/batch-51-scope-decisions.json'),[]);
assert.equal(read('all-cities/batch-51-applied.json').apply,true);
for(const kind of ['preview','applied'])assert.equal(read(`all-cities/batch-51-${kind}.json`).changes.length,6);
const sync=read(folder+'sync-state.json').cities['济南'];
assert.ok(sync.importedAt&&sync.relationsImportedAt&&sync.embeddingRunAt);assert.equal(sync.relationSnapshotRevision,25);
assert.equal(sync.exportHash,sha(url(folder+'xhs-places-济南.json')));assert.equal(sync.relationHash,sha(url(folder+'xhs-place-relations-济南.json')));
const actual=read(dir+'food-address-downstream-check-01.json'),consumption=read(folder+'food-address-consumption-1791490571712.json');
for(const [k,v]of Object.entries({consumedFieldsVerified:228,assignmentRows:268,pendingMentions:107,scopesAdded:0,coordinatesCleared:6,newPreciseLocations:0,categoriesCorrected:0,addressesAdded:6,sqlProbes:12,boundaryProbes:144,realVectorProbes:6}))assert.equal(actual[k],v);
assert.deepEqual(actual.fallbackObservedAtChanges,[]);assert.ok(actual.allReviewRowsPreserved&&actual.rawDerivedCachesPreserved&&actual.sourceFactsPreserved);
assert.ok(consumption.actualPlaceFacts&&consumption.sourceContentPreserved&&consumption.priorGovernedFactsPreserved&&consumption.independentSourceDigestUnchanged);
assert.deepEqual(consumption.media.map(r=>r.count),[3,1]);assert.deepEqual(consumption.mockEnqueueCalls,{before:6,after:6});assert.equal(consumption.actualEnqueues,0);
const post=read(folder+'post-import-check-1791490671715.json'),baseline=read(folder+'import-audit-baseline.json');
assert.equal(post.cities[0].photoFieldsPreserved,90);assert.equal(post.cities[0].oldRowsPreserved,238);assert.equal(post.cities[0].independentPhotos,9);
assert.equal(baseline.preflightSucceeded,false);assert.equal(baseline.importBeforeStateEqualsFrozenLibrary,true);assert.equal(baseline.preservedVectors,232);
assert.equal(baseline.evidenceContentsPreserved,524);assert.equal(baseline.evidenceFetchTimesRefreshed,505);
assert.deepEqual(post.trips,{count:201,digest:'e01d67cbf42a62fc595f4ef052f99e75'});
assert.ok(!fs.existsSync(url(folder+'pre-import-check.json')),'不能伪造前置成功');
const isolated=read(batch+'identity-preview-1791490489195664000/report.json'),dual=read(folder+'preview-济南/preview-1791490528930.json');
assert.ok(isolated.idempotent&&isolated.reverseRollback&&isolated.factsPreserved&&isolated.originalSourcesAndMentionsUnchanged);
assert.ok(dual.reverseRollback&&dual.oldRowsPreserved&&dual.photosPreserved);
const delta=read(folder+'preview-济南/relation-delta.json');assert.deepEqual(delta.changed,[]);assert.deepEqual(delta.removed,[]);
const upstream=read('all-cities/batch-51-upstream-check.json');
for(const [k,v]of Object.entries({rawSourcesUnchanged:107,originalMentionsUnchanged:662,originalNotesCovered:82,appliedEntitiesVerified:6}))assert.equal(upstream[k],v);
for(const id of targets)assert.equal(upstream.finalEntityRevisions[id],2);
const flow=read('all-cities/flow/run-53/report.json'),audit=read('all-cities/audit/run-50/report.json');
for(const r of [actual,consumption,post,baseline,isolated,dual,upstream,flow,audit,read(folder+'verification-vectors.json')])assert.deepEqual(r.failures,[]);
assert.equal(read('all-cities/flow/run-53/cleanup.json').removed,true);
assert.match(fs.readFileSync(url('downstream-place_identity_test_1791490566324.log'),'utf8'),/pass 1/);
assert.match(fs.readFileSync(url('upstream-stage-place_identity_test_1791490487437.log'),'utf8'),/"reverseRollback": true/);
const stats={positive:flow.cities.reduce((n,c)=>n+c.probes.length,0),boundaries:flow.cities.reduce((n,c)=>n+c.negativeProbes.length,0),withdrawals:flow.cities.reduce((n,c)=>n+c.withdrawalProbes.length,0),pending:audit.cities.reduce((n,c)=>n+(c.statuses.PENDING??0),0)};
assert.deepEqual(stats,{positive:309,boundaries:113,withdrawals:47,pending:287});
const install=read('upstream-install.json');assert.equal(install.apply,true);assert.equal(install.files.length,61);
for(const f of install.files)for(const p of [url('upstream/'+f.path),'D:/Project/xhs-travel-pipeline/'+f.path])assert.equal(sha(p),f.after);
assert.equal(read('map-credential-rotation-required.json').status,'rotation_required');

const ledger=read(dir+'review-30.json'),oldRows=structuredClone(ledger.rows);
assert.deepEqual(ledger.rows.map(r=>[r.entityId,r.name]).sort(),frozen.selected.filter(r=>r.place.city==='济南').map(r=>[r.place.id,r.place.name]).sort());
assert.equal(ledger.summary.wrongPointClearedPositionPending,10);assert.equal(ledger.summary.reviewedIdentityMediaLocationPending,3);
for(const result of actual.results) {
  const row=ledger.rows.find(r=>r.entityId===result.entityId);assert.equal(row.currentRevision,1);assert.equal(row.status,'pending');
  assert.ok(row.evidenceFiles===undefined||Array.isArray(row.evidenceFiles));
  Object.assign(row,{currentRevision:2,changeBatch:51,reviewBatch:51,status:'reviewed_identity_media_location_pending',
    dimensions:{...row.dimensions,identity:'text_supports_separate_store',category:'food_verified',location:'unsupported_point_cleared_original_address_precise_position_pending',media:'deferred_by_user',consumedFacts:'original_facts_preserved_no_new_scope'},
    followup:`第51批按note2585补文字地址${result.address}，无依据坐标清空；原名/ID/food美食与两条同篇提及事实保持，未新增scope；精确点及图片待核。`,
    evidenceFiles:[...(row.evidenceFiles??[]),dir+'food-address-source-review-01.json',dir+'food-address-downstream-check-01.json',folder+'food-address-consumption-1791490571712.json']});
}
for(let i=0;i<ledger.rows.length;i++)if(!targets.includes(ledger.rows[i].entityId))assert.deepEqual(ledger.rows[i],oldRows[i]);
assert.deepEqual(ledger.rows.map(r=>[r.entityId,r.name]),oldRows.map(r=>[r.entityId,r.name]));
assert.equal(ledger.rows.filter(r=>['reviewed_scope_partial','mixed_source_withdrawn_assignment_pending'].includes(r.status)).length,22);
assert.equal(ledger.rows.filter(r=>['pending','reviewed_identity_media_location_pending'].includes(r.status)).length,54);
assert.equal(ledger.rows.filter(r=>r.status==='reviewed_identity_media_location_pending').length,9);
ledger.createdAt=at;ledger.previousLedger=dir+'review-30.json';
Object.assign(ledger.summary,{wrongPointClearedPositionPending:16,reviewedIdentityMediaLocationPending:9,
  fullyReviewedMeaning:'18原入选行对应16现行主体；第51批六店仅补地址/清错点，精确位置及图片待核，新增完整自查0，用户未验收。'});
assert.equal(ledger.summary.fullyReviewed,18);assert.equal(ledger.summary.remainingPrimaryToReview,76);
const progress='第51批六家餐饮店已应用双同步：6源12提及仅1篇独立全文，实体revision1→2，补原文地址并清无依据坐标，美食/food、原名/ID/事实保持；无scope/分配/待审新增。228地点/18关系/direct3、来源revision25、关系内容0变化；107原源/662提及/82全文、268既有分配/107待审保持。12SQL调用（6独立店名）、6真实向量、144边界、实际事实消费、隔离幂等/逆序回滚通过。238旧行/232向量、524语料、90图片字段/9绑定/201行程保持；505语料导入时间刷新，元数据01后的看点日期0漂移。图库3/1保持，六目标无图，mock前后各6、真实入队0，未查看图片。前置检查参数错误且编排继续导入，真实事务before_state已补证等于冻结库，明确非前置成功；新导入已加前置工件门禁及6项契约回归。地图凭据曾因旧异常暴露，探针已脱敏/保留部分结果/联网前门禁，2离线测试通过，轮换前暂停天地图；其他清洗继续。61实装文件哈希保持，无生产安装；flow53为309正例/113边界/47撤回0失败，audit50仍287PENDING，全仓/扩展typecheck通过。review31仍98行：4非地点、18行AI自查、76未完成（22部分scope、54其余），清坏点待定位16、身份已查位置媒体待核9；157正式范围审核/4必去缺口、两商业文字发现不变，日期问题已修复。实体51/元数据01/图片03，无未同步或向量待核；图片暂缓、云南不主动清洗，未验收不提交归档。';
Object.assign(pointer,{latestAppliedEntityBatch:51,latestFlow:'../all-cities/flow/run-53',latestAudit:'../all-cities/audit/run-50',progressNote:progress,progressUpdatedAt:at,
  latestReviewEvidence:{file:'../'+dir+'food-address-downstream-check-01.json',supplement:'../'+folder+'import-audit-baseline.json',fullReviewsAdded:0,partiallyReviewed:6,fullReviewsReopened:0},
  mapCredentialGate:{file:'../map-credential-rotation-required.json',status:'rotation_required',provider:'tianditu',automaticRotationPerformed:false}});
pointer.cityReviewLedgers['济南']='../'+dir+'review-31.json';
pointer.currentScopeReviews.meaning='50固定重点实体对加107当前提及待审；第51批六店仅补原文地址/清错点，无scope或待审增量。两商业文字发现保持；日期问题已修复，地图凭据待轮换。';
for(const r of actual.results)pointer.resolvedFindings.push({entityId:r.entityId,name:r.name,status:'resolved_unsupported_point_and_original_address_batch51_precise_location_pending',resolvedByEntityBatch:51,evidence:'../'+dir+'food-address-downstream-check-01.json',coordinatesCleared:true,preciseLocationResolved:false,fullReviewPassed:false});
for(const k of ['unappliedFindings','unappliedMetadataFindings','resolvedMetadataFindings','latestMetadataRefresh','summary','scopeSha256'])assert.deepEqual(pointer[k],beforePointer[k]);
assert.equal(pointer.currentScopeReviews.currentReviewRows,157);assert.equal(pointer.currentScopeReviews.addedPendingMentions,107);
task.notes=progress+'见research/'+report+'。';
const prd=fs.readFileSync(url('../prd.md'),'utf8'),continuation=fs.readFileSync(url('nine-cities-continuation-20261007.md'),'utf8');
const range=/^- 用户最新明确：\*\*云南不处理，继续其他城市直到验收通过\*\*。[^\n]*$/m;
assert.ok(range.test(prd));assert.ok(prd.includes('## 已知事实\n')&&continuation.includes('## 本轮断点\n'));
const nextPrd=prd.replace(range,'- 用户最新明确：**云南不处理，继续其他城市直到验收通过**。九城固定978主体＋56依赖/1135源，157范围内待审及4必去缺口。第51批六店地址/清错点已双同步，元数据01保持；济南18行AI自查、76未完成，两商业文字问题未应用，日期问题已修复。图片比对暂缓；天地图凭据待轮换但其余文字清洗继续。云南、89普通长尾和37已隔离错城来源归属不扩入主动范围，未获用户验收。')
  .replace('## 已知事实\n','## 已知事实\n\n### 最新进展：第51批六家餐饮店地址与坐标\n\n'+progress+'见[第51批记录](research/'+report+')。以下为历史快照。\n');
const nextContinuation=continuation.replace('## 本轮断点\n','## 本轮断点\n\n当前以review31为准。'+progress+'下一实体批次52使用flow54/audit51，不能重放已应用批次或使用未轮换的天地图凭据。见['+report+']('+report+')。以下为历史断点。\n');
const fresh=new Map([
  [dir+'review-31.json',json(ledger)],
  [dir+'review-31.md','# 济南98项重点清单核查台账（第51批）\n\n'+progress+'\n\n| 原名称 | 当前名称 | 版本 | 进度 | 说明 |\n| --- | --- | ---: | --- | --- |\n'+ledger.rows.map(r=>`| ${r.name} | ${r.currentName??r.name} | ${r.currentRevision} | ${r.status} | ${r.followup} |`).join('\n')+'\n'],
  ['cleaning-scope/current-before-batch51.json',json(beforePointer)],
  [dir+'food-address-final-verification-01.json',json({batch:51,at,stats,productionCodeInstalled:false,installedManifestHashesVerified:61,isolatedSqlAndExport:true,reverseRollback:true,actualConsumptionTestPassed:true,rootTypecheck:true,extendedTypecheck:true,mapProbeSafetyTests:2,syncContractTests:6,preflightSucceeded:false,transactionAuditRecoveryVerified:true,frozenMembershipPreserved:{primary:978,dependencies:56,sourceRows:1135},fullReviewsAdded:0,remainingPrimaryToReview:76,partiallyReviewedScopeRows:22,unappliedSemanticFindings:2,unappliedMetadataFindings:0,imageComparison:'deferred_by_user',mapCredentialStatus:'rotation_required',userAcceptance:false})],
]);
for(const p of fresh.keys())assert.ok(!fs.existsSync(url(p)),p+'已存在，不能重放');assert.ok(fs.existsSync(url(report)));
const replace=new Map([['../task.json',json(task)],['../prd.md',nextPrd],['nine-cities-continuation-20261007.md',nextContinuation]]);
for(const kind of ['implement','check']) {
  const p=`../${kind}.jsonl`,entry={file:'.trellis/tasks/10-06-place-identity-governance/research/'+report,reason:'第51批六店地址/清错点已双同步，review31/flow53/audit50仍76未完成；元数据01保持，地图凭据待轮换、图片暂缓，前置失误已事务补证，不重放'};
  const original=fs.readFileSync(url(p),'utf8');assert.ok(!original.includes(entry.file));replace.set(p,original+JSON.stringify(entry)+'\n');
}
for(const [p,value]of fresh)fs.writeFileSync(url(p),value,{flag:'wx'});
for(const [p,value]of replace)fs.writeFileSync(url(p),value);
fs.writeFileSync(url('cleaning-scope/current.json'),json(pointer));
console.log(JSON.stringify({batch:51,ledger:'review-31',fullyReviewed:18,remaining:76,partialScope:22,unappliedSemantic:2,unappliedMetadata:0,stats}));
