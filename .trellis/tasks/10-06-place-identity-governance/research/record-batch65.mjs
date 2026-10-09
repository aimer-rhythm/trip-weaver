// 仅更新已验证工作记录，不提交、不归档、不标记验收或任务完成；禁止重放。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const url=p=>new URL(p,import.meta.url),read=p=>JSON.parse(fs.readFileSync(url(p),'utf8')),json=v=>JSON.stringify(v,null,2)+'\n';
const sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const dir='priority-cities/济南/',folder='all-cities/batch-65/sync-01/',reportFile='batch65-jinan-bridge-gate-20261009.md',at=new Date().toISOString();
const unique=(p,re)=>{const files=fs.readdirSync(url(p)).filter(n=>re.test(n));assert.equal(files.length,1);return p+files[0];};
const pointer=read('cleaning-scope/current.json'),before=structuredClone(pointer),task=read('../task.json');
assert.equal(pointer.latestAppliedEntityBatch,64);assert.equal(pointer.cityReviewLedgers['济南'],'../'+dir+'review-44.json');
assert.equal(pointer.userAcceptance,false);assert.equal(task.status,'in_progress');assert.equal(pointer.taskStatus,'in_progress');assert.deepEqual(pointer.pendingVerification,[]);
assert.equal(pointer.latestIndependentPhotoBatch,3);assert.equal(pointer.latestMetadataRefresh.run,1);assert.equal(pointer.imageComparisonPolicy.status,'deferred_by_user');assert.equal(pointer.mapCredentialGate.status,'rotation_required');assert.equal(pointer.unappliedFindings.length,3);
assert.equal(sha(url('cleaning-scope/'+pointer.scopeFile)),pointer.scopeSha256);const frozen=read('cleaning-scope/'+pointer.scopeFile);assert.deepEqual(frozen.summary,pointer.summary);
assert.deepEqual([frozen.selected.length,frozen.dependencies.length,frozen.sourceIds.length],[978,56,1135]);assert.ok(frozen.selected.every(r=>r.place.city!=='云南'));
const source=read('all-cities/batch-65-source.json'),scopes=read('all-cities/batch-65-scope-decisions.json'),decisions=read('all-cities/batch-65-decisions.json');
assert.equal(sha(url('all-cities/batch-65-source.json')),'ce6f15d58a65edea700548c0cc8d2da477147dcbe1a5f6bdb23c4eea1b02bd4f');
assert.equal(sha(url(dir+'bridge-text-source-packet-01.json')),'67c7c3a145a9e23e72e39a2818f29e984b2bff7f3dd0290b30832589d4c048f3');
assert.deepEqual([source.sources.length,source.mentions.length,source.noteDetails.length,scopes.length,decisions.length],[2,9,6,1,1]);
const gateId='fd7c5d9a0af5a1ec9515743d6f05bce5',gateName='起凤桥八号门洞';
assert.deepEqual(scopes[0].assignments.map(a=>[a.mentionId,a.entityId]),[[11458,gateId],[12724,gateId]]);
assert.equal(decisions[0].canonicalName,gateName);assert.deepEqual(decisions[0].aliases,[gateName]);assert.deepEqual(decisions[0].excludeNames,['起凤桥八号']);
for(const k of ['preview','applied'])assert.equal(read(`all-cities/batch-65-${k}.json`).changes.length,2);assert.equal(read('all-cities/batch-65-applied.json').apply,true);
const sync=read(folder+'sync-state.json').cities['济南'];assert.ok(sync.importedAt&&sync.relationsImportedAt&&sync.embeddingRunAt);assert.equal(sync.relationSnapshotRevision,39);
assert.equal(sync.exportHash,sha(url(folder+'xhs-places-济南.json')));assert.equal(sync.relationHash,sha(url(folder+'xhs-place-relations-济南.json')));
assert.equal(sync.exportHash,'6caed01e9a66fc92fd2b70c4fa71fc05d53b6aaf142f00d4e40732b7f6b9aafc');assert.equal(sync.relationHash,'eada610cd26dd7b52a3d4be7f6f5587d6fb5a2d1bdda3e27ba6fa24330c71115');
const consumptionFile=unique(folder,/^bridge-text-consumption-\d+\.json$/),postFile=unique(folder,/^post-import-check-\d+\.json$/),dualFile=unique(folder+'preview-济南/',/^preview-\d+\.json$/);
const actual=read(dir+'bridge-text-downstream-check-01.json'),consumption=read(consumptionFile),pre=read(folder+'pre-import-check.json'),post=read(postFile),vectors=read(folder+'verification-vectors.json');
for(const [k,v]of Object.entries({consumedFieldsVerified:228,assignmentRows:358,pendingMentions:133,scopesAdded:1,confirmed:2,pendingAdded:0,readOnlySources:1,coordinatesCleared:0,newPreciseLocations:0,sqlProbes:2,boundaryProbes:35,foodExclusionProbes:2,realVectorProbes:2,graph:18,directEdges:3}))assert.equal(actual[k],v);
assert.ok(actual.validOldOpinionsAndHighlightsPreserved&&actual.allOtherFieldsAndDatesPreserved&&actual.priorReviewRowsPreserved);
assert.equal(vectors.cities[0].vectorProbes.length,2);assert.ok(vectors.cities[0].vectorProbes.every(p=>p.diagnostics.vector==='used'));
assert.ok(consumption.actualPlaceFacts&&consumption.priorGovernedFactsPreserved&&consumption.independentSourceDigestUnchanged);assert.equal(consumption.gateMinutes,30);
assert.deepEqual(consumption.media.map(r=>r.count),[3,1,2]);assert.deepEqual(consumption.mockEnqueueCalls,{before:2,after:1});assert.equal(consumption.actualEnqueues,0);
assert.deepEqual(consumption.excludedNameProbe,{name:'起凤桥八号',resolvedToGate:false,photos:null,mockEnqueueCalls:1});assert.equal(consumption.totalAfterMockEnqueues,2);
const photo=read(dir+'bridge-text-photo-metadata-01.json'),photoPre=read(dir+'bridge-text-photo-preflight-01.json');assert.equal(photo.entities.length,2);assert.ok(photo.entities.every(p=>p.independentSources.length===0&&p.assignments.length===0));assert.ok(photoPre.existingPhotoConsumptionPreserved);
assert.equal(pre.mode,'before');assert.equal(pre.cities[0].unchangedSincePreview,true);assert.ok(Date.parse(pre.at)<Date.parse(sync.importedAt));
assert.equal(post.cities[0].oldRowsPreserved,238);assert.equal(post.cities[0].photoFieldsPreserved,168);assert.equal(post.cities[0].independentPhotos,9);assert.deepEqual(post.trips,pre.trips);assert.deepEqual(post.trips,{count:201,digest:'e01d67cbf42a62fc595f4ef052f99e75'});
const isolatedFile='all-cities/batch-65/scope-preview-1791503650601204800/report.json',isolated=read(isolatedFile),dual=read(dualFile),delta=read(folder+'preview-济南/relation-delta.json'),upstream=read('all-cities/batch-65-upstream-check.json');
assert.ok(isolated.idempotent&&isolated.reverseRollback&&isolated.originalSourcesAndMentionsUnchanged&&isolated.confirmedOpinionsAndDatesPreserved&&isolated.sourceDatesAndAnalysisUnchanged&&isolated.readOnlyBridgePreserved);
assert.deepEqual(isolated.results.map(r=>[r.highlightsBefore,r.highlightsAfter,r.evidenceBefore,r.evidenceAfter]),[[1,1,2,2]]);
assert.ok(dual.reverseRollback&&dual.oldRowsPreserved&&dual.photosPreserved);assert.equal(delta.changed.length,0);assert.equal(delta.removed.length,0);
for(const [k,v]of Object.entries({rawSourcesUnchanged:107,originalMentionsUnchanged:662,originalNotesCovered:82,appliedEntitiesVerified:1,appliedScopesVerified:1,assignmentsVerified:2,factExclusionsVerified:0}))assert.equal(upstream[k],v);
const inputs=read(dir+'bridge-text-inputs-check-01.json');assert.equal(inputs.notes,6);assert.equal(inputs.notesWithExistingAnalysis,5);assert.deepEqual(inputs.nullAnalysisNotes,[2813]);
assert.ok(inputs.publicationAndCollectionTimesPreserved&&inputs.rawJsonHashesPreserved&&inputs.analysisHashesAndNullPreserved&&inputs.supplementalWarningSourcePreserved&&inputs.readOnlyBridgePreserved);assert.equal(inputs.remainingRelationsPreserved,18);assert.equal(inputs.relationChanges,0);
const flow=read('all-cities/flow/run-67/report.json'),audit=read('all-cities/audit/run-64/report.json');
for(const r of [actual,consumption,pre,post,isolated,dual,upstream,flow,audit,vectors,inputs,photoPre])assert.deepEqual(r.failures,[]);assert.equal(read('all-cities/flow/run-67/cleanup.json').removed,true);
const stats={positive:flow.cities.reduce((n,c)=>n+c.probes.length,0),boundaries:flow.cities.reduce((n,c)=>n+c.negativeProbes.length,0),withdrawals:flow.cities.reduce((n,c)=>n+c.withdrawalProbes.length,0),pending:audit.cities.reduce((n,c)=>n+(c.statuses.PENDING??0),0)};assert.deepEqual(stats,{positive:330,boundaries:113,withdrawals:52,pending:313});
for(const [name,pattern]of [['downstream-place_identity_test_1791503407454.log',/pass 1/],['downstream-place_identity_test_1791504008206.log',/pass 1/],['upstream-stage-place_identity_test_1791503648809.log',/"reverseRollback": true/]])assert.match(fs.readFileSync(url(name),'utf8'),pattern);
assert.match(fs.readFileSync(url('downstream-place_identity_test_1791503922552.log'),'utf8'),/2 !== 1/);
const install=read('upstream-install.json');assert.equal(install.files.length,64);for(const f of install.files)for(const p of [url('upstream/'+f.path),'D:/Project/xhs-travel-pipeline/'+f.path])assert.equal(sha(p),f.after);
const ledger=read(dir+'review-44.json'),oldRows=structuredClone(ledger.rows),targetIds=source.groups.map(g=>g.entity.entity_id);
assert.deepEqual(ledger.rows.map(r=>[r.entityId,r.name]).sort(),frozen.selected.filter(r=>r.place.city==='济南').map(r=>[r.place.id,r.place.name]).sort());
for(const g of source.groups) {
  const eid=g.entity.entity_id,sid=g.entity.primary_place_id,row=ledger.rows.find(r=>r.entityId===eid);assert.equal(row.currentRevision,1);assert.equal(row.status,'pending');
  row.textReviewBatch=65;row.reviewEvidence=[...(row.reviewEvidence??[]),dir+'bridge-text-source-packet-01.json',dir+'bridge-text-source-review-01.json',dir+'bridge-text-inputs-check-01.json',dir+'bridge-text-downstream-check-01.json',consumptionFile];
  if(eid!==gateId) {
    row.followup='第65批只读复核7提及及完整正文：导航到八号不足以证明桥体、门洞、院落同体。保留原名/ID/revision1/旧街道参考点及4条原语料（含人多改拍西侧灯笼亭子警示），历史review375保持；桥体归属、精确位置及媒体仍待核，本轮未看图。';
    continue;
  }
  Object.assign(row,{currentRevision:3,currentName:gateName,reviewBatch:65,changeBatch:65,status:'reviewed_scope_partial',
    dimensions:{...row.dimensions,identity:'explicit_gate_photography_confirmed_bare_venue_name_excluded',category:'culture_photo_spot_confirmed',location:'old_point_preserved_not_newly_verified',media:'deferred_by_user',consumedFacts:'original_opinions_dates_and_single_30_minute_sample_preserved'},
    governedSourceIds:[sid],scopeMentionIds:g.mentionIds,currentMentionIds:[11458,12724],pendingScopeMentionIds:[],
    followup:'第65批依据原文门洞摄影，将现有主体限定为起凤桥八号门洞；完整2分配均确认，同篇30分钟只算1样本，1看点/日期和2条不同理由保持。旧裸名排除，不合并起凤桥、餐厅、院落或亭子。原地址/点未新验证；新主名无图并阻止回退，旧裸名直接请求另走未知名称普通回退。媒体暂缓，仍为部分核查。'});
}
for(let i=0;i<ledger.rows.length;i++)if(!targetIds.includes(ledger.rows[i].entityId))assert.deepEqual(ledger.rows[i],oldRows[i]);
assert.deepEqual(ledger.rows.map(r=>[r.entityId,r.name]),oldRows.map(r=>[r.entityId,r.name]));
assert.equal(ledger.rows.filter(r=>['reviewed_scope_partial','mixed_source_withdrawn_assignment_pending'].includes(r.status)).length,49);
assert.equal(ledger.rows.filter(r=>['pending','reviewed_identity_media_location_pending'].includes(r.status)).length,27);assert.equal(ledger.rows.filter(r=>r.status==='reviewed_identity_media_location_pending').length,16);
ledger.createdAt=at;ledger.previousLedger=dir+'review-44.json';Object.assign(ledger.summary,{partiallyReviewedScopeRows:49,governedScopeMentions:495,pendingScopeMentions:133,otherPendingPrimaryRows:27,wrongPointClearedPositionPending:25,confirmedGateMentions:2,
  fullyReviewedMeaning:'18原入选行对应16现行主体；第65批八号门洞部分scope、起凤桥只读待核，完整自查新增0。',
  scopeProgressMeaning:'98行保持：4非地点、18行AI自查、76未完成（49部分scope、27其余，其中16身份事实已查位置媒体待核）；183范围待审及4必去缺口。门洞原文两提及归属明确，桥体边界、精确位置及媒体仍待核；清点待定位25，原3项图库保全相关文字发现仍未应用。'});
