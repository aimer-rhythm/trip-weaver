// 只登记已应用且核验通过的第69批；禁止重放，不提交、不归档、不标记任务完成。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const url=p=>new URL(p,import.meta.url),read=p=>JSON.parse(fs.readFileSync(url(p),'utf8')),json=v=>JSON.stringify(v,null,2)+'\n';
const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const dir='priority-cities/成都/',folder='all-cities/batch-69/sync-01/',reportFile='batch69-chengdu-heming-warning-20261009.md',at=new Date().toISOString();
const teaId='726ded184fe71d5b6ad1642e0e60d3f1';
const pointer=read('cleaning-scope/current.json'),before=read('cleaning-scope/current-before-batch69.json'),task=read('../task.json');
assert.equal(before.latestAppliedEntityBatch,68);assert.deepEqual(before.pendingVerification,[]);assert.equal(pointer.latestAppliedEntityBatch,69);
assert.deepEqual(pointer.pendingVerification,[{entityBatch:69,stage:'applied_sync_and_final_verification_pending',evidence:'../all-cities/batch-69-applied.json'}]);
assert.equal(pointer.userAcceptance,false);assert.equal(task.status,'in_progress');assert.equal(pointer.taskStatus,'in_progress');
assert.equal(pointer.imageComparisonPolicy.status,'deferred_by_user');assert.equal(pointer.mapCredentialGate.status,'rotation_required');
assert.equal(pointer.cityReviewLedgers['成都'],'../'+dir+'review-04.json');assert.equal(pointer.cityReviewLedgers['济南'],'../priority-cities/济南/review-45.json');
const frozen=read('cleaning-scope/'+pointer.scopeFile);assert.equal(hash(url('cleaning-scope/'+pointer.scopeFile)),pointer.scopeSha256);
assert.deepEqual([frozen.selected.length,frozen.dependencies.length,frozen.sourceIds.length],[978,56,1135]);assert.ok(frozen.selected.every(r=>r.place.city!=='云南'));
const source=read('all-cities/batch-69-source.json'),scope=read('all-cities/batch-69-scope-decisions.json');
assert.equal(hash(url('all-cities/batch-69-source.json')),'f9abeac290488dee00a921daea645ff59646c8b07c86008f7c8a5058bd132861');
assert.deepEqual([source.sources.length,source.mentions.length,source.noteDetails.length],[1,6,6]);
assert.deepEqual(read('all-cities/batch-69-decisions.json'),[]);assert.equal(scope.length,1);assert.equal(scope[0].sourcePlaceId,1847);
assert.equal(scope[0].assignments.length,6);assert.ok(scope[0].assignments.every(a=>a.entityId===teaId));
assert.equal(scope[0].textWarnings.length,1);assert.equal(scope[0].textWarnings[0].quote,'可以不去\n鹤鸣茶社');
for(const kind of ['preview','applied'])assert.equal(read(`all-cities/batch-69-${kind}.json`).changes.length,1);
assert.equal(read('all-cities/batch-69-applied.json').apply,true);
const sync=read(folder+'sync-state.json').cities['成都'];assert.ok(sync.importedAt&&sync.relationsImportedAt&&sync.embeddingRunAt);assert.equal(sync.relationSnapshotRevision,9);
assert.equal(sync.exportHash,hash(url(folder+'xhs-places-成都.json')));assert.equal(sync.relationHash,hash(url(folder+'xhs-place-relations-成都.json')));
assert.equal(sync.exportHash,'8e5fa73f7f26435591fae31163bd8d87908d0eb75c59f5407e2f5d1479fda880');
assert.equal(sync.relationHash,'9a7316a485a5fcdb35475bf5d6efefc847f6a1ebd7f60ecc804a8539a83772aa');
assert.equal(read(folder+'xhs-places-成都.json').places.length,392);
const consumptionFile=folder+'heming-consumption-1791509124287.json',postFile=folder+'post-import-check-1791509134557.json',dualFile=folder+'preview-成都/preview-1791508997836.json';
const isolatedFile='all-cities/batch-69/scope-preview-1791508905691570400/report.json';
const protocolFile='note-warning-preview-1791508576352/multiline/downstream-verification-1791508640784.json';
const actual=read(dir+'heming-downstream-check-01.json'),inputs=read(dir+'heming-inputs-check-01.json'),consumption=read(consumptionFile),post=read(postFile),dual=read(dualFile),isolated=read(isolatedFile);
const vectors=read(folder+'verification-vectors.json'),upstream=read('all-cities/batch-69-upstream-check.json'),pre=read(folder+'pre-import-check.json'),delta=read(folder+'preview-成都/relation-delta.json');
const flow=read('all-cities/flow/run-71/report.json'),audit=read('all-cities/audit/run-68/report.json'),protocol=read(protocolFile);
for(const r of [actual,inputs,consumption,post,dual,isolated,vectors,upstream,pre,flow,audit,protocol])assert.deepEqual(r.failures,[]);
for(const [k,v]of Object.entries({consumedFieldsVerified:392,sqlProbes:2,boundaryProbes:14,realVectorProbes:1,confirmed:6,textWarnings:1,originalHighlightsAndDates:4,oldEvidencePreserved:5,currentEvidence:7,originalNegativeOpinionsPreserved:2,graph:49,directEdges:15,pendingAdded:0,coordinatesCleared:0,preciseLocationsResolved:0}))assert.equal(actual[k],v);
for(const k of ['multilineOriginalOpinionPreserved','allOtherPlacesPreserved','parentWebProfilePreserved','relationContentPreserved','oldReviewsPreserved'])assert.equal(actual[k],true);
assert.equal(actual.fullReviewPassed,false);
assert.ok(consumption.actualPlaceFacts&&consumption.allOtherFactsPreserved&&consumption.allOldMediaReturnsPreserved);
assert.equal(consumption.correctedNameKeys,2);assert.equal(consumption.oldCanonicalMediaProbes,372);assert.equal(consumption.nonEmptyOldMedia.length,11);assert.ok(consumption.nonEmptyOldMedia.every(p=>p.count===1));
assert.deepEqual(consumption.oldNameMockEnqueues,{before:359,after:358});assert.equal(consumption.actualEnqueues,0);
assert.deepEqual(consumption.targetFactMedia,[{name:'人民公园',galleryCount:1,hasCover:true,actualLookupPhotos:0},{name:'鹤鸣茶社',galleryCount:0,hasCover:false,actualLookupPhotos:0}]);
assert.equal(inputs.rawAndDerivedSourcesPreserved,127);assert.equal(inputs.notes,85);assert.equal(inputs.oldAssignmentsPreserved,41);assert.equal(inputs.cityWideAssignmentRows,47);assert.equal(inputs.confirmedAssignmentsAdded,6);assert.equal(inputs.nullAnalysisNotes.length,8);
for(const key of ['originalSummariesPreserved','rawJsonHashesPreserved','analysisHashesAndNullPreserved','publicationAndCollectionTimesPreserved','noteTextStatusAndSourceUrlsPreserved','exactMultilineWarningStored'])assert.equal(inputs[key],true);
assert.equal(upstream.rawSourcesUnchanged,127);assert.equal(upstream.originalMentionsUnchanged,490);assert.equal(upstream.appliedEntitiesVerified,0);assert.equal(upstream.appliedScopesVerified,1);
assert.ok(pre.cities[0].unchangedSincePreview);assert.ok(Date.parse(pre.at)<Date.parse(sync.importedAt));
for(const [k,v]of Object.entries({oldRowsPreserved:411,photoFieldsPreserved:127,independentPhotos:0,untouchedRetained:5}))assert.equal(post.cities[0][k],v);
assert.deepEqual(post.trips,pre.trips);assert.deepEqual(post.trips,{count:201,digest:'e01d67cbf42a62fc595f4ef052f99e75'});
for(const key of ['idempotent','reverseRollback','originalSourcesAndMentionsUnchanged','sourceDatesAndAnalysisUnchanged'])assert.equal(isolated[key],true);
assert.deepEqual([isolated.sources,isolated.mentions,isolated.fullNotes,isolated.scopeChanges,isolated.assignmentChanges,isolated.newEntities,isolated.withdrawals],[1,6,6,1,6,0,0]);
assert.deepEqual(isolated.results,[{id:teaId,name:'鹤鸣茶社',confirmed:6,originalHighlightsAndDatesPreserved:4,originalEvidencePreserved:5,currentEvidence:7,originalWarningsPreserved:2,exactMultilineWarningAdded:1,newIndependentDuration:false,positionAndCategoryPreserved:true,identityMembersPreserved:true}]);
assert.ok(dual.reverseRollback&&dual.oldRowsPreserved&&dual.photosPreserved);assert.deepEqual([delta.before,delta.after,delta.directBefore,delta.directAfter],[49,49,15,15]);assert.equal(delta.changed.length,0);assert.equal(delta.removed.length,0);
for(const key of ['actualDualImport','authorWarningPreserved','otherFactsExcluded','warningRemovalAuthoritative','sqlIdentity','oldVersionRejected','idempotent','reverseRollback'])assert.equal(protocol[key],true);
const stats={positive:flow.cities.reduce((n,c)=>n+c.probes.length,0),boundaries:flow.cities.reduce((n,c)=>n+c.negativeProbes.length,0),withdrawals:flow.cities.reduce((n,c)=>n+c.withdrawalProbes.length,0),pending:audit.cities.reduce((n,c)=>n+(c.statuses.PENDING??0),0)};
assert.deepEqual(stats,{positive:338,boundaries:113,withdrawals:52,pending:313});assert.equal(read('all-cities/flow/run-71/cleanup.json').removed,true);
assert.equal(audit.sha256,'dc2902de16534c58008532879022fa11375f0355ca4fc41d5ba1a9cacb160bc0');
assert.equal(hash(url('all-cities/audit/run-68/report.json')),'250a4d917a329ed06a37409a7b1d907d87f8d8af8ae23b3e07a43a1ef939ac14');
for(const log of ['downstream-place_identity_test_1791509109043.log','downstream-place_identity_test_1791508623503.log'])assert.match(fs.readFileSync(url(log),'utf8'),/pass 1/);
assert.match(fs.readFileSync(url('upstream-full-place_identity_test_1791508608353.log'),'utf8'),/716 passed, 1 deselected/);
for(const log of ['upstream-stage-place_identity_test_1791508576352.log','upstream-installed-place_identity_test_1791508759003.log'])assert.match(fs.readFileSync(url(log),'utf8'),/27 passed/);
const install=read('upstream-install.json');assert.equal(install.files.length,65);
for(const f of install.files)for(const p of [url('upstream/'+f.path),'D:/Project/xhs-travel-pipeline/'+f.path])assert.equal(hash(p),f.after);
const changed=install.files.filter(f=>f.before!==f.after);assert.equal(changed.length,3);
assert.deepEqual(changed.map(f=>f.path).sort(),['app/clean/note_text_warnings.py','tests/test_note_text_warning_lines.py','tests/test_note_text_warnings_db.py']);
const ledger=read(dir+'review-04.json'),oldRows=structuredClone(ledger.rows),tea=ledger.rows.find(r=>r.entityId===teaId);
assert.equal(tea.currentRevision,1);assert.equal(tea.status,'pending');
Object.assign(tea,{currentRevision:2,status:'reviewed_scope_partial',reviewBatch:69,changeBatch:69,textReviewBatch:69,
  dimensions:{...tea.dimensions,identity:'reviewed_six_mentions_and_original_multiline_opinion',consumedFacts:'reviewed_original_opinions_preserved_independent_duration_unknown'},
  confirmedMentions:6,pendingMentions:0,supplementalNoteIds:[877],
  reviewEvidence:[dir+'heming-source-review-01.json',dir+'heming-downstream-check-01.json',dir+'heming-inputs-check-01.json',consumptionFile,isolatedFile],
  followup:'6条提及及note877跨行可不去意见已完整保全；4看点及日期、原2负评、旧5语料保留，现7语料。公园独立不变；美食/cafe及旧点保留未新核，独立时长缺失、当前营业/预约未知，定位与媒体仍待核。'});
