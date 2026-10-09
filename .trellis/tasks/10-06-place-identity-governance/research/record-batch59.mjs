// 单次登记第59批验证结果；任务保持进行中，等待用户验收。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const url=p=>new URL(p,import.meta.url),read=p=>JSON.parse(fs.readFileSync(url(p),'utf8')),json=v=>JSON.stringify(v,null,2)+'\n';
const sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const dir='priority-cities/济南/',folder='all-cities/batch-59/sync-01/',report='batch59-jinan-night-market-20261009.md',at=new Date().toISOString();
const unique=(p,re)=>{const names=fs.readdirSync(url(p)).filter(n=>re.test(n));assert.equal(names.length,1);return p+names[0];};
const pointer=read('cleaning-scope/current.json'),before=structuredClone(pointer),task=read('../task.json');
assert.equal(pointer.latestAppliedEntityBatch,58);assert.equal(pointer.cityReviewLedgers['济南'],'../'+dir+'review-38.json');
assert.equal(pointer.userAcceptance,false);assert.equal(task.status,'in_progress');assert.equal(pointer.taskStatus,'in_progress');assert.deepEqual(pointer.pendingVerification,[]);
assert.equal(pointer.latestIndependentPhotoBatch,3);assert.equal(pointer.latestMetadataRefresh.run,1);assert.equal(pointer.imageComparisonPolicy.status,'deferred_by_user');assert.equal(pointer.mapCredentialGate.status,'rotation_required');assert.equal(pointer.unappliedFindings.length,3);
assert.equal(sha(url('cleaning-scope/'+pointer.scopeFile)),pointer.scopeSha256);const frozen=read('cleaning-scope/'+pointer.scopeFile);assert.deepEqual(frozen.summary,pointer.summary);
assert.equal(frozen.selected.length,978);assert.equal(frozen.dependencies.length,56);assert.equal(frozen.sourceIds.length,1135);assert.ok(frozen.selected.every(r=>r.place.city!=='云南'));
const source=read('all-cities/batch-59-source.json'),scope=read('all-cities/batch-59-scope-decisions.json')[0],decision=read('all-cities/batch-59-decisions.json')[0];
const eid='7950bfadd891932d01be8636aba8b51a';
assert.equal(sha(url('all-cities/batch-59-source.json')),'77fe3d6aa918a4e231b14305e9f626ce21b72c153c8eaa81e75f44de0ebde393');
assert.equal(source.sources.length,1);assert.equal(source.mentions.length,5);assert.equal(source.notes.length,4);assert.equal(source.noteTimes.length,4);
assert.equal(scope.assignments.length,5);assert.deepEqual(scope.assignments.filter(a=>a.entityId===null).map(a=>a.mentionId),[11464]);
assert.deepEqual(decision.overrides,{address:'祝舜路555号'});assert.equal(decision.canonicalName,'环联1904火车夜市');
for(const k of ['preview','applied'])assert.equal(read(`all-cities/batch-59-${k}.json`).changes.length,2);assert.equal(read('all-cities/batch-59-applied.json').apply,true);
const sync=read(folder+'sync-state.json').cities['济南'];assert.ok(sync.importedAt&&sync.relationsImportedAt&&sync.embeddingRunAt);assert.equal(sync.relationSnapshotRevision,33);
assert.equal(sync.exportHash,sha(url(folder+'xhs-places-济南.json')));assert.equal(sync.relationHash,sha(url(folder+'xhs-place-relations-济南.json')));
const consumptionFile=unique(folder,/^night-market-consumption-\d+\.json$/),postFile=unique(folder,/^post-import-check-\d+\.json$/),dualFile=unique(folder+'preview-济南/',/^preview-\d+\.json$/);
const actual=read(dir+'night-market-downstream-check-01.json'),consumption=read(consumptionFile),pre=read(folder+'pre-import-check.json'),post=read(postFile);
for(const [k,v]of Object.entries({consumedFieldsVerified:228,assignmentRows:300,pendingMentions:117,scopesAdded:1,confirmed:4,pendingAdded:1,coordinatesCleared:0,newPreciseLocations:0,categoriesCorrected:0,addressesCorrected:1,negativeConfirmed:3,positiveConfirmed:1,sqlProbes:2,boundaryProbes:21,realVectorProbes:1,graph:19,directEdges:3,weakRelationAdded:0}))assert.equal(actual[k],v);
assert.deepEqual(actual.fallbackObservedAtChanges,[]);assert.ok(actual.staleNavigationRemoved&&actual.confirmedFactsPreserved&&actual.priorReviewRowsPreserved&&actual.coordinatesPreservedNotNewlyVerified);
const vectors=read(folder+'verification-vectors.json');assert.equal(vectors.cities[0].vectorProbes.length,1);assert.ok(vectors.cities[0].vectorProbes.every(v=>v.diagnostics.vector==='used'));
assert.ok(consumption.actualPlaceFacts&&consumption.priorGovernedFactsPreserved&&consumption.independentSourceDigestUnchanged&&consumption.staleNavigationRemoved);
assert.equal(consumption.independentSources,10);assert.equal(consumption.eligibleIndependentSources,0);
assert.deepEqual(consumption.media.map(r=>r.count),[3,1,2]);assert.deepEqual(consumption.mockEnqueueCalls,{before:1,after:0});assert.equal(consumption.actualEnqueues,0);
assert.equal(pre.mode,'before');assert.equal(pre.cities[0].unchangedSincePreview,true);assert.ok(Date.parse(pre.at)<Date.parse(sync.importedAt));
assert.equal(post.cities[0].oldRowsPreserved,238);assert.equal(post.cities[0].photoFieldsPreserved,129);assert.equal(post.cities[0].independentPhotos,9);assert.deepEqual(post.trips,pre.trips);assert.deepEqual(post.trips,{count:201,digest:'e01d67cbf42a62fc595f4ef052f99e75'});
const isolated=read('all-cities/batch-59/scope-preview-1791496913081962100/report.json'),dual=read(dualFile),delta=read(folder+'preview-济南/relation-delta.json'),upstream=read('all-cities/batch-59-upstream-check.json');
assert.ok(isolated.idempotent&&isolated.reverseRollback&&isolated.originalSourcesAndMentionsUnchanged&&isolated.staleNavigationRemoved&&isolated.publicationDatesPreserved);
assert.ok(dual.reverseRollback&&dual.oldRowsPreserved&&dual.photosPreserved);assert.deepEqual(delta.changed,[]);assert.deepEqual(delta.removed,[]);
for(const [k,v]of Object.entries({rawSourcesUnchanged:107,originalMentionsUnchanged:662,originalNotesCovered:82,appliedEntitiesVerified:1,appliedScopesVerified:1,assignmentsVerified:5}))assert.equal(upstream[k],v);assert.equal(upstream.finalEntityRevisions[eid],3);
const times=read(dir+'night-market-times-check-01.json');assert.ok(times.publicationAndCollectionTimesPreserved&&times.rawJsonHashesPreserved);
const flow=read('all-cities/flow/run-61/report.json'),audit=read('all-cities/audit/run-58/report.json');
for(const r of [actual,consumption,pre,post,isolated,dual,upstream,flow,audit,vectors,times])assert.deepEqual(r.failures,[]);
assert.equal(read('all-cities/flow/run-61/cleanup.json').removed,true);
assert.match(fs.readFileSync(url('downstream-place_identity_test_1791497107295.log'),'utf8'),/pass 1/);assert.match(fs.readFileSync(url('upstream-stage-place_identity_test_1791496911628.log'),'utf8'),/"reverseRollback": true/);
const stats={positive:flow.cities.reduce((n,c)=>n+c.probes.length,0),boundaries:flow.cities.reduce((n,c)=>n+c.negativeProbes.length,0),withdrawals:flow.cities.reduce((n,c)=>n+c.withdrawalProbes.length,0),pending:audit.cities.reduce((n,c)=>n+(c.statuses.PENDING??0),0)};assert.deepEqual(stats,{positive:323,boundaries:113,withdrawals:47,pending:297});
const install=read('upstream-install.json');assert.equal(install.files.length,61);for(const f of install.files)for(const p of [url('upstream/'+f.path),'D:/Project/xhs-travel-pipeline/'+f.path])assert.equal(sha(p),f.after);
for(const n of ['04','05']){const ref=read(dir+`night-market-reference-${n}.json`);assert.ok(ref.ok&&ref.content.includes('祝舜路555号')&&ref.content.includes('环联1904火车夜市'));}
const ledger=read(dir+'review-38.json'),oldRows=structuredClone(ledger.rows);
assert.deepEqual(ledger.rows.map(r=>[r.entityId,r.name]).sort(),frozen.selected.filter(r=>r.place.city==='济南').map(r=>[r.place.id,r.place.name]).sort());
const row=ledger.rows.find(r=>r.entityId===eid);assert.equal(row.currentRevision,1);assert.equal(row.status,'pending');
Object.assign(row,{currentName:decision.canonicalName,currentEntityId:eid,currentRevision:3,reviewBatch:59,changeBatch:59,status:'reviewed_scope_partial',
  governedSourceIds:[5358],scopeMentionIds:source.groups[0].mentionIds,currentMentionIds:[11571,11607,12647,12825],pendingScopeMentionIds:[11464],
  dimensions:{...row.dimensions,identity:'same_market_relocation_and_rename_full_scope',category:'shopping_market_preserved',location:'published_address_corrected_existing_point_preserved_not_newly_verified',media:'deferred_by_user',consumedFacts:'stale_navigation_mention_pending_three_negative_opinions_preserved'},
  followup:'第59批现名环联1904火车夜市、祝舜路555号已双同步；4条市场观点确认，11464旧门牌/地铁导航整条待审，原正负评价及发表/采集时间保留。原点未新验证，精确位置和媒体继续待核。',
  mediaBoundary:'10个独立来源均eligible=false、无绑定；实际新旧名均null，mock1→0，未看图，不构成媒体验收。',
  reviewEvidence:[...(row.reviewEvidence??[]),dir+'night-market-web-review-02.json',dir+'night-market-source-review-01.json',dir+'night-market-downstream-check-01.json',dir+'night-market-times-check-01.json',consumptionFile]});