assert.equal(ledger.summary.fullyReviewed,18);assert.equal(ledger.summary.remainingPrimaryToReview,76);
const progress='第65批桥与八号2源9提及/6全文复核：起凤桥八号限定为起凤桥八号门洞，1源完整scope/2确认、原ID保持、revision1→3，新名唯一别名，旧裸名排除。原文14:30–15:00为同篇一个30分钟样本，1看点/日期及2条不同理由保留；旧地址/点未新验证，不新建、不合并、不撤回。起凤桥7提及及原正负意见只读保持，导航八号不等于桥体/门洞同体，review375不变。107原源/662提及/82全文及本批6篇日期/raw_json/分析形态保持，累计358分配/133待审。228地点/18关系/direct3及芙蓉街警示来源保持，共同revision39；隔离幂等/倒序回滚、全城双导入、2SQL/2真实向量/35边界/2餐饮排除及实际placeFacts通过。238旧行/168旧图片字段/9绑定/201行程保持，旧图库3/1/2、桥与门洞null；当前主名mock2→1，旧裸名直接请求另1次普通回退，总2次，真实队列0。全仓与扩展typecheck通过，flow67为330正例/113边界/52撤回零失败，audit64为313PENDING。review45仍98行：4非地点18行AI自查76未完成（49部分scope27其余，含16身份事实已查位置媒体待核），scope提及495、清点待定位25；183范围待审/4必去缺口，原3项媒体相关文字发现未应用。实体65/元数据01/图片03，无待同步验证；不看图、凭据待轮换、云南长尾不扩入，未验收不提交归档。';
Object.assign(pointer,{latestAppliedEntityBatch:65,latestFlow:'../all-cities/flow/run-67',latestAudit:'../all-cities/audit/run-64',progressNote:progress,progressUpdatedAt:at,
  latestReviewEvidence:{file:'../'+dir+'bridge-text-downstream-check-01.json',supplement:'../'+dir+'bridge-text-source-review-01.json',fullReviewsAdded:0,partiallyReviewed:1,readOnlyPending:1,fullReviewsReopened:0}});