for(let i=0;i<ledger.rows.length;i++)if(ledger.rows[i].entityId!==teaId)assert.deepEqual(ledger.rows[i],oldRows[i]);
assert.deepEqual(ledger.rows.map(r=>[r.entityId,r.name]),oldRows.map(r=>[r.entityId,r.name]));
assert.deepEqual(ledger.rows.map(r=>[r.entityId,r.name]).sort(),frozen.selected.filter(r=>r.place.city==='成都').map(r=>[r.place.id,r.place.name]).sort());
assert.equal(ledger.rows.filter(r=>r.status==='pending').length,105);assert.equal(ledger.rows.filter(r=>r.status==='reviewed_scope_partial').length,3);
ledger.createdAt=at;ledger.previousLedger=dir+'review-04.json';
Object.assign(ledger.summary,{partiallyReviewedScopeRows:3,otherPendingPrimaryRows:105,governedScopeMentions:8,pendingScopeMentions:0,cityWideAssignmentRowsAfterBatch:47,
  fullyReviewedMeaning:'113固定主体及3依赖不变，0完整自查、113未完成：3部分scope、4位置部分、1类别部分、105其余。',
  cityWideAssignmentMeaning:'初始39分配，第66批增加2，第69批增加6，共47；不等于完整复核113主体。'});