for(let i=0;i<ledger.rows.length;i++)if(ledger.rows[i].entityId!==eid)assert.deepEqual(ledger.rows[i],oldRows[i]);
assert.deepEqual(ledger.rows.map(r=>[r.entityId,r.name]),oldRows.map(r=>[r.entityId,r.name]));
assert.equal(ledger.rows.filter(r=>['reviewed_scope_partial','mixed_source_withdrawn_assignment_pending'].includes(r.status)).length,36);assert.equal(ledger.rows.filter(r=>['pending','reviewed_identity_media_location_pending'].includes(r.status)).length,40);assert.equal(ledger.rows.filter(r=>r.status==='reviewed_identity_media_location_pending').length,15);
assert.equal(ledger.summary.governedScopeMentions,432);assert.equal(ledger.summary.wrongPointClearedPositionPending,23);
ledger.createdAt=at;ledger.previousLedger=dir+'review-38.json';Object.assign(ledger.summary,{partiallyReviewedScopeRows:36,governedScopeMentions:437,pendingScopeMentions:117,otherPendingPrimaryRows:40,confirmedNightMarketMentions:4,
  fullyReviewedMeaning:'18原入选行对应16现行主体；第59批市场迁址名称地址及旧导航隔离，精确位置媒体仍待核，完整自查新增0。',
  scopeProgressMeaning:'98行保持：4非地点、18行AI自查、76未完成（36部分scope、40其余，其中15身份事实已查位置媒体待核）；167范围待审及4必去缺口。原3文字发现未应用，市场迁址名称地址/旧导航已处理，精确点位和媒体待核。'});
