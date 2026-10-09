// 登记已核验的第63批，不提交、不归档、不标记任务完成。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const url=p=>new URL(p,import.meta.url),read=p=>JSON.parse(fs.readFileSync(url(p),'utf8')),json=v=>JSON.stringify(v,null,2)+'\n';
const sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const dir='priority-cities/济南/',folder='all-cities/batch-63/sync-01/',report='batch63-jinan-furong-warning-20261009.md',at=new Date().toISOString();
const unique=(p,re)=>{const names=fs.readdirSync(url(p)).filter(n=>re.test(n));assert.equal(names.length,1);return p+names[0];};
const pointer=read('cleaning-scope/current.json'),before=structuredClone(pointer),task=read('../task.json');
assert.equal(pointer.latestAppliedEntityBatch,62);assert.equal(pointer.cityReviewLedgers['济南'],'../'+dir+'review-42.json');
assert.equal(pointer.userAcceptance,false);assert.equal(task.status,'in_progress');assert.equal(pointer.taskStatus,'in_progress');assert.deepEqual(pointer.pendingVerification,[]);
assert.equal(pointer.latestIndependentPhotoBatch,3);assert.equal(pointer.latestMetadataRefresh.run,1);assert.equal(pointer.imageComparisonPolicy.status,'deferred_by_user');assert.equal(pointer.mapCredentialGate.status,'rotation_required');assert.equal(pointer.unappliedFindings.length,4);
assert.equal(sha(url('cleaning-scope/'+pointer.scopeFile)),pointer.scopeSha256);const frozen=read('cleaning-scope/'+pointer.scopeFile);assert.deepEqual(frozen.summary,pointer.summary);
assert.equal(frozen.selected.length,978);assert.equal(frozen.dependencies.length,56);assert.equal(frozen.sourceIds.length,1135);assert.ok(frozen.selected.every(r=>r.place.city!=='云南'));
const packet=read(dir+'furong-source-packet-01.json'),source=read('all-cities/batch-63-source.json'),scopes=read('all-cities/batch-63-scope-decisions.json'),decisions=read('all-cities/batch-63-decisions.json');
assert.equal(sha(url('all-cities/batch-63-source.json')),'161207196ea38dde4689247e42583111f55db8235f7de3cca75d30b4ffc709e8');
assert.equal(sha(url(dir+'furong-source-packet-01.json')),'551bc2ba76c317db036d84987e8edc57190e9d8d669c135917c6308a42f64b1f');
assert.deepEqual([source.sources.length,source.mentions.length,source.notes.length,packet.noteDetails.length,scopes.length,decisions.length],[1,30,23,24,1,0]);
assert.equal(scopes[0].textWarnings.length,1);assert.equal(scopes[0].assignments.filter(a=>a.entityId===null).length,2);
for(const k of ['preview','applied'])assert.equal(read(`all-cities/batch-63-${k}.json`).changes.length,1);assert.equal(read('all-cities/batch-63-applied.json').apply,true);
const sync=read(folder+'sync-state.json').cities['济南'];assert.ok(sync.importedAt&&sync.relationsImportedAt&&sync.embeddingRunAt);assert.equal(sync.relationSnapshotRevision,37);
assert.equal(sync.exportHash,sha(url(folder+'xhs-places-济南.json')));assert.equal(sync.relationHash,sha(url(folder+'xhs-place-relations-济南.json')));
const consumptionFile=unique(folder,/^furong-consumption-\d+\.json$/),postFile=unique(folder,/^post-import-check-\d+\.json$/),dualFile=unique(folder+'preview-济南/',/^preview-\d+\.json$/);
const actual=read(dir+'furong-downstream-check-01.json'),consumption=read(consumptionFile),pre=read(folder+'pre-import-check.json'),post=read(postFile),vectors=read(folder+'verification-vectors.json');
for(const [k,v]of Object.entries({consumedFieldsVerified:228,assignmentRows:348,pendingMentions:132,scopesAdded:1,confirmed:28,pendingAdded:2,textWarnings:1,coordinatesCleared:0,newPreciseLocations:0,sqlProbes:1,boundaryProbes:16,realVectorProbes:1,graph:18,directEdges:3}))assert.equal(actual[k],v);
assert.ok(actual.validOldOpinionsAndHighlightsPreserved&&actual.allOtherFieldsAndDatesPreserved&&actual.priorReviewRowsPreserved);
assert.equal(vectors.cities[0].vectorProbes.length,1);assert.equal(vectors.cities[0].vectorProbes[0].diagnostics.vector,'used');
assert.ok(consumption.actualPlaceFacts&&consumption.priorGovernedFactsPreserved&&consumption.independentSourceDigestUnchanged&&consumption.validOldOpinionsAndHighlightsPreserved);
assert.deepEqual(consumption.media.map(r=>r.count),[3,1,2]);assert.deepEqual(consumption.mockEnqueueCalls,{before:1,after:0});assert.equal(consumption.actualEnqueues,0);
const media=read(dir+'furong-photo-metadata-01.json'),photoPre=read(dir+'furong-photo-preflight-01.json');assert.equal(media.entities.length,1);assert.ok(media.entities.every(p=>p.independentSources.length===0&&p.assignments.length===0));assert.ok(photoPre.existingPhotoConsumptionPreserved);
assert.equal(pre.mode,'before');assert.equal(pre.cities[0].unchangedSincePreview,true);assert.ok(Date.parse(pre.at)<Date.parse(sync.importedAt));
assert.equal(post.cities[0].oldRowsPreserved,238);assert.equal(post.cities[0].photoFieldsPreserved,156);assert.equal(post.cities[0].independentPhotos,9);assert.deepEqual(post.trips,pre.trips);assert.deepEqual(post.trips,{count:201,digest:'e01d67cbf42a62fc595f4ef052f99e75'});
const isolated=read('all-cities/batch-63/scope-preview-1791501393310418900/report.json'),dual=read(dualFile),delta=read(folder+'preview-济南/relation-delta.json'),upstream=read('all-cities/batch-63-upstream-check.json');
assert.ok(isolated.idempotent&&isolated.reverseRollback&&isolated.originalSourcesAndMentionsUnchanged&&isolated.validOldOpinionsAndHighlightsPreserved&&isolated.sourceDatesAndAnalysisUnchanged);
assert.ok(dual.reverseRollback&&dual.oldRowsPreserved&&dual.photosPreserved);assert.equal(delta.changed.length,1);assert.equal(delta.removed.length,1);
for(const [k,v]of Object.entries({rawSourcesUnchanged:107,originalMentionsUnchanged:662,originalNotesCovered:82,appliedEntitiesVerified:0,appliedScopesVerified:1,assignmentsVerified:30,factExclusionsVerified:1}))assert.equal(upstream[k],v);
const inputs=read(dir+'furong-inputs-check-01.json');assert.equal(inputs.notes,24);assert.equal(inputs.supplementalNotes,1);assert.ok(inputs.publicationAndCollectionTimesPreserved&&inputs.rawJsonHashesPreserved&&inputs.analysisHashesPreserved&&inputs.supplementalSourceStateVerified);
assert.equal(inputs.remainingRelationsPreserved,18);assert.equal(inputs.endpointRevisionsUpdated,1);assert.deepEqual(inputs.relationRemoved.reasons,['ambiguous_text_occurrence']);
const flow=read('all-cities/flow/run-65/report.json'),audit=read('all-cities/audit/run-62/report.json');
for(const r of [actual,consumption,pre,post,isolated,dual,upstream,flow,audit,vectors,inputs,photoPre])assert.deepEqual(r.failures,[]);assert.equal(read('all-cities/flow/run-65/cleanup.json').removed,true);
const stats={positive:flow.cities.reduce((n,c)=>n+c.probes.length,0),boundaries:flow.cities.reduce((n,c)=>n+c.negativeProbes.length,0),withdrawals:flow.cities.reduce((n,c)=>n+c.withdrawalProbes.length,0),pending:audit.cities.reduce((n,c)=>n+(c.statuses.PENDING??0),0)};assert.deepEqual(stats,{positive:326,boundaries:113,withdrawals:52,pending:312});
const logs=[['upstream-stage-place_identity_test_1791500892870.log',/466 passed, 1 deselected/],['upstream-installed-place_identity_test_1791501271824.log',/26 passed/],['downstream-place_identity_test_1791500678090.log',/pass 27/],['downstream-place_identity_test_1791500858727.log',/pass 1/],['downstream-place_identity_test_1791501613411.log',/pass 1/],['upstream-stage-place_identity_test_1791501391986.log',/"reverseRollback": true/]];
for(const [name,pattern]of logs)assert.match(fs.readFileSync(url(name),'utf8'),pattern);
const install=read('upstream-install.json');assert.equal(install.files.length,64);assert.equal(install.files.filter(f=>f.changed).length,9);
for(const f of install.files)for(const p of [url('upstream/'+f.path),'D:/Project/xhs-travel-pipeline/'+f.path])assert.equal(sha(p),f.after);
assert.equal(read('upstream-install-before-note-warning.json').files.length,61);
const migration=read('note-text-warning-migration-1791501270629751100.json');assert.equal(migration.apply,true);assert.equal(migration.dataUnchanged,true);assert.deepEqual(migration.before,migration.after);assert.equal(Object.keys(migration.before).length,12);assert.deepEqual(migration.preview.missingColumns,['place_identity_scope.text_warnings']);assert.deepEqual(migration.repeated.missingColumns,[]);
const ledger=read(dir+'review-42.json'),oldRows=structuredClone(ledger.rows),eid='747792d1b5834255f5feaa6c2dc62925';
assert.deepEqual(ledger.rows.map(r=>[r.entityId,r.name]).sort(),frozen.selected.filter(r=>r.place.city==='济南').map(r=>[r.place.id,r.place.name]).sort());
const row=ledger.rows.find(r=>r.entityId===eid);assert.equal(row.currentRevision,3);assert.equal(row.status,'pending');
Object.assign(row,{currentRevision:4,reviewBatch:63,changeBatch:63,status:'reviewed_scope_partial',
  dimensions:{...row.dimensions,identity:'street_confirmed_unnamed_restaurant_mentions_pending',media:'deferred_by_user',consumedFacts:'independent_30_minutes_valid_opinions_preserved_mixed_tips_removed'},
  governedSourceIds:[5353],scopeMentionIds:packet.groups[0].mentionIds,currentMentionIds:scopes[0].assignments.filter(a=>a.entityId).map(a=>a.mentionId),pendingScopeMentionIds:[12904,12948],
  supplementalTextWarningNoteIds:[2568],
  followup:'第63批完整30提及28确认/2未具名餐馆待审；11699仅排除酒店位置评价。既有分析完整原句警示保留，旧正负评价/4看点和30分钟保持，全城混合tips及博物馆review注记停止消费；文化/other与已纠正点保持。百年小吃街仅为社区来源表述，未新核实年代。媒体仍暂缓。',
  reviewEvidence:[...(row.reviewEvidence??[]),dir+'furong-source-packet-01.json',dir+'furong-source-review-01.json',dir+'furong-inputs-check-01.json',dir+'furong-downstream-check-01.json',consumptionFile]});
