// 第52批完成验证后的单次登记；不修改业务库、不提交、不归档。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const url=p=>new URL(p,import.meta.url),read=p=>JSON.parse(fs.readFileSync(url(p),'utf8'));
const sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex'),json=v=>JSON.stringify(v,null,2)+'\n';
const dir='priority-cities/济南/',batch='all-cities/batch-52/',folder=batch+'sync-01/',report='batch52-jinan-qinji-20261009.md',at=new Date().toISOString();
const pointer=read('cleaning-scope/current.json'),before=structuredClone(pointer),task=read('../task.json');
const eid='53fc7a0204959595c1277e9c76915534';
assert.equal(pointer.latestAppliedEntityBatch,51);assert.equal(pointer.cityReviewLedgers['济南'],'../'+dir+'review-31.json');
assert.equal(pointer.userAcceptance,false);assert.equal(pointer.taskStatus,'in_progress');assert.equal(task.status,'in_progress');
assert.equal(pointer.latestIndependentPhotoBatch,3);assert.equal(pointer.latestMetadataRefresh.run,1);assert.equal(pointer.imageComparisonPolicy.status,'deferred_by_user');
assert.equal(pointer.mapCredentialGate.status,'rotation_required');assert.deepEqual(pointer.pendingVerification,[]);
assert.equal(pointer.unappliedFindings.length,2);assert.deepEqual(pointer.unappliedMetadataFindings,[]);
assert.equal(sha(url('cleaning-scope/'+pointer.scopeFile)),pointer.scopeSha256);
const frozen=read('cleaning-scope/'+pointer.scopeFile);assert.deepEqual(frozen.summary,pointer.summary);
assert.equal(frozen.selected.length,978);assert.equal(frozen.dependencies.length,56);assert.equal(frozen.sourceIds.length,1135);assert.ok(frozen.selected.every(r=>r.place.city!=='云南'));
const source=read('all-cities/batch-52-source.json'),scopes=read('all-cities/batch-52-scope-decisions.json');
assert.equal(sha(url('all-cities/batch-52-source.json')),'98cb83f0f63097059936a3b7257c34222c8b8e8bde96cb5fd88fa4a2e1e6099c');
assert.equal(sha(url(dir+'food-followup-source-packet-01.json')),'10b28673fc9d28fb9d51b5f4a89e2860b48df16f2b5624fdaf520c239ece95f3');
assert.equal(source.sources.length,1);assert.equal(source.mentions.length,4);assert.equal(source.notes.length,3);
assert.equal(scopes.length,1);assert.deepEqual(read('all-cities/batch-52-decisions.json'),[]);
assert.equal(read('all-cities/batch-52-applied.json').apply,true);
for(const kind of ['preview','applied'])assert.equal(read(`all-cities/batch-52-${kind}.json`).changes.length,1);
const sync=read(folder+'sync-state.json').cities['济南'];assert.ok(sync.importedAt&&sync.relationsImportedAt&&sync.embeddingRunAt);assert.equal(sync.relationSnapshotRevision,26);
assert.equal(sync.exportHash,sha(url(folder+'xhs-places-济南.json')));assert.equal(sync.relationHash,sha(url(folder+'xhs-place-relations-济南.json')));
const actual=read(dir+'qinji-downstream-check-01.json'),consumption=read(folder+'qinji-consumption-1791491222769.json');
for(const [k,v]of Object.entries({consumedFieldsVerified:228,assignmentRows:272,pendingMentions:109,scopesAdded:1,confirmed:2,pendingAdded:2,coordinatesCleared:0,newPreciseLocations:0,categoriesCorrected:0,addressesAdded:0,sqlProbes:1,boundaryProbes:10,realVectorProbes:1}))assert.equal(actual[k],v);
assert.deepEqual(actual.fallbackObservedAtChanges,[]);assert.ok(actual.priorReviewRowsPreserved&&actual.rawDerivedCachesPreserved&&actual.confirmedFactsPreserved);
assert.ok(consumption.actualPlaceFacts&&consumption.confirmedContentPreserved&&consumption.mixedBranchContentRemoved&&consumption.priorGovernedFactsPreserved&&consumption.independentSourceDigestUnchanged);
assert.deepEqual(consumption.media.map(r=>r.count),[3,1]);assert.deepEqual(consumption.mockEnqueueCalls,{before:1,after:0});assert.equal(consumption.actualEnqueues,0);
const pre=read(folder+'pre-import-check.json'),post=read(folder+'post-import-check-1791491202979.json');
assert.equal(pre.mode,'before');assert.equal(pre.cities[0].unchangedSincePreview,true);assert.ok(Date.parse(pre.at)<Date.parse(sync.importedAt));
assert.equal(post.cities[0].oldRowsPreserved,238);assert.equal(post.cities[0].photoFieldsPreserved,90);assert.equal(post.cities[0].independentPhotos,9);
assert.deepEqual(post.trips,pre.trips);assert.deepEqual(post.trips,{count:201,digest:'e01d67cbf42a62fc595f4ef052f99e75'});
const isolated=read(batch+'scope-preview-1791491099949709300/report.json'),dual=read(folder+'preview-济南/preview-1791491178087.json');
assert.ok(isolated.idempotent&&isolated.reverseRollback&&isolated.originalSourcesAndMentionsUnchanged);assert.equal(isolated.pendingAdded,2);
assert.ok(dual.reverseRollback&&dual.oldRowsPreserved&&dual.photosPreserved);
const delta=read(folder+'preview-济南/relation-delta.json');assert.deepEqual(delta.changed,[]);assert.deepEqual(delta.removed,[]);
const upstream=read('all-cities/batch-52-upstream-check.json');
for(const [k,v]of Object.entries({rawSourcesUnchanged:107,originalMentionsUnchanged:662,originalNotesCovered:82,appliedEntitiesVerified:0,appliedScopesVerified:1,assignmentsVerified:4}))assert.equal(upstream[k],v);
assert.equal(upstream.finalEntityRevisions[eid],2);
const flow=read('all-cities/flow/run-54/report.json'),audit=read('all-cities/audit/run-51/report.json');
for(const r of [actual,consumption,pre,post,isolated,dual,upstream,flow,audit,read(folder+'verification-vectors.json')])assert.deepEqual(r.failures,[]);
assert.equal(read('all-cities/flow/run-54/cleanup.json').removed,true);
assert.match(fs.readFileSync(url('downstream-place_identity_test_1791491217449.log'),'utf8'),/pass 1/);
assert.match(fs.readFileSync(url('upstream-stage-place_identity_test_1791491098537.log'),'utf8'),/"reverseRollback": true/);
const stats={positive:flow.cities.reduce((n,c)=>n+c.probes.length,0),boundaries:flow.cities.reduce((n,c)=>n+c.negativeProbes.length,0),withdrawals:flow.cities.reduce((n,c)=>n+c.withdrawalProbes.length,0),pending:audit.cities.reduce((n,c)=>n+(c.statuses.PENDING??0),0)};
assert.deepEqual(stats,{positive:310,boundaries:113,withdrawals:47,pending:289});
const install=read('upstream-install.json');assert.equal(install.files.length,61);
for(const f of install.files)for(const p of [url('upstream/'+f.path),'D:/Project/xhs-travel-pipeline/'+f.path])assert.equal(sha(p),f.after);