pointer.cityReviewLedgers['济南']='../'+dir+'review-45.json';Object.assign(pointer.currentScopeReviews,{addedPendingMentions:133,currentReviewRows:183,meaning:'50固定重点实体对加133提及待审；第65批门洞2确认、0新增待审，起凤桥边界只读待核。原3项媒体相关文字发现未应用。'});
pointer.currentScopeReviews.evidence.push('../'+dir+'bridge-text-source-review-01.json');pointer.latestReadOnlyFindings.bridgeTextFollowup='../'+dir+'bridge-text-source-review-01.json';
pointer.resolvedFindings.push({entityId:gateId,name:gateName,status:'resolved_explicit_gate_scope_batch65',resolvedByEntityBatch:65,evidence:'../'+dir+'bridge-text-downstream-check-01.json',confirmed:2,pending:0,fullReviewPassed:false,coordinatesCleared:false,preciseLocationResolved:false,bareVenueNameExcluded:true});
for(const k of ['unappliedFindings','unappliedMetadataFindings','resolvedMetadataFindings','latestMetadataRefresh','latestNoteTextWarningProtocol','summary','scopeSha256','mapCredentialGate'])assert.deepEqual(pointer[k],before[k]);task.notes=progress+'见research/'+reportFile+'。';
const report=`# 第65批：起凤桥八号门洞的主体限定\n\n${progress}\n\n## 实际改动\n\n| 原主体 | 当前消费 | 仍待核 |\n| --- | --- | --- |\n| 起凤桥八号 | 起凤桥八号门洞；2确认、同篇1个30分钟样本，旧ID保持，裸名排除 | 原地址和点未新验证，媒体暂缓；不代表餐厅或整个院落 |\n| 起凤桥 | 原名、revision1、7条提及和4条语料保持 | 桥体、门洞、院落之间边界；导航参照不作身份合并 |\n\n## 证据边界\n\n[逐提及核查](${dir}bridge-text-source-review-01.json)绑定6篇完整正文和原字段指纹。note2570独立时段“14:30–15:00 起凤桥八号”紧接“古香古色的门洞”，支持摄影主体和30分钟；两次抽取不成为两份独立来源。起凤桥原文“人多，可改拍西侧灯笼亭子”的意见完整保留，亭子不并入门洞。\n\n[历史公开食记](https://www.instagram.com/p/B8zl2GuBvgS)成功抓取的文字有“起凤桥8号”及融合菜、餐厅等用法，仅支持裸名歧义；2020页面标注不证明2026经营状态、院落连续性或精确位置。未查看该页图片。百科方位/跨城桥梁混杂，具体片名与坐标不采用；search02泛化主回答弃用，search03/04超时终态保留，不重复检索充当证据。\n\n## 验证与保全\n\n[真实隔离验证](${isolatedFile})覆盖2源9提及/6全文、幂等和倒序回滚。门洞1看点/日期与2条不同reason语料保持，桥原消费及历史review375保持。[实库字段](${dir}bridge-text-downstream-check-01.json)核对228条导出与358累计分配，2SQL/2真实向量、35名称及ID边界和2餐饮排除均通过；新旧ID不能将旧裸名解析为门洞。[输入核对](${dir}bridge-text-inputs-check-01.json)证明6篇发表/采集日期、raw_json及分析形态未改，2813原null保持。\n\n[全城双导入](${dualFile})及其逆序回滚通过；正式导入前已正常执行before检查。18关系及direct3、芙蓉街警示来源保持，共同revision39。238旧行、168旧图片字段、9绑定、201行程保持；168比上批159多9个历史空字段，不代表新增照片。\n\n[实际消费](${consumptionFile})验证placeFacts仅以新门洞名取值、旧裸名键缺席，30分钟保持。旧图库3/1/2返回及摘要不变，两主体无图。规范名路径mock2→1，仅桥保留普通补图回退；旧裸名不再是scope引用，额外直接请求另触发1次未知名称回退，总2次，真实队列0。本批不修改生产图片协议，不能宣称所有旧名入口均禁止补图。首次消费测试误把新旧入口回调混计为1而失败，保留日志downstream-place_identity_test_1791503922552.log；修订为逐名称断言后通过，成功日志downstream-place_identity_test_1791504008206.log。\n\n全仓及扩展typecheck通过；[flow67](all-cities/flow/run-67/report.json)为330正例/113边界/52撤回零失败，临时库清理完成。[audit64](all-cities/audit/run-64/report.json)仍313PENDING，本批未改变历史审核。全城市回归包括已有云南等数据的只读基线，不扩入主动清洗范围。64个上游已安装文件与暂存散列一致，本批没有生产协议改动。\n\n## 当前断点\n\nreview45、实体65、flow67、audit64；下一批66使用flow68/audit65/review46，不重放65。九城固定978主体＋56依赖/1135源不变，济南仍76行未完成，完整自查新增0。原3项媒体相关文字发现未应用，图片暂缓、地图凭据待轮换，未获用户验收，不提交、不归档、不标记任务完成。\n\n来源SHA：${sha(url('all-cities/batch-65-source.json'))}。导出SHA：${sync.exportHash}。关系SHA：${sync.relationHash}。\n`;
const quality={batch:65,at,stats,installedManifestHashesVerified:64,productionCodeChanged:false,isolatedSqlAndExport:true,reverseRollback:true,actualConsumptionTestPassed:true,rootTypecheck:true,extendedTypecheck:true,
  frozenMembershipPreserved:{primary:978,dependencies:56,sourceRows:1135},fullReviewsAdded:0,remainingPrimaryToReview:76,partiallyReviewedScopeRows:49,otherPendingPrimaryRows:27,reviewedIdentityMediaLocationPending:16,
  unappliedSemanticFindings:3,confirmed:2,pendingAdded:0,readOnlySources:1,publicationAndRawJsonAndAnalysisPreserved:true,consumptionFile,postFile,dualFile,
  mediaMockEnqueues:{currentNamesBefore:2,currentNamesAfter:1,excludedBareNameExtra:1,totalAfter:2,realEnqueues:0},
  imageComparison:'deferred_by_user',mapCredentialStatus:'rotation_required',userAcceptance:false,failures:[]};