assert.equal(ledger.summary.fullyReviewed,18);assert.equal(ledger.summary.remainingPrimaryToReview,76);
const progress='第59批环联夜市保留稳定根ID，现名改环联1904火车夜市、地址祝舜路555号，旧名保留为别名。2023迁址更名公告及2025回顾支持同一持续经营市场；原坐标未证明错误则保留待核。完整scope覆盖1源5提及/4全文，4确认/11464旧导航整条待审，3负评及1正评保持，scope1→2、实体2→3，无新建/合并/撤回。旧看点3→1、语料5→4，旧门牌及祝甸站退出当前内容；原始正文、评价、发表/采集时间和raw_json散列保持。228地点/19关系/direct3、revision33，关系内容0变化；隔离SQL、双导入幂等/逆序回滚与正常前置检查通过。107原源/662提及/82全文保持，累计300分配/117待审；2SQL/1真实向量/21边界、实际placeFacts和图库通过。238旧行/129图片字段/9绑定/201行程保持，旧图库3/1/2保持，夜市新旧名null，10独立来源均不eligible，mock1→0、真实入队0。全仓/扩展typecheck通过，61实装文件哈希保持，无生产代码安装。flow61为323正例/113边界/47撤回零失败，audit58为297PENDING。review39仍98行：4非地点、18行AI自查、76未完成（36部分scope、40其余，其中15身份事实已查位置媒体待核），scope提及437、清旧点待定位23，167范围待审及4必去缺口。原3未应用文字发现保持；夜市名称地址及旧导航已处理，精确位置/媒体待核。实体59/元数据01/图片03，无待同步或向量待核；图片暂缓、天地图凭据待轮换、云南和长尾不扩入，未验收不提交归档。';
Object.assign(pointer,{latestAppliedEntityBatch:59,latestFlow:'../all-cities/flow/run-61',latestAudit:'../all-cities/audit/run-58',progressNote:progress,progressUpdatedAt:at,
  latestReviewEvidence:{file:'../'+dir+'night-market-downstream-check-01.json',supplement:'../'+dir+'night-market-source-review-01.json',fullReviewsAdded:0,partiallyReviewed:1,fullReviewsReopened:0}});
