// 第50批已成功应用后的单次证据登记；不修改业务库、不提交、不归档。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const url=p=>new URL(p,import.meta.url),read=p=>JSON.parse(fs.readFileSync(url(p),'utf8'));
const sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const json=v=>JSON.stringify(v,null,2)+'\n';
const dir='priority-cities/济南/',batch='all-cities/batch-50/',at=new Date().toISOString();
const report='batch50-jinan-vintage-20261009.md';
const targets=['2ccb52ac3eeda4ca713a2b7bd975b566','46bf3d4bc9d5aa019dd4a3184329e58a'];
const pointer=read('cleaning-scope/current.json'),beforePointer=structuredClone(pointer),task=read('../task.json');
assert.equal(pointer.latestAppliedEntityBatch,49);
assert.equal(pointer.cityReviewLedgers['济南'],'../'+dir+'review-28.json');
assert.equal(pointer.userAcceptance,false);assert.equal(pointer.taskStatus,'in_progress');assert.equal(task.status,'in_progress');
assert.equal(pointer.imageComparisonPolicy.status,'deferred_by_user');assert.equal(pointer.latestIndependentPhotoBatch,3);
assert.deepEqual(pointer.pendingVerification,[]);assert.equal(pointer.unappliedFindings.length,2);
assert.equal(pointer.unappliedMetadataFindings,undefined);
assert.equal(sha(url('cleaning-scope/'+pointer.scopeFile)),pointer.scopeSha256);
const frozen=read('cleaning-scope/'+pointer.scopeFile);
assert.deepEqual(frozen.summary,pointer.summary);assert.equal(frozen.selected.length,978);
assert.equal(frozen.dependencies.length,56);assert.equal(frozen.sourceIds.length,1135);
assert.ok(frozen.selected.every(r=>r.place.city!=='云南'));
const source=read('all-cities/batch-50-source.json'),applied=read('all-cities/batch-50-applied.json');
assert.equal(applied.apply,true);assert.equal(applied.changes.length,2);
assert.equal(read('all-cities/batch-50-preview.json').changes.length,2);
assert.deepEqual(read('all-cities/batch-50-scope-decisions.json'),[]);
assert.deepEqual(source.groups.map(g=>g.entity.entity_id).sort(),[...targets].sort());
for(const [file,hash]of [
  ['all-cities/batch-50-source.json','5e5409177eb93db984ddf3c2e1b7f8f7c4bdc187d161990eec5e2bcad68358e4'],
  [dir+'vintage-source-packet-01.json','fe0f6599fe2a96698118589810885a1cd56606065e20e64211d47a08c2be225f'],
])assert.equal(sha(url(file)),hash);
const sync=read(batch+'sync-01/sync-state.json').cities['济南'];
assert.ok(sync.importedAt&&sync.relationsImportedAt&&sync.embeddingRunAt);assert.equal(sync.relationSnapshotRevision,24);
assert.equal(sha(url(batch+'sync-01/xhs-places-济南.json')),sync.exportHash);
assert.equal(sha(url(batch+'sync-01/xhs-place-relations-济南.json')),sync.relationHash);
assert.equal(sync.exportHash,'6b384afe8d60211003da7eb498c23b95f53624326c5dc015384e3a5f3734369b');
assert.equal(sync.relationHash,'63a26a27ffa4a6d31701220a8bf3d4678bbf42f470ca41423423e885326e267d');
const actual=read(dir+'vintage-downstream-check-01.json');
for(const [key,value]of Object.entries({consumedFieldsVerified:228,assignmentRows:268,pendingMentions:107,scopesAdded:0,
  coordinatesCleared:2,newPreciseLocations:0,categoriesCorrected:1,sqlProbes:4,boundaryProbes:40,realVectorProbes:2}))assert.equal(actual[key],value);