for(let i=0;i<ledger.rows.length;i++)if(ledger.rows[i].entityId!==eid)assert.deepEqual(ledger.rows[i],oldRows[i]);
assert.deepEqual(ledger.rows.map(r=>[r.entityId,r.name]),oldRows.map(r=>[r.entityId,r.name]));
assert.equal(ledger.rows.filter(r=>['reviewed_scope_partial','mixed_source_withdrawn_assignment_pending'].includes(r.status)).length,45);
assert.equal(ledger.rows.filter(r=>['pending','reviewed_identity_media_location_pending'].includes(r.status)).length,31);
assert.equal(ledger.rows.filter(r=>r.status==='reviewed_identity_media_location_pending').length,16);
ledger.createdAt=at;ledger.previousLedger=dir+'review-42.json';Object.assign(ledger.summary,{partiallyReviewedScopeRows:45,governedScopeMentions:485,pendingScopeMentions:132,otherPendingPrimaryRows:31,confirmedFurongMentions:28,unappliedSemanticFindings:3,
  fullyReviewedMeaning:'18原入选行对应16现行主体；第63批芙蓉街scope及原文警示保全，完整自查新增0。',
  scopeProgressMeaning:'98行保持：4非地点、18行AI自查、76未完成（45部分scope、31其余，其中16身份事实已查位置媒体待核）；182范围待审及4必去缺口。芙蓉街文字净化已应用，两餐馆归属仍正式待审，原3项图库保全相关文字发现未应用；清点待定位24不变。'});