const ledger=read(dir+'review-31.json'),oldRows=structuredClone(ledger.rows),followup=read(dir+'food-followup-source-review-01.json');
assert.deepEqual(ledger.rows.map(r=>[r.entityId,r.name]).sort(),frozen.selected.filter(r=>r.place.city==='济南').map(r=>[r.place.id,r.place.name]).sort());
const row=ledger.rows.find(r=>r.entityId===eid);assert.equal(row.currentRevision,1);assert.equal(row.status,'pending');
Object.assign(row,{currentName:row.name,currentEntityId:eid,currentRevision:2,changeBatch:52,reviewBatch:52,status:'reviewed_scope_partial',
  governedSourceIds:[5342],scopeMentionIds:[11364,11664,12605,12892],currentMentionIds:[11364,12605],pendingScopeMentionIds:[11664,12892],
  dimensions:{...row.dimensions,identity:'branch_scope_partial',category:'food_verified',location:'existing_location_preserved_not_newly_verified',media:'deferred_by_user',consumedFacts:'confirmed_recommendation_preserved_mixed_branch_mentions_pending'},
  followup:'第52批完整scope保留铜元局前街两条同篇推荐；多位置建议11664和裸名12892待审。混用内容停止消费，原名/ID/地址/坐标保持，具体分店与位置及图片仍待核。',
  mediaBoundary:'本批上游图、独立图源/绑定与原图片字段均无；只核元数据和实际返回，没有图像验收。',
  reviewEvidence:[...(row.reviewEvidence??[]),dir+'qinji-source-review-01.json',dir+'qinji-downstream-check-01.json',folder+'qinji-consumption-1791491222769.json']});