pointer.cityReviewLedgers['济南']='../'+dir+'review-39.json';Object.assign(pointer.currentScopeReviews,{addedPendingMentions:117,currentReviewRows:167,meaning:'50固定重点实体对加117提及待审；第59批4确认、11464旧址导航新增待审。原3文字发现未应用，市场精确坐标及媒体待核。'});
pointer.currentScopeReviews.evidence.push('../'+dir+'night-market-source-review-01.json');
pointer.latestReadOnlyFindings.nightMarketRelocationFollowup='../'+dir+'night-market-web-review-02.json';pointer.latestReadOnlyFindings.nightMarketRelocationFollowupStatus='resolved_name_address_and_stale_navigation_batch59_precise_location_media_pending';
pointer.resolvedFindings.push({entityId:eid,name:decision.canonicalName,status:'resolved_relocated_market_name_address_and_stale_navigation_batch59',resolvedByEntityBatch:59,confirmed:4,pending:1,evidence:'../'+dir+'night-market-downstream-check-01.json',fullReviewPassed:false,coordinatesCleared:false,preciseLocationResolved:false});
for(const k of ['unappliedFindings','unappliedMetadataFindings','resolvedMetadataFindings','latestMetadataRefresh','summary','scopeSha256','mapCredentialGate'])assert.deepEqual(pointer[k],before[k]);
task.notes=progress+'见research/'+report+'。';
const prd=fs.readFileSync(url('../prd.md'),'utf8'),continuation=fs.readFileSync(url('nine-cities-continuation-20261007.md'),'utf8');const range=/^- 用户最新明确：\*\*云南不处理，继续其他城市直到验收通过\*\*。[^\n]*$/m;assert.ok(range.test(prd));assert.ok(prd.includes('## 已知事实\n')&&continuation.includes('## 本轮断点\n'));
const nextPrd=prd.replace(range,'- 用户最新明确：**云南不处理，继续其他城市直到验收通过**。九城固定978主体＋56依赖/1135源，167范围待审及4必去缺口。第59批夜市迁址名称地址及旧导航已隔离双同步；济南18行AI自查、76未完成，原3文字发现未应用，夜市精确位置/媒体待核。图片暂缓；天地图凭据待轮换，其余文字继续。云南、89普通长尾和37已隔离错城来源归属不扩入主动范围，未获用户验收。').replace('## 已知事实\n','## 已知事实\n\n### 最新进展：第59批夜市迁址名称与旧导航\n\n'+progress+'见[第59批记录](research/'+report+')。以下为历史快照。\n');
const nextContinuation=continuation.replace('## 本轮断点\n','## 本轮断点\n\n当前以review39为准。'+progress+'下一实体批次60使用flow62/audit59/review40，继续原范围，不重放59。见['+report+']('+report+')。以下为历史断点。\n');
const fresh=new Map([[dir+'review-39.json',json(ledger)],[dir+'review-39.md','# 济南98项重点清单核查台账（第59批）\n\n'+progress+'\n\n| 原名称 | 当前名称 | 版本 | 进度 | 说明 |\n| --- | --- | ---: | --- | --- |\n'+ledger.rows.map(r=>`| ${r.name} | ${r.currentName??r.name} | ${r.currentRevision} | ${r.status} | ${r.followup} |`).join('\n')+'\n'],['cleaning-scope/current-before-batch59.json',json(before)],
  [dir+'night-market-final-verification-01.json',json({batch:59,at,stats,productionCodeInstalled:false,installedManifestHashesVerified:61,isolatedSqlAndExport:true,reverseRollback:true,actualConsumptionTestPassed:true,rootTypecheck:true,extendedTypecheck:true,preflightSucceeded:true,
    frozenMembershipPreserved:{primary:978,dependencies:56,sourceRows:1135},fullReviewsAdded:0,remainingPrimaryToReview:76,partiallyReviewedScopeRows:36,otherPendingPrimaryRows:40,reviewedIdentityMediaLocationPending:15,unappliedSemanticFindings:3,
    confirmed:4,pendingAdded:1,negativeConfirmed:3,positiveConfirmed:1,staleNavigationRemoved:true,coordinatesPreservedNotNewlyVerified:true,publicationAndRawJsonPreserved:true,consumptionFile,postFile,dualFile,imageComparison:'deferred_by_user',mapCredentialStatus:'rotation_required',userAcceptance:false})]]);