assert.equal(ledger.summary.fullyReviewed,18);assert.equal(ledger.summary.remainingPrimaryToReview,76);assert.equal(ledger.summary.wrongPointClearedPositionPending,24);
const progress='第63批芙蓉街完整30提及28确认/2未具名餐馆待审，11699排除酒店位置评价字段；原名/ID、文化other、第30批已纠正点与地址、30分钟及旧4看点/5有效语料保持，revision3→4。新增textWarnings保全note2568既有分析完整负面原句，停止混合tips与博物馆闭馆review注记消费，受控语料重建27条。上游64文件中9项实装，12表可空字段迁移旧数据/审计不变；暂存466通过/1实地图明确排除，安装协议26、下游合同27与实际双导入通过。真实24篇资料隔离幂等/逆序回滚、全城双导入和实库1SQL/1真实向量/16边界通过，107原源/662提及/82全文与24篇时间/raw_json/分析散列保持，348累计分配/132待审。228地点/18关系/direct3，共同revision37；note2851原路线位置不明确使1弱关联移除，其余18证据保持、1端点升版。238旧行/156图片字段/9绑定/201行程保持，旧图库3/1/2、芙蓉街null，mock1→0、真实队列0。全仓/扩展typecheck通过，flow65为326正例/113边界/52撤回零失败，audit62为312PENDING。review43仍98行：4非地点18行AI自查76未完成（45部分scope31其余，含16身份事实已查位置媒体待核），scope提及485、清点待定位24；182范围待审/4必去缺口，原3项媒体保全相关文字发现未应用。实体63/元数据01/图片03，无待同步验证；不看图、凭据待轮换、云南长尾不扩入，未验收不提交归档。';
Object.assign(pointer,{latestAppliedEntityBatch:63,latestFlow:'../all-cities/flow/run-65',latestAudit:'../all-cities/audit/run-62',progressNote:progress,progressUpdatedAt:at,
  latestReviewEvidence:{file:'../'+dir+'furong-downstream-check-01.json',supplement:'../'+dir+'furong-source-review-01.json',fullReviewsAdded:0,partiallyReviewed:1,fullReviewsReopened:0}});