assert.ok(actual.allReviewRowsPreserved&&actual.rawDerivedCachesPreserved&&actual.sourceFactsPreserved);
const consumption=read(batch+'sync-01/vintage-consumption-1791488705921.json');
assert.ok(consumption.actualPlaceFacts&&consumption.sourceContentPreserved&&consumption.priorGovernedFactsPreserved&&consumption.independentSourceDigestUnchanged);
assert.deepEqual(consumption.media.map(r=>r.count),[3,1]);assert.deepEqual(consumption.mockEnqueueCalls,{before:2,after:2});assert.equal(consumption.actualEnqueues,0);
const post=read(batch+'sync-01/post-import-check-1791488463745.json');
assert.equal(post.cities[0].photoFieldsPreserved,90);assert.equal(post.cities[0].oldRowsPreserved,238);assert.equal(post.cities[0].independentPhotos,9);
assert.deepEqual(post.trips,{count:201,digest:'e01d67cbf42a62fc595f4ef052f99e75'});
const isolated=read(batch+'identity-preview-1791488391766032100/report.json');
assert.ok(isolated.idempotent&&isolated.reverseRollback&&isolated.factsPreserved&&isolated.originalSourcesAndMentionsUnchanged);
const dual=read(batch+'sync-01/preview-济南/preview-1791488429433.json');
assert.ok(dual.reverseRollback&&dual.oldRowsPreserved&&dual.photosPreserved);
const delta=read(batch+'sync-01/preview-济南/relation-delta.json');assert.deepEqual(delta.changed,[]);assert.deepEqual(delta.removed,[]);
const upstream=read('all-cities/batch-50-upstream-check.json');
for(const [k,v]of Object.entries({rawSourcesUnchanged:107,originalMentionsUnchanged:662,originalNotesCovered:82,appliedEntitiesVerified:2}))assert.equal(upstream[k],v);
for(const id of targets)assert.equal(upstream.finalEntityRevisions[id],2);
const provenance=read(dir+'vintage-timestamp-provenance-01.json');
assert.equal(provenance.productionFixApplied,false);assert.equal(provenance.stats.highlights,148);assert.equal(provenance.stats.entities,127);
assert.equal(provenance.stats.highlightsWithSourceDate,148);assert.equal(provenance.stats.matchesWithoutSourceDate,0);
assert.equal(provenance.stats.matchedMentions,165);assert.equal(provenance.stats.matchedNotes,32);
assert.deepEqual(provenance.rows.map(r=>({entityId:r.entityId,name:r.name,highlightIndex:r.highlightIndex})),actual.fallbackObservedAtChanges);
const flow=read('all-cities/flow/run-52/report.json'),audit=read('all-cities/audit/run-48/report.json');
for(const r of [actual,consumption,post,isolated,dual,upstream,provenance,flow,audit,read(batch+'sync-01/verification-vectors.json')])assert.deepEqual(r.failures,[]);
assert.equal(read('all-cities/flow/run-52/cleanup.json').removed,true);
assert.match(fs.readFileSync(url('downstream-place_identity_test_1791488698831.log'),'utf8'),/pass 1/);
assert.match(fs.readFileSync(url('upstream-stage-place_identity_test_1791488390215.log'),'utf8'),/"reverseRollback": true/);
const stats={positive:flow.cities.reduce((n,c)=>n+c.probes.length,0),boundaries:flow.cities.reduce((n,c)=>n+c.negativeProbes.length,0),
  withdrawals:flow.cities.reduce((n,c)=>n+c.withdrawalProbes.length,0),pending:audit.cities.reduce((n,c)=>n+(c.statuses.PENDING??0),0)};
assert.deepEqual(stats,{positive:303,boundaries:113,withdrawals:47,pending:287});
const install=read('upstream-install.json');assert.equal(install.apply,true);assert.equal(install.files.length,60);
for(const f of install.files)for(const p of [url('upstream/'+f.path),'D:/Project/xhs-travel-pipeline/'+f.path])assert.equal(sha(p),f.after);
for(const f of provenance.sourceCode)assert.equal(sha('D:/Project/xhs-travel-pipeline/'+f.path),f.sha256);
assert.ok(!install.files.some(f=>f.path==='app/clean/place_content.py'));