const progress='第69批鹤鸣茶社1源6提及/6全文完整scope已应用双同步，原名/别名/根ID/成员ID及位置/美食cafe保持，revision1→2。跨行警示校验扩展为完整相邻两行、其中一行为既有主体名，原指纹/存储/下游协议不变，无迁移；逐字承接note877“可以不去\\n鹤鸣茶社”，保留4原看点及日期、2原负评和5旧语料，现7语料，混合tips已替换。独立时长缺失，营业/预约未知；不借公园合游时长。人民公园网页/意见和facts旧1图不变。上游全套716通过/1真实地图检查排除，已安装27专项通过；协议实际双导入/移除/回滚及真实来源scope预演通过。392地点/49关系/direct15同版本9双导入，2SQL/1真实向量/14边界通过；49关系内容全等，新增补充原文来源。127源/490提及/85笔记及日期/分析/raw_json保持，41旧分配加6为47，411旧行/127图片字段/201行程保持。实际facts全等，372主名查图一致、11处各1图；mock359→358，真实队列0。全仓/扩展typecheck通过，flow71为338正例/113边界/52撤回零失败，audit68仍313PENDING。成都review05仍113未完成（3部分scope、4位置部分、1类别部分、105其余），济南review45不变。茶社跨行问题解决，原3项媒体相关和公园保全发现共4项未应用；183范围待审及4必去缺口保持。实体69/元数据01/图片03，无待同步验证。不看图、地图凭据待轮换、云南长尾不扩入，未验收不提交归档。';
Object.assign(pointer,{latestAppliedEntityBatch:69,latestFlow:'../all-cities/flow/run-71',latestAudit:'../all-cities/audit/run-68',pendingVerification:[],progressNote:progress,progressUpdatedAt:at,
  latestReviewEvidence:{city:'成都',file:'../'+dir+'heming-downstream-check-01.json',supplement:'../'+dir+'heming-source-review-01.json',fullReviewsAdded:0,partiallyReviewedScope:1,fullReviewsReopened:0}});