const prd=fs.readFileSync(url('../prd.md'),'utf8'),continuation=fs.readFileSync(url('nine-cities-continuation-20261007.md'),'utf8');const range=/^- 用户最新明确：\*\*云南不处理，继续其他城市直到验收通过\*\*。[^\n]*$/m;assert.ok(range.test(prd));
const nextPrd=prd.replace(range,'- 用户最新明确：**云南不处理，继续其他城市直到验收通过**。九城固定978主体＋56依赖/1135源，183范围待审及4必去缺口。第65批八号门洞限定与完整scope已应用，2确认/0新增待审，起凤桥边界只读待核。济南18行AI自查、76未完成，3项媒体相关文字发现未应用。图片暂缓；天地图凭据待轮换，云南和普通长尾不扩入，未获用户验收。').replace('## 已知事实\n','## 已知事实\n\n### 最新进展：第65批门洞主体限定\n\n'+progress+'见[第65批记录](research/'+reportFile+')。以下为历史快照。\n');
const nextContinuation=continuation.replace('## 本轮断点\n','## 本轮断点\n\n当前以review45为准。'+progress+'下一实体批次66使用flow68/audit65/review46，不重放65。见['+reportFile+']('+reportFile+')。以下为历史断点。\n');
const fresh=new Map([[reportFile,report],[dir+'review-45.json',json(ledger)],[dir+'review-45.md','# 济南98项重点清单核查台账（第65批）\n\n'+progress+'\n\n| 原名称 | 当前名称 | 版本 | 进度 | 说明 |\n| --- | --- | ---: | --- | --- |\n'+ledger.rows.map(r=>`| ${r.name} | ${r.currentName??r.name} | ${r.currentRevision} | ${r.status} | ${r.followup} |`).join('\n')+'\n'],['cleaning-scope/current-before-batch65.json',json(before)],[dir+'bridge-text-final-verification-01.json',json(quality)]]);
for(const p of fresh.keys())assert.ok(!fs.existsSync(url(p)),p+'已存在，不可重放');
assert.ok(fs.readFileSync(new URL('../../../spec/server/backend/place-identity.md',import.meta.url),'utf8').includes('## 54.'));
const replacements=new Map([['../task.json',json(task)],['../prd.md',nextPrd],['nine-cities-continuation-20261007.md',nextContinuation]]);
for(const kind of ['implement','check']){const p=`../${kind}.jsonl`,entry={file:'.trellis/tasks/10-06-place-identity-governance/research/'+reportFile,reason:'第65批门洞主体限定及完整scope，桥体只读待核；review45/flow67/audit64，358分配/133待审、76未完成，新旧媒体入口分别核验，不重放、不看图、未验收不提交归档'};const original=fs.readFileSync(url(p),'utf8');assert.ok(!original.includes(entry.file));replacements.set(p,original+JSON.stringify(entry)+'\n');}
for(const [p,value]of fresh)fs.writeFileSync(url(p),value,{flag:'wx'});for(const [p,value]of replacements)fs.writeFileSync(url(p),value);fs.writeFileSync(url('cleaning-scope/current.json'),json(pointer));
console.log(JSON.stringify({batch:65,ledger:'review-45',fullyReviewed:18,remaining:76,partialScope:49,otherPending:27,identityMediaLocationPending:16,pendingMentions:133,currentReviewRows:183,unappliedFindings:3,stats}));