const touched=new Set([eid]);
for(const item of followup.rows.filter(r=>r.sourceId!==5342)) {
  const r=ledger.rows.find(r=>r.sourceIds.includes(item.sourceId));assert.ok(r);assert.equal(r.status,'pending');touched.add(r.entityId);
  r.followup=item.conclusion+'本轮未应用实体变更，精确位置及媒体仍待核。';r.textReviewBatch=52;
  r.reviewEvidence=[...(r.reviewEvidence??[]),dir+'food-followup-source-review-01.json'];
  r.dimensions={...r.dimensions,media:'deferred_by_user'};
}
for(let i=0;i<ledger.rows.length;i++)if(!touched.has(ledger.rows[i].entityId))assert.deepEqual(ledger.rows[i],oldRows[i]);
assert.deepEqual(ledger.rows.map(r=>[r.entityId,r.name]),oldRows.map(r=>[r.entityId,r.name]));
assert.equal(ledger.rows.filter(r=>['reviewed_scope_partial','mixed_source_withdrawn_assignment_pending'].includes(r.status)).length,23);
assert.equal(ledger.rows.filter(r=>['pending','reviewed_identity_media_location_pending'].includes(r.status)).length,53);
assert.equal(ledger.rows.filter(r=>r.status==='reviewed_identity_media_location_pending').length,9);
assert.equal(ledger.summary.governedScopeMentions,405);assert.equal(ledger.summary.wrongPointClearedPositionPending,16);
ledger.createdAt=at;ledger.previousLedger=dir+'review-31.json';
Object.assign(ledger.summary,{partiallyReviewedScopeRows:23,governedScopeMentions:409,pendingScopeMentions:109,otherPendingPrimaryRows:53,confirmedQinjiMentions:2,
  fullyReviewedMeaning:'18原入选行对应16现行主体；第52批秦记仅完成部分scope、其他四店只读文字复核，新增完整自查0，用户未验收。',
  scopeProgressMeaning:'98行保留：4非地点、18行AI自查、76未完成（23部分scope、53其余）；159正式范围审核、4必去缺口，两商业文字发现未应用，日期元数据问题已修复。'});
assert.equal(ledger.summary.fullyReviewed,18);assert.equal(ledger.summary.remainingPrimaryToReview,76);
const progress='第52批秦记火烧1源4提及/3全文完整scope已双同步，根revision1→2；铜元局前街两同篇推荐确认，多位置11664与裸名12892转待审，混合分店建议停止消费；原名/ID/美食food/地址坐标保持但位置未新验证，无新分店/合并/撤回。228地点/18关系/direct3、来源revision26、关系内容0变化；107原源/662提及/82全文、旧268分配保持，现272分配/109待审。1SQL/1真实向量/10边界、实际placeFacts、隔离幂等/倒序回滚、真实双导入通过，正常前置检查成功。238旧行/90图片字段/9绑定/201行程保持，图库3/1不变；秦记前后均无图，mock回调1→0、真实入队0，未查看图片。保留内容的来源日期稳定，向量无待回填。其余四家餐饮文字复核保存，位置待核，未写业务决定。61文件实装哈希保持，无生产安装；flow54为310正例/113边界/47撤回0失败，audit51为289PENDING，全仓/扩展typecheck通过。review32仍98行：4非地点、18行AI自查、76未完成（23部分scope、53其余）；159正式范围审核/4必去缺口，清坏点待定位16及身份已查位置媒体待核9不变，两商业文字发现不变，日期问题已修复。实体52/元数据01/图片03，无未同步或向量待核；图片暂缓、天地图凭据待轮换、云南不主动清洗，未验收不提交归档。';
Object.assign(pointer,{latestAppliedEntityBatch:52,latestFlow:'../all-cities/flow/run-54',latestAudit:'../all-cities/audit/run-51',progressNote:progress,progressUpdatedAt:at,
  latestReviewEvidence:{file:'../'+dir+'qinji-downstream-check-01.json',supplement:'../'+dir+'food-followup-source-review-01.json',fullReviewsAdded:0,partiallyReviewed:1,fullReviewsReopened:0}});