const ledger=read(dir+'review-28.json'),originalRows=structuredClone(ledger.rows);
assert.deepEqual(ledger.rows.map(r=>[r.entityId,r.name]).sort(),frozen.selected.filter(r=>r.place.city==='济南').map(r=>[r.place.id,r.place.name]).sort());
assert.equal(ledger.summary.wrongPointClearedPositionPending,8);assert.equal(ledger.summary.reviewedIdentityMediaLocationPending,1);
for(const id of targets) {
  const row=ledger.rows.find(r=>r.entityId===id),shop=id===targets[1];
  assert.equal(row.currentRevision,1);assert.equal(row.status,'pending');
  Object.assign(row,{currentRevision:2,changeBatch:50,reviewBatch:50,status:'reviewed_identity_media_location_pending',
    dimensions:{...row.dimensions,identity:'text_supports_separate_store',category:shop?'shopping_shop_verified':'food_cafe_verified',
      location:'unsupported_geocoder_point_cleared_precise_position_pending',media:'deferred_by_user',consumedFacts:'original_facts_preserved_no_new_scope'},
    followup:shop?'第50批独立骨董屋购物/shop已同步，旧无POI坐标清空，采用经三路120号文字地址；同名附近古着仓不作别名，精确点及图片待核。':
      '第50批独立咖啡店美食/cafe保持，旧无POI坐标清空；纬四路/上新街分店仅候选，原文未明分店，地址仍空，精确点及图片待核。',
    evidenceFiles:[...row.evidenceFiles,dir+'vintage-source-review-01.json',dir+'vintage-geocode-provenance-01.json',
      dir+'vintage-downstream-check-01.json',batch+'sync-01/vintage-consumption-1791488705921.json']});
}
for(let i=0;i<ledger.rows.length;i++)if(!targets.includes(ledger.rows[i].entityId))assert.deepEqual(ledger.rows[i],originalRows[i]);
assert.deepEqual(ledger.rows.map(r=>[r.entityId,r.name]),originalRows.map(r=>[r.entityId,r.name]));
assert.equal(ledger.rows.filter(r=>['reviewed_scope_partial','mixed_source_withdrawn_assignment_pending'].includes(r.status)).length,22);
assert.equal(ledger.rows.filter(r=>['pending','reviewed_identity_media_location_pending'].includes(r.status)).length,54);
assert.equal(ledger.rows.filter(r=>r.status==='reviewed_identity_media_location_pending').length,3);
ledger.createdAt=at;ledger.previousLedger=dir+'review-28.json';
Object.assign(ledger.summary,{wrongPointClearedPositionPending:10,reviewedIdentityMediaLocationPending:3,unappliedMetadataFindings:1,
  fullyReviewedMeaning:'18原入选行对应16现行主体；第50批新增完整自查0，两店清错点但精确位置及图片待核，用户未验收。',
  scopeProgressMeaning:'98行保留：4非地点、18行AI自查、76未完成（22部分scope、54其余）；157正式范围审核、4必去缺口，2项商业文字发现及独立1项时间元数据发现未应用。'});
assert.equal(ledger.summary.fullyReviewed,18);assert.equal(ledger.summary.remainingPrimaryToReview,76);
const progress='第50批VILLASHAKA/BLUEDUCK骨董屋两源2提及/1全文已同步，两实体revision1→2。无具名POI的共同旧点可当前复现，消费坐标清空但不等于精确定位；骨董屋购物/shop及经三路120号文字地址，咖啡店美食/cafe保持、分店候选不采用。原名/ID/原源与事实保持，无scope新增/分配变更。228地点/18关系/direct3、来源revision24、关系0变化；4SQL/2真实向量/40边界、268既有分配、隔离SQL/导出/幂等/逆序回滚、实际消费和双导入通过。107原源/662提及/82全文、238旧行/90图片字段/9绑定/201行程保持，老商埠3图/经三路1图旧消费不变，无图目标mock回调前后各2次、真实入队0，未查看图片。148看点/127实体observedAt随compiledAt变动，已只读追溯165提及/32篇均有源日期，属legacy reason未传日期，单列元数据问题未修复。无生产安装、60文件哈希保持；flow52为303正例/113边界/47撤回0失败，audit48为287PENDING，全仓及扩展typecheck通过。review29仍98行：4非地点、18行AI自查、76未完成（22部分scope、54其余）；济南107待审、157正式范围审核/4必去缺口，2项商业文字发现不变，新增独立元数据发现1。实体50/图片03，无未同步或向量待核；图片暂缓、云南不处理，未验收不提交归档。';
Object.assign(pointer,{latestAppliedEntityBatch:50,latestFlow:'../all-cities/flow/run-52',latestAudit:'../all-cities/audit/run-48',
  progressNote:progress,progressUpdatedAt:at,latestReviewEvidence:{file:'../'+dir+'vintage-downstream-check-01.json',
    supplement:'../'+dir+'vintage-timestamp-provenance-01.json',fullReviewsAdded:0,partiallyReviewed:2,fullReviewsReopened:0}});
pointer.cityReviewLedgers['济南']='../'+dir+'review-29.json';
pointer.currentScopeReviews.meaning='50固定重点实体对加107当前提及待审；第50批只修订两店位置/类别，无scope或待审增量。百花洲12946及两商业文字发现保持；时间元数据发现单列。';
for(const row of actual.results)pointer.resolvedFindings.push({entityId:row.entityId,name:row.name,
  status:'resolved_unsupported_point_and_category_batch50_precise_location_pending',resolvedByEntityBatch:50,
  evidence:'../'+dir+'vintage-downstream-check-01.json',coordinatesCleared:true,preciseLocationResolved:false,fullReviewPassed:false});