for(const p of fresh.keys())assert.ok(!fs.existsSync(url(p)),p+'已存在，不可重放');assert.ok(fs.existsSync(url(report)));
const replace=new Map([['../task.json',json(task)],['../prd.md',nextPrd],['nine-cities-continuation-20261007.md',nextContinuation]]);
for(const kind of ['implement','check']){const p=`../${kind}.jsonl`,entry={file:'.trellis/tasks/10-06-place-identity-governance/research/'+report,reason:'第59批夜市迁址名称地址、旧导航整条待审、三负评保持；review39/flow61/audit58，总300分配/117待审，76未完成；原点与媒体待核，不重放，不看图、未验收不提交归档'};const original=fs.readFileSync(url(p),'utf8');assert.ok(!original.includes(entry.file));replace.set(p,original+JSON.stringify(entry)+'\n');}
for(const [p,value]of fresh)fs.writeFileSync(url(p),value,{flag:'wx'});for(const [p,value]of replace)fs.writeFileSync(url(p),value);fs.writeFileSync(url('cleaning-scope/current.json'),json(pointer));
console.log(JSON.stringify({batch:59,ledger:'review-39',fullyReviewed:18,remaining:76,partialScope:36,otherPending:40,identityMediaLocationPending:15,pendingMentions:117,currentReviewRows:167,unappliedFindings:3,stats}));