pointer.cityReviewLedgers['济南']='../'+dir+'review-32.json';
Object.assign(pointer.currentScopeReviews,{addedPendingMentions:109,currentReviewRows:159,meaning:'50固定重点实体对加109当前提及待审；第52批新增秦记混合多位置及裸名待审2，无主体删除。两商业文字发现保持，日期问题已修复。'});
pointer.currentScopeReviews.evidence.push('../'+dir+'qinji-source-review-01.json');
pointer.latestReadOnlyFindings.foodFollowup='../'+dir+'food-followup-source-review-01.json';
pointer.resolvedFindings.push({entityId:eid,name:'秦记火烧',status:'resolved_partial_branch_scope_batch52',resolvedByEntityBatch:52,confirmed:2,pending:2,evidence:'../'+dir+'qinji-downstream-check-01.json',fullReviewPassed:false,preciseLocationResolved:false});
for(const k of ['unappliedFindings','unappliedMetadataFindings','resolvedMetadataFindings','latestMetadataRefresh','summary','scopeSha256','mapCredentialGate'])assert.deepEqual(pointer[k],before[k]);
task.notes=progress+'见research/'+report+'。';
const prd=fs.readFileSync(url('../prd.md'),'utf8'),continuation=fs.readFileSync(url('nine-cities-continuation-20261007.md'),'utf8');
const range=/^- 用户最新明确：\*\*云南不处理，继续其他城市直到验收通过\*\*。[^\n]*$/m;
assert.ok(range.test(prd));assert.ok(prd.includes('## 已知事实\n')&&continuation.includes('## 本轮断点\n'));
const nextPrd=prd.replace(range,'- 用户最新明确：**云南不处理，继续其他城市直到验收通过**。九城固定978主体＋56依赖/1135源，159范围内待审及4必去缺口。第52批秦记分店范围已双同步，元数据01保持；济南18行AI自查、76未完成，两商业文字问题未应用，日期问题已修复。图片比对暂缓；天地图凭据待轮换但其余文字清洗继续。云南、89普通长尾和37已隔离错城来源归属不扩入主动范围，未获用户验收。')
  .replace('## 已知事实\n','## 已知事实\n\n### 最新进展：第52批秦记火烧分店范围\n\n'+progress+'见[第52批记录](research/'+report+')。以下为历史快照。\n');
const nextContinuation=continuation.replace('## 本轮断点\n','## 本轮断点\n\n当前以review32为准。'+progress+'下一实体批次53使用flow55/audit52，禁止重放已应用批次。见['+report+']('+report+')。以下为历史断点。\n');
const fresh=new Map([
  [dir+'review-32.json',json(ledger)],
  [dir+'review-32.md','# 济南98项重点清单核查台账（第52批）\n\n'+progress+'\n\n| 原名称 | 当前名称 | 版本 | 进度 | 说明 |\n| --- | --- | ---: | --- | --- |\n'+ledger.rows.map(r=>`| ${r.name} | ${r.currentName??r.name} | ${r.currentRevision} | ${r.status} | ${r.followup} |`).join('\n')+'\n'],
  ['cleaning-scope/current-before-batch52.json',json(before)],
  [dir+'qinji-final-verification-01.json',json({batch:52,at,stats,productionCodeInstalled:false,installedManifestHashesVerified:61,isolatedSqlAndExport:true,reverseRollback:true,actualConsumptionTestPassed:true,rootTypecheck:true,extendedTypecheck:true,preflightSucceeded:true,frozenMembershipPreserved:{primary:978,dependencies:56,sourceRows:1135},fullReviewsAdded:0,remainingPrimaryToReview:76,partiallyReviewedScopeRows:23,otherPendingPrimaryRows:53,unappliedSemanticFindings:2,unappliedMetadataFindings:0,imageComparison:'deferred_by_user',mapCredentialStatus:'rotation_required',userAcceptance:false})],
]);
for(const p of fresh.keys())assert.ok(!fs.existsSync(url(p)),p+'已存在，不可重放');assert.ok(fs.existsSync(url(report)));
const replace=new Map([['../task.json',json(task)],['../prd.md',nextPrd],['nine-cities-continuation-20261007.md',nextContinuation]]);
for(const kind of ['implement','check']) {
  const p=`../${kind}.jsonl`,entry={file:'.trellis/tasks/10-06-place-identity-governance/research/'+report,reason:'第52批秦记部分分店scope已双同步，review32/flow54/audit51；109待审、仍76未完成，四店文字复核/位置待核，元数据01保持、地图凭据待轮换、图片暂缓，不重放'};
  const original=fs.readFileSync(url(p),'utf8');assert.ok(!original.includes(entry.file));replace.set(p,original+JSON.stringify(entry)+'\n');
}
for(const [p,value]of fresh)fs.writeFileSync(url(p),value,{flag:'wx'});
for(const [p,value]of replace)fs.writeFileSync(url(p),value);
fs.writeFileSync(url('cleaning-scope/current.json'),json(pointer));
console.log(JSON.stringify({batch:52,ledger:'review-32',fullyReviewed:18,remaining:76,partialScope:23,otherPending:53,pendingMentions:109,currentReviewRows:159,stats}));