pointer.cityReviewLedgers['济南']='../'+dir+'review-43.json';Object.assign(pointer.currentScopeReviews,{addedPendingMentions:132,currentReviewRows:182,meaning:'50固定重点实体对加132提及待审；第63批28确认、2未具名餐馆待审，芙蓉街混合提示治理已应用并保留有效意见。原3项媒体相关文字发现仍未应用。'});
pointer.currentScopeReviews.evidence.push('../'+dir+'furong-source-review-01.json');pointer.latestReadOnlyFindings.furongFollowup='../'+dir+'furong-source-review-01.json';
const finding=pointer.unappliedFindings.find(f=>f.entityId===eid);assert.ok(finding);pointer.unappliedFindings=pointer.unappliedFindings.filter(f=>f.entityId!==eid);assert.deepEqual(pointer.unappliedFindings,before.unappliedFindings.slice(0,3));
pointer.resolvedFindings.push({...finding,status:'resolved_consumption_scope_with_original_text_warning_batch63',resolvedByEntityBatch:63,evidence:'../'+dir+'furong-downstream-check-01.json',reason:'混合提示净化已应用，既有分析作者警示原句保全；两餐馆归属转正式PENDING，未解决具体门店。',confirmed:28,pending:2,fullReviewPassed:false,coordinatesCleared:false,preciseLocationResolved:false});
pointer.latestNoteTextWarningProtocol={entityBatch:63,installedFiles:64,changedFiles:9,migration:'../note-text-warning-migration-1791501270629751100.json',design:'../note-text-warning-design-20261009.md',textWarnings:1};
for(const k of ['unappliedMetadataFindings','resolvedMetadataFindings','latestMetadataRefresh','summary','scopeSha256','mapCredentialGate'])assert.deepEqual(pointer[k],before[k]);task.notes=progress+'见research/'+report+'。';
const prd=fs.readFileSync(url('../prd.md'),'utf8'),continuation=fs.readFileSync(url('nine-cities-continuation-20261007.md'),'utf8');const range=/^- 用户最新明确：\*\*云南不处理，继续其他城市直到验收通过\*\*。[^\n]*$/m;assert.ok(range.test(prd));
const nextPrd=prd.replace(range,'- 用户最新明确：**云南不处理，继续其他城市直到验收通过**。九城固定978主体＋56依赖/1135源，182范围待审及4必去缺口。第63批芙蓉街完整scope与原文警示保全已应用，28确认/2餐馆待审，旧意见和30分钟保持。济南18行AI自查、76未完成，3项媒体相关文字发现未应用。图片暂缓；天地图凭据待轮换，云南和普通长尾不扩入，未获用户验收。').replace('## 已知事实\n','## 已知事实\n\n### 最新进展：第63批芙蓉街原文警示\n\n'+progress+'见[第63批记录](research/'+report+')。以下为历史快照。\n');
const nextContinuation=continuation.replace('## 本轮断点\n','## 本轮断点\n\n当前以review43为准。'+progress+'下一实体批次64使用flow66/audit63/review44，不重放63。见['+report+']('+report+')。以下为历史断点。\n');
const quality={batch:63,at,stats,productionCodeInstalled:true,installedManifestHashesVerified:64,changedUpstreamFiles:9,migrationTablesPreserved:12,
  stagedTestsPassed:466,stagedLiveMapTestsDeselected:1,installedProtocolTestsPassed:26,downstreamRelationTestsPassed:27,warningDualImportTestsPassed:1,
  isolatedSqlAndExport:true,reverseRollback:true,actualConsumptionTestPassed:true,rootTypecheck:true,extendedTypecheck:true,preflightSucceeded:true,
  frozenMembershipPreserved:{primary:978,dependencies:56,sourceRows:1135},fullReviewsAdded:0,remainingPrimaryToReview:76,partiallyReviewedScopeRows:45,
  otherPendingPrimaryRows:31,reviewedIdentityMediaLocationPending:16,unappliedSemanticFindings:3,confirmed:28,pendingAdded:2,textWarnings:1,
  publicationAndRawJsonAndAnalysisPreserved:true,validOldOpinionsAndHighlightsPreserved:true,consumptionFile,postFile,dualFile,
  imageComparison:'deferred_by_user',mapCredentialStatus:'rotation_required',userAcceptance:false,failures:[]};