pointer.unappliedMetadataFindings=[{kind:'legacy_highlight_observed_at_fallback',status:'unapplied',discoveredDuringEntityBatch:50,
  highlights:148,entities:127,matchedMentions:165,matchedNotes:32,
  reason:'原始来源已有created_at，但legacy reason看点未传observedAt，随导出compiledAt回填；需独立修复与重导出评估。',
  evidence:'../'+dir+'vintage-timestamp-provenance-01.json',productionFixApplied:false}];
assert.deepEqual(pointer.unappliedFindings,beforePointer.unappliedFindings);
assert.deepEqual(pointer.summary,beforePointer.summary);assert.equal(pointer.scopeSha256,beforePointer.scopeSha256);
assert.equal(pointer.currentScopeReviews.currentReviewRows,157);assert.equal(pointer.currentScopeReviews.addedPendingMentions,107);
task.notes=progress+'见research/'+report+'。';
const prd=fs.readFileSync(url('../prd.md'),'utf8'),continuation=fs.readFileSync(url('nine-cities-continuation-20261007.md'),'utf8');
assert.ok(prd.includes('## 已知事实\n')&&continuation.includes('## 本轮断点\n'));
const range=/^- 用户最新明确：\*\*云南不处理，继续其他城市直到验收通过\*\*。[^\n]*$/m;
assert.ok(range.test(prd));
const nextPrd=prd.replace(range,'- 用户最新明确：**云南不处理，继续其他城市直到验收通过**。九城固定978主体＋56依赖/1135源，157范围内待审及4必去缺口。第50批已双同步，图片比对暂缓；济南18行AI自查、76未完成；另有2项商业文字及1项日期元数据发现未应用。云南、89普通长尾和37已隔离错城来源归属不扩入主动范围，未获用户验收。')
  .replace('## 已知事实\n','## 已知事实\n\n### 最新进展：第50批两店坐标及类别\n\n'+progress+'见[第50批记录](research/'+report+')。以下为历史快照。\n');
const nextContinuation=continuation.replace('## 本轮断点\n','## 本轮断点\n\n当前以review29为准。'+progress+'下一实体批次51使用flow53/audit49。见['+report+']('+report+')。以下为历史断点。\n');
const fresh=new Map([
  [dir+'review-29.json',json(ledger)],
  [dir+'review-29.md','# 济南98项重点清单核查台账（第50批）\n\n'+progress+'\n\n| 原名称 | 当前名称 | 版本 | 进度 | 说明 |\n| --- | --- | ---: | --- | --- |\n'+ledger.rows.map(r=>`| ${r.name} | ${r.currentName??r.name} | ${r.currentRevision} | ${r.status} | ${r.followup} |`).join('\n')+'\n'],
  ['cleaning-scope/current-before-batch50.json',json(beforePointer)],
  [dir+'vintage-final-verification-01.json',json({batch:50,at,stats,productionCodeInstalled:false,installedManifestHashesVerified:60,
    isolatedSqlAndExport:true,reverseRollback:true,actualConsumptionTestPassed:true,rootTypecheck:true,extendedTypecheck:true,
    frozenMembershipPreserved:{primary:978,dependencies:56,sourceRows:1135},fullReviewsAdded:0,remainingPrimaryToReview:76,
    partiallyReviewedScopeRows:22,unappliedSemanticFindings:2,unappliedMetadataFindings:1,timestampProvenance:provenance.stats,
    imageComparison:'deferred_by_user',userAcceptance:false})],
]);
for(const p of fresh.keys())assert.ok(!fs.existsSync(url(p)),p+'已存在，不得重放');
assert.ok(fs.existsSync(url(report)));
const replace=new Map([['../task.json',json(task)],['../prd.md',nextPrd],['nine-cities-continuation-20261007.md',nextContinuation]]);
for(const kind of ['implement','check']) {
  const p=`../${kind}.jsonl`,entry={file:'.trellis/tasks/10-06-place-identity-governance/research/'+report,
    reason:'第50批两店清错点和类别已同步，review29仍76未完成；148看点时间回填另有真实溯源，未修复，图片暂缓，不重放'};
  const original=fs.readFileSync(url(p),'utf8');assert.ok(!original.includes(entry.file));replace.set(p,original+JSON.stringify(entry)+'\n');
}
// 所有断言和输出预检完成后才登记；指针最后写入，脚本不会调用生产变更或收尾工具。
for(const [p,value]of fresh)fs.writeFileSync(url(p),value,{flag:'wx'});
for(const [p,value]of replace)fs.writeFileSync(url(p),value);
fs.writeFileSync(url('cleaning-scope/current.json'),json(pointer));
console.log(JSON.stringify({batch:50,ledger:'review-29',fullyReviewed:18,remaining:76,partialScope:22,unappliedSemantic:2,unappliedMetadata:1,stats}));