pointer.cityReviewLedgers['成都']='../'+dir+'review-05.json';
assert.equal(pointer.unappliedFindings.length,5);assert.equal(pointer.unappliedFindings.filter(f=>f.entityId===teaId&&f.status==='unapplied_scope_preserve_multiline_original_warning').length,1);
pointer.unappliedFindings=pointer.unappliedFindings.filter(f=>f.entityId!==teaId);assert.equal(pointer.unappliedFindings.length,4);
assert.deepEqual(pointer.unappliedFindings,before.unappliedFindings.filter(f=>f.entityId!==teaId));
pointer.resolvedFindings.push({entityId:teaId,name:'鹤鸣茶社',status:'resolved_scope_and_multiline_original_warning_batch69_location_and_media_pending',resolvedByEntityBatch:69,evidence:'../'+dir+'heming-downstream-check-01.json',confirmed:6,pending:0,textWarnings:1,scopeChanged:true,coordinatesCleared:false,preciseLocationResolved:false,fullReviewPassed:false});
pointer.latestNoteTextWarningProtocol={entityBatch:69,installedFiles:65,changedFiles:3,migration:null,hashVersion:'note_text_warning_v1',design:'../multiline-warning-design-20261009.md',allowedQuoteLines:[1,2],textWarningsAdded:1,downstreamVerification:'../'+protocolFile,previousProtocol:before.latestNoteTextWarningProtocol};
for(const key of ['summary','scopeSha256','currentScopeReviews','latestIndependentPhotoBatch','unappliedMetadataFindings','resolvedMetadataFindings','latestMetadataRefresh','cityMetadataRefreshes','mapCredentialGate','imageComparisonPolicy'])assert.deepEqual(pointer[key],before[key]);
assert.equal(pointer.cityReviewLedgers['济南'],before.cityReviewLedgers['济南']);task.notes=progress+'见research/'+reportFile+'。';
const report=`# 第69批：鹤鸣茶社范围与跨行原评价\n\n${progress}\n\n## 实际变化\n\n[逐项来源核对](${dir}heming-source-review-01.json)覆盖3564/3772/4059/4162/4199/4200及五篇原文955/957/895/929/932，另读note877原分析。前四类正面体验为喝茶、采耳、休闲和夜景；原拥挤吵热及餐食普通两项负评照常确认。补充警示保持原两行：\n\n> 可以不去\n> 鹤鸣茶社\n\n原文换行、来源URL和日期均保留。旧五条语料全部保持，新增原短理由“老茶馆体验采耳”和一条跨行警示，总七条；四条原看点及简介保持。推荐分17.83、提及数6不变；topReasons的前三条由确认提及确定，混合tips仅留下原跨行意见。没有新增实体、别名、坐标或类别修正。旧地址与点位保持，不解释为本批重新验证。茶社独立时长缺失、当前营业/预约未知，不复制公园路线120分钟或公园停靠90分钟。\n\n## 协议与验证\n\n[设计](multiline-warning-design-20261009.md)只扩展现有textWarnings校验：原单行规则保留；两行必须连续、完整、非空，至少一行完整对应当前已确认主体名或别名。原字符、码点偏移和指纹校验保留；拒绝空行、三行、混合名称行、剪裁否定、改字/换序和过期原文。结构合格不等于观点客观正确，仍需阅读上下文。安装65文件，其中3文件变化，原64文件安装清单另存；没有schema迁移或下游wire变更。\n\n上游全套716通过，1项需要真实地图凭据的检查排除；staged与installed警示专项各27通过。[跨行协议实际双导入](${protocolFile})覆盖逐字保全、权威移除、旧版本拒绝、幂等与倒序回滚。[真实来源预演](${isolatedFile})证明原数据与消费保全；[全城双导入](${dualFile})和[实库逐字段验证](${dir}heming-downstream-check-01.json)覆盖392导出、2SQL/1真实向量/14名称和ID边界。49条关系/direct15全等，只在来源声明新增补充原文引用，全城版本9。\n\n[实际facts与图库](${consumptionFile})检查全部facts、372主名查询：11处各1图均保持，公园facts旧1图/封面不变，茶社facts和lookup均无图。mock359→358只停止茶社补图，真实队列0。报告correctedNameKeys=2表示核验了两个茶社名称键，facts值实际完全一致；不代表更名或两次内容修改。没有查看图片，也没有新增媒体绑定。\n\n[原输入核验](${dir}heming-inputs-check-01.json)保全127源、490提及、85笔记原文/日期/raw_json/分析；旧41分配加6为47。[同步后检查](${postFile})保全411旧行、127图片字段、0独立绑定和201行程，图片字段数量不是照片张数。人民公园网页/意见/旧媒体问题仍未应用scope。\n\n全仓/扩展typecheck通过。[flow71](all-cities/flow/run-71/report.json)338正例/113边界/52撤回零失败，临时库已清理；[audit68](all-cities/audit/run-68/report.json)313PENDING保持。flow71比flow70新增鹤鸣茶社一条正例，总数338；登记脚本在写入前拦截旧337预期，已按逐城差异修正。验证脚本修正一处可选canonicalPlaceId的类型收窄及一处错误的审计字段假设：scope索引不含textWarnings，完整警示由上游catalog、导出和SQL语料联合验证；没有放松业务内容断言或改变生产数据迁就验证。\n\n## 续作断点\n\n当前实体69/flow71/audit68，成都review05、济南review45；下一批70/flow72/audit69，成都下一review06。成都113主体＋3依赖、0完整自查/113未完成；3部分scope、4位置部分、1类别部分、105其余。茶社跨行保全问题已解决，未应用发现剩原3项媒体相关与公园保全共4项。固定978＋56/1135不扩展，正式183范围待审及4必去缺口不变。任务仍in_progress、未获用户验收，不提交、不归档、不标记完成。\n\n来源SHA：${hash(url('all-cities/batch-69-source.json'))}。导出SHA：${sync.exportHash}。关系SHA：${sync.relationHash}。\n`;
const quality={batch:69,at,stats,rootTypecheck:true,extendedTypecheck:true,installedManifestHashesVerified:65,installedFilesChanged:3,productionCodeChanged:true,newMigration:false,upstreamTests:{passed:716,deselected:1},installedWarningTests:27,isolatedSqlAndExport:true,reverseRollback:true,actualConsumptionTestPassed:true,
  sourceFile:'all-cities/batch-69-source.json',consumptionFile,postFile,dualFile,isolatedFile,protocolFile,inputsFile:dir+'heming-inputs-check-01.json',scopesAdded:1,assignmentsAdded:6,pendingAdded:0,categoryChanges:0,coordinatesCleared:0,preciseLocationsResolved:0,
  chengdu:{primary:113,dependencies:3,fullyReviewed:0,remaining:113,partialScope:3,partialLocation:4,partialCategory:1,otherPending:105,clearedPointPending:6,governedScopeMentions:8,cityWideAssignments:47},jinanLedgerPreserved:'review-45',unappliedFindings:4,oldCanonicalMediaProbes:372,targetFactMedia:consumption.targetFactMedia,checkedTargetFactsKeys:2,allFactsUnchanged:true,oldNameMockEnqueues:{before:359,after:358},actualEnqueues:0,
  imageComparison:'deferred_by_user',mapCredentialStatus:'rotation_required',userAcceptance:false,failures:[]};