const fresh=new Map([[dir+'review-43.json',json(ledger)],[dir+'review-43.md','# 济南98项重点清单核查台账（第63批）\n\n'+progress+'\n\n| 原名称 | 当前名称 | 版本 | 进度 | 说明 |\n| --- | --- | ---: | --- | --- |\n'+ledger.rows.map(r=>`| ${r.name} | ${r.currentName??r.name} | ${r.currentRevision} | ${r.status} | ${r.followup} |`).join('\n')+'\n'],['cleaning-scope/current-before-batch63.json',json(before)],[dir+'furong-final-verification-01.json',json(quality)]]);
for(const p of fresh.keys())assert.ok(!fs.existsSync(url(p)),p+'已存在，不可重放');assert.ok(fs.existsSync(url(report)));
assert.ok(fs.readFileSync(new URL('../../../spec/server/backend/place-identity.md',import.meta.url),'utf8').includes('## 52.'));
const replace=new Map([['../task.json',json(task)],['../prd.md',nextPrd],['nine-cities-continuation-20261007.md',nextContinuation]]);
for(const kind of ['implement','check']){const p=`../${kind}.jsonl`,entry={file:'.trellis/tasks/10-06-place-identity-governance/research/'+report,reason:'第63批芙蓉街scope、既有分析原文警示保全和可逆来源协议；review43/flow65/audit62，348分配/132待审、76未完成，不重放，不看图，未验收不提交归档'};const original=fs.readFileSync(url(p),'utf8');assert.ok(!original.includes(entry.file));replace.set(p,original+JSON.stringify(entry)+'\n');}
for(const [p,value]of fresh)fs.writeFileSync(url(p),value,{flag:'wx'});for(const [p,value]of replace)fs.writeFileSync(url(p),value);fs.writeFileSync(url('cleaning-scope/current.json'),json(pointer));
console.log(JSON.stringify({batch:63,ledger:'review-43',fullyReviewed:18,remaining:76,partialScope:45,otherPending:31,identityMediaLocationPending:16,pendingMentions:132,currentReviewRows:182,unappliedFindings:3,stats}));