const prd=fs.readFileSync(url('../prd.md'),'utf8'),continuation=fs.readFileSync(url('nine-cities-continuation-20261007.md'),'utf8'),range=/^- 用户最新明确：\*\*云南不处理，继续其他城市直到验收通过\*\*。[^\n]*$/m;assert.ok(range.test(prd));
const nextPrd=prd.replace(range,'- 用户最新明确：**云南不处理，继续其他城市直到验收通过**。九城固定978主体＋56依赖/1135源，183范围待审及4必去缺口。第69批鹤鸣茶社6提及完整scope、跨行原负评已保全；原3项媒体相关与公园保全发现共4项未应用。成都review05仍113未完成（3部分scope、4位置部分、1类别部分、105其余），济南review45仍76未完成。图片暂缓、地图凭据待轮换，未获用户验收。').replace('## 已知事实\n','## 已知事实\n\n### 最新进展：第69批鹤鸣茶社范围与跨行原评价\n\n'+progress+'见[第69批记录](research/'+reportFile+')。以下为历史快照。\n');
const nextContinuation=continuation.replace('## 本轮断点\n','## 本轮断点\n\n当前实体69/flow71/audit68；成都review05，济南review45。'+progress+'下一批70使用flow72/audit69，成都下一review06，不重放69。见['+reportFile+']('+reportFile+')。以下为历史断点。\n');
assert.notEqual(nextPrd,prd);assert.notEqual(nextContinuation,continuation);
const fresh=new Map([[reportFile,report],[dir+'review-05.json',json(ledger)],[dir+'review-05.md','# 成都113项重点台账（第69批）\n\n'+progress+'\n\n| 原名称 | 当前名称 | 版本 | 进度 | 说明 |\n| --- | --- | ---: | --- | --- |\n'+ledger.rows.map(r=>`| ${r.name} | ${r.currentName} | ${r.currentRevision} | ${r.status} | ${r.followup} |`).join('\n')+'\n'],[dir+'heming-final-verification-01.json',json(quality)]]);
for(const p of fresh.keys())assert.ok(!fs.existsSync(url(p)),p+'已存在，禁止重放');assert.ok(fs.readFileSync(new URL('../../../spec/server/backend/place-identity.md',import.meta.url),'utf8').includes('## 58.'));
const replacements=new Map([['../task.json',json(task)],['../prd.md',nextPrd],['nine-cities-continuation-20261007.md',nextContinuation]]);
for(const kind of ['implement','check']){
  const p=`../${kind}.jsonl`,original=fs.readFileSync(url(p),'utf8');
  const entries=[{file:'.trellis/tasks/10-06-place-identity-governance/research/'+reportFile,reason:'第69批茶社完整scope和跨行意见保全已双同步；review05/flow71/audit68，不重放、不看图、未验收不提交归档'},
    {file:'.trellis/tasks/10-06-place-identity-governance/research/multiline-warning-design-20261009.md',reason:'完整相邻两行原评价协议与拒绝边界；保留旧存储/指纹和主观意见，无新迁移'}];
  for(const entry of entries)assert.ok(!original.includes(entry.file));replacements.set(p,original+entries.map(e=>JSON.stringify(e)+'\n').join(''));
}
for(const [p,v]of fresh)fs.writeFileSync(url(p),v,{flag:'wx'});for(const [p,v]of replacements)fs.writeFileSync(url(p),v);fs.writeFileSync(url('cleaning-scope/current.json'),json(pointer));
console.log(JSON.stringify({batch:69,chengduLedger:'review-05',remaining:113,partialScope:3,partialLocation:4,partialCategory:1,otherPending:105,jinanLedger:'review-45',unappliedFindings:4,pendingVerification:[],userAcceptance:false,stats}));
