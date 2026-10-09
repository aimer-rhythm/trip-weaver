// 记录第64批已验证交付状态；不提交、不归档、不标记用户验收。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const url=p=>new URL(p,import.meta.url),read=p=>JSON.parse(fs.readFileSync(url(p),'utf8')),json=v=>JSON.stringify(v,null,2)+'\n';
const sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const dir='priority-cities/济南/',folder='all-cities/batch-64/sync-01/',reportFile='batch64-jinan-last-restaurants-20261009.md',at=new Date().toISOString();
const unique=(p,re)=>{const names=fs.readdirSync(url(p)).filter(n=>re.test(n));assert.equal(names.length,1);return p+names[0];};
const pointer=read('cleaning-scope/current.json'),before=structuredClone(pointer),task=read('../task.json');
assert.equal(pointer.latestAppliedEntityBatch,63);assert.equal(pointer.cityReviewLedgers['济南'],'../'+dir+'review-43.json');
assert.equal(pointer.userAcceptance,false);assert.equal(task.status,'in_progress');assert.equal(pointer.taskStatus,'in_progress');assert.deepEqual(pointer.pendingVerification,[]);
assert.equal(pointer.latestIndependentPhotoBatch,3);assert.equal(pointer.latestMetadataRefresh.run,1);assert.equal(pointer.imageComparisonPolicy.status,'deferred_by_user');assert.equal(pointer.mapCredentialGate.status,'rotation_required');assert.equal(pointer.unappliedFindings.length,3);
assert.equal(sha(url('cleaning-scope/'+pointer.scopeFile)),pointer.scopeSha256);const frozen=read('cleaning-scope/'+pointer.scopeFile);assert.deepEqual(frozen.summary,pointer.summary);
assert.equal(frozen.selected.length,978);assert.equal(frozen.dependencies.length,56);assert.equal(frozen.sourceIds.length,1135);assert.ok(frozen.selected.every(r=>r.place.city!=='云南'));
const source=read('all-cities/batch-64-source.json'),scopes=read('all-cities/batch-64-scope-decisions.json'),decisions=read('all-cities/batch-64-decisions.json');
assert.equal(sha(url('all-cities/batch-64-source.json')),'fb7cce88b581233469111ea03cc4842c01ff36ec5afb9caece3247b0e456aef9');
assert.equal(sha(url(dir+'last-restaurants-source-packet-01.json')),'f3c5abdc029e349763d90476baf9bcba5fb4156a663d068985ba521dfea591c0');
assert.deepEqual([source.sources.length,source.mentions.length,source.noteDetails.length,scopes.length,decisions.length],[4,10,3,3,3]);
assert.deepEqual(scopes.flatMap(s=>s.assignments.filter(a=>!a.entityId).map(a=>a.mentionId)),[12893]);
for(const k of ['preview','applied'])assert.equal(read(`all-cities/batch-64-${k}.json`).changes.length,6);assert.equal(read('all-cities/batch-64-applied.json').apply,true);
const sync=read(folder+'sync-state.json').cities['济南'];assert.ok(sync.importedAt&&sync.relationsImportedAt&&sync.embeddingRunAt);assert.equal(sync.relationSnapshotRevision,38);
assert.equal(sync.exportHash,sha(url(folder+'xhs-places-济南.json')));assert.equal(sync.relationHash,sha(url(folder+'xhs-place-relations-济南.json')));
const consumptionFile=unique(folder,/^last-restaurants-consumption-\d+\.json$/),postFile=unique(folder,/^post-import-check-\d+\.json$/),dualFile=unique(folder+'preview-济南/',/^preview-\d+\.json$/);
const actual=read(dir+'last-restaurants-downstream-check-01.json'),consumption=read(consumptionFile),pre=read(folder+'pre-import-check.json'),post=read(postFile),vectors=read(folder+'verification-vectors.json');
for(const [k,v]of Object.entries({consumedFieldsVerified:228,assignmentRows:356,pendingMentions:133,scopesAdded:3,confirmed:7,pendingAdded:1,readOnlySources:1,coordinatesCleared:1,newPreciseLocations:0,sqlProbes:7,boundaryProbes:66,realVectorProbes:4,graph:18,directEdges:3}))assert.equal(actual[k],v);
assert.ok(actual.validOldOpinionsAndHighlightsPreserved&&actual.allOtherFieldsAndDatesPreserved&&actual.priorReviewRowsPreserved);
assert.equal(vectors.cities[0].vectorProbes.length,4);assert.ok(vectors.cities[0].vectorProbes.every(p=>p.diagnostics.vector==='used'));
assert.ok(consumption.actualPlaceFacts&&consumption.priorGovernedFactsPreserved&&consumption.independentSourceDigestUnchanged);
assert.deepEqual(consumption.media.map(r=>r.count),[3,1,2]);assert.deepEqual(consumption.mockEnqueueCalls,{before:4,after:1});assert.equal(consumption.actualEnqueues,0);
const photo=read(dir+'last-restaurants-photo-metadata-01.json'),photoPre=read(dir+'last-restaurants-photo-preflight-01.json');assert.equal(photo.entities.length,4);assert.ok(photo.entities.every(p=>p.independentSources.length===0&&p.assignments.length===0));assert.ok(photoPre.existingPhotoConsumptionPreserved);
assert.equal(pre.mode,'before');assert.equal(pre.cities[0].unchangedSincePreview,true);assert.ok(Date.parse(pre.at)<Date.parse(sync.importedAt));
assert.equal(post.cities[0].oldRowsPreserved,238);assert.equal(post.cities[0].photoFieldsPreserved,159);assert.equal(post.cities[0].independentPhotos,9);assert.deepEqual(post.trips,pre.trips);assert.deepEqual(post.trips,{count:201,digest:'e01d67cbf42a62fc595f4ef052f99e75'});
const isolatedFile='all-cities/batch-64/scope-preview-1791502775931518700/report.json',isolated=read(isolatedFile),dual=read(dualFile),delta=read(folder+'preview-济南/relation-delta.json'),upstream=read('all-cities/batch-64-upstream-check.json');
assert.ok(isolated.idempotent&&isolated.reverseRollback&&isolated.originalSourcesAndMentionsUnchanged&&isolated.confirmedOpinionsAndDatesPreserved&&isolated.sourceDatesAndAnalysisUnchanged&&isolated.readOnlyHuaXiangPreserved);
assert.ok(dual.reverseRollback&&dual.oldRowsPreserved&&dual.photosPreserved);assert.equal(delta.changed.length,0);assert.equal(delta.removed.length,0);
for(const [k,v]of Object.entries({rawSourcesUnchanged:107,originalMentionsUnchanged:662,originalNotesCovered:82,appliedEntitiesVerified:3,appliedScopesVerified:3,assignmentsVerified:8,factExclusionsVerified:0}))assert.equal(upstream[k],v);
const inputs=read(dir+'last-restaurants-inputs-check-01.json');assert.equal(inputs.notes,3);assert.deepEqual(inputs.nullAnalysisNotes,[2602]);assert.ok(inputs.publicationAndCollectionTimesPreserved&&inputs.rawJsonHashesPreserved&&inputs.analysisHashesAndNullPreserved&&inputs.supplementalWarningSourcePreserved);
assert.equal(inputs.remainingRelationsPreserved,18);assert.equal(inputs.relationChanges,0);
const flow=read('all-cities/flow/run-66/report.json'),audit=read('all-cities/audit/run-63/report.json');
for(const r of [actual,consumption,pre,post,isolated,dual,upstream,flow,audit,vectors,inputs,photoPre])assert.deepEqual(r.failures,[]);assert.equal(read('all-cities/flow/run-66/cleanup.json').removed,true);
const stats={positive:flow.cities.reduce((n,c)=>n+c.probes.length,0),boundaries:flow.cities.reduce((n,c)=>n+c.negativeProbes.length,0),withdrawals:flow.cities.reduce((n,c)=>n+c.withdrawalProbes.length,0),pending:audit.cities.reduce((n,c)=>n+(c.statuses.PENDING??0),0)};assert.deepEqual(stats,{positive:329,boundaries:113,withdrawals:52,pending:313});
for(const [name,pattern]of [['downstream-place_identity_test_1791502470169.log',/pass 1/],['downstream-place_identity_test_1791502978295.log',/pass 1/],['upstream-stage-place_identity_test_1791502774670.log',/"reverseRollback": true/]])assert.match(fs.readFileSync(url(name),'utf8'),pattern);
const install=read('upstream-install.json');assert.equal(install.files.length,64);for(const f of install.files)for(const p of [url('upstream/'+f.path),'D:/Project/xhs-travel-pipeline/'+f.path])assert.equal(sha(p),f.after);
const ledger=read(dir+'review-43.json'),oldRows=structuredClone(ledger.rows),targetIds=source.groups.map(g=>g.entity.entity_id);
assert.deepEqual(ledger.rows.map(r=>[r.entityId,r.name]).sort(),frozen.selected.filter(r=>r.place.city==='济南').map(r=>[r.place.id,r.place.name]).sort());
for(const g of source.groups) {
  const eid=g.entity.entity_id,sid=g.entity.primary_place_id,row=ledger.rows.find(r=>r.entityId===eid);assert.equal(row.currentRevision,1);assert.equal(row.status,'pending');
  const d=decisions.find(d=>d.entityId===eid),scope=scopes.find(s=>s.sourcePlaceId===sid);
  row.textReviewBatch=64;row.reviewEvidence=[...(row.reviewEvidence??[]),dir+'last-restaurants-source-packet-01.json',dir+'last-restaurants-web-review-01.json',dir+'last-restaurants-source-review-01.json',dir+'last-restaurants-inputs-check-01.json',dir+'last-restaurants-downstream-check-01.json',consumptionFile];
  if(!d) {
    row.followup='第64批继续只读核查：原文大观园南门附近、历史经五路东首和Trip饮虎池街24号楼缺同店连续性，不能认定迁址或同分店。保留原名/ID/revision1/点/有效正评与普通消费，地址对应、精确位置及媒体待核。';
    continue;
  }
  Object.assign(row,{currentRevision:3,currentName:d.canonicalName,reviewBatch:64,changeBatch:64,status:'reviewed_scope_partial',
    dimensions:{...row.dimensions,identity:sid===5331?'address_qualified_confirmed_bare_mention_pending':'branch_confirmed',category:'food_confirmed',
      location:sid===5331?'unsupported_old_point_cleared_precise_location_pending':'old_point_preserved_not_newly_verified',media:'deferred_by_user',consumedFacts:'confirmed_original_opinions_and_dates_preserved'},
    governedSourceIds:[sid],scopeMentionIds:g.mentionIds,currentMentionIds:scope.assignments.filter(a=>a.entityId).map(a=>a.mentionId),pendingScopeMentionIds:scope.assignments.filter(a=>!a.entityId).map(a=>a.mentionId),
    followup:sid===5331?'第64批地址限定为许记排骨（县东巷71号），不声明官方分店名或已有其他分店。两条同篇门牌提及确认，12893裸名待核；旧点距原文老城参照约4–5km，清空待精确定位，保留县东巷71号。原确认正评和日期保持，待审泛评退出消费，媒体暂缓。':sid===5343?'第64批原文和2026济南文旅正文共同确认山大南路店，三提及确认，地址改为山大南路蜀易火锅隔壁。旧点保持未新验证，原两条评价/日期保持，不继承老苏的营业时段，媒体暂缓。':'第64批原文泉城路与抓取商户泉城路店/狮子口街共同确认，两个同篇提及确认，原评价/日期保持；旧地址和点保持待精确核验，历史评论不证明当前营业，媒体暂缓。'});
}
for(let i=0;i<ledger.rows.length;i++)if(!targetIds.includes(ledger.rows[i].entityId))assert.deepEqual(ledger.rows[i],oldRows[i]);
assert.deepEqual(ledger.rows.map(r=>[r.entityId,r.name]),oldRows.map(r=>[r.entityId,r.name]));
assert.equal(ledger.rows.filter(r=>['reviewed_scope_partial','mixed_source_withdrawn_assignment_pending'].includes(r.status)).length,48);
assert.equal(ledger.rows.filter(r=>['pending','reviewed_identity_media_location_pending'].includes(r.status)).length,28);
assert.equal(ledger.rows.filter(r=>r.status==='reviewed_identity_media_location_pending').length,16);
ledger.createdAt=at;ledger.previousLedger=dir+'review-43.json';Object.assign(ledger.summary,{partiallyReviewedScopeRows:48,governedScopeMentions:493,pendingScopeMentions:133,otherPendingPrimaryRows:28,wrongPointClearedPositionPending:25,confirmedLastRestaurantMentions:7,
  fullyReviewedMeaning:'18原入选行对应16现行主体；第64批三餐馆部分scope与华祥只读待核，完整自查新增0。',
  scopeProgressMeaning:'98行保持：4非地点、18行AI自查、76未完成（48部分scope、28其余，其中16身份事实已查位置媒体待核）；183范围待审及4必去缺口。许记旧点清空后精确定位待核，清点待定位25；华祥地址对应未解决，原3项图库保全相关文字发现仍未应用。'});
assert.equal(ledger.summary.fullyReviewed,18);assert.equal(ledger.summary.remainingPrimaryToReview,76);
const progress='第64批四餐馆4源10提及/3全文复核，许记排骨（县东巷71号）、桥下把子肉（山大南路店）、蜗牛叔叔的食堂（泉城路店）三源完整scope，8分配/7确认/12893裸名待审，原ID/类别保持，revision1→3。许记补原文门牌并清除不支持该店的旧点，精确定位未解决；桥下概略地址有原文和2026文旅正文互证，蜗牛旧地址保持，两者旧点未新核。确认评价及日期保持，许记待审泛评退出消费，同篇重复抽取去重为4条语料/4看点。华祥地址对应无连续性证据，原revision1/点/消费只读保持。107原源/662提及/82全文及3篇发表采集时间/raw_json/分析形态保持，累计356分配/133待审。228地点/18关系/direct3，关系内容及芙蓉街警示来源不变，共同revision38；真实隔离幂等/倒序回滚、双导入、7SQL/4真实向量/66边界和实际placeFacts/图库通过。238旧行/159旧图片字段/9绑定/201行程保持，旧图库3/1/2、四店null、mock4→1、真实队列0。全仓与扩展typecheck通过，flow66为329正例/113边界/52撤回零失败，audit63为313PENDING。review44仍98行：4非地点18行AI自查76未完成（48部分scope28其余，含16身份事实已查位置媒体待核），scope提及493、清点待定位25；183范围待审/4必去缺口，原3项媒体相关文字发现未应用。实体64/元数据01/图片03，无待同步验证；不看图、凭据待轮换、云南长尾不扩入，未验收不提交归档。';
Object.assign(pointer,{latestAppliedEntityBatch:64,latestFlow:'../all-cities/flow/run-66',latestAudit:'../all-cities/audit/run-63',progressNote:progress,progressUpdatedAt:at,
  latestReviewEvidence:{file:'../'+dir+'last-restaurants-downstream-check-01.json',supplement:'../'+dir+'last-restaurants-source-review-01.json',fullReviewsAdded:0,partiallyReviewed:3,readOnlyPending:1,fullReviewsReopened:0}});
pointer.cityReviewLedgers['济南']='../'+dir+'review-44.json';Object.assign(pointer.currentScopeReviews,{addedPendingMentions:133,currentReviewRows:183,meaning:'50固定重点实体对加133提及待审；第64批7确认、1裸名待审，华祥地址对应仍待核。原3项媒体相关文字发现未应用。'});
pointer.currentScopeReviews.evidence.push('../'+dir+'last-restaurants-source-review-01.json');pointer.latestReadOnlyFindings.lastRestaurantsFollowup='../'+dir+'last-restaurants-web-review-01.json';
for(const d of decisions){const scope=scopes.find(s=>s.expectedRevisions[d.entityId]);pointer.resolvedFindings.push({entityId:d.entityId,name:d.canonicalName,status:'resolved_address_qualified_restaurant_scope_batch64',resolvedByEntityBatch:64,evidence:'../'+dir+'last-restaurants-downstream-check-01.json',confirmed:scope.assignments.filter(a=>a.entityId).length,pending:scope.assignments.filter(a=>!a.entityId).length,fullReviewPassed:false,coordinatesCleared:d.overrides.lat===null,preciseLocationResolved:false});}
for(const k of ['unappliedFindings','unappliedMetadataFindings','resolvedMetadataFindings','latestMetadataRefresh','latestNoteTextWarningProtocol','summary','scopeSha256','mapCredentialGate'])assert.deepEqual(pointer[k],before[k]);task.notes=progress+'见research/'+reportFile+'。';
const report=`# 第64批：济南剩余餐馆的地址限定与只读疑问\n\n${progress}\n\n## 实际改动\n\n| 原主体 | 本批消费结果 | 保留的待核项 |\n| --- | --- | --- |\n| 许记排骨 | 地址限定为县东巷71号，2确认/1待审，旧点清空；1条有效评价和日期保留 | 12893裸名归属、精确坐标；不宣称存在第二店 |\n| 桥下把子肉 | 山大南路店，3确认，地址为山大南路蜀易火锅隔壁；2条评价和日期保留 | 旧点未新验证，媒体暂缓 |\n| 蜗牛叔叔的食堂 | 泉城路店，2确认，1条评价和日期保留；旧地址/点不改 | 精确定位和当前营业未确认，媒体暂缓 |\n| 华祥糕点 | revision1及全部原消费保持，只读记录 | 大观园、经五路、饮虎池街之间缺同店连续性 |\n\n## 证据边界\n\n原文优先；[网页复核](${dir}last-restaurants-web-review-01.json)逐项绑定5个成功抓取正文，搜索主回答虚构门牌/分店/电话均弃用。高德摘要未用于坐标，两个县东巷检索超时、Exa未配置和百科空提取均保留失败工件，未改凭据或另用未配置搜索路线。许记旧点与原文大明湖/泉城路参照分别约4.599/4.779km，距离只辅助识别偏离，未生成新点。桥下正文来自2026-04-15济南文旅文章；蜗牛历史评论不证明2026营业。\n\n## 验证与保全\n\n[真实隔离验证](${isolatedFile})包含四源、三全文和完整日期，8分配/7确认/1待审，幂等与倒序回滚恢复全部原实体、审核、源和消费。前三次预演失败分别为note_images null被测试装载成[]、语料去重预期不当和旧geoStatus缺省字段访问，均仅修复测试装载/断言，失败工件保留，业务决定未改写。实库来源检查同样按原null/目录可选字段合同修正一次只读断言。\n\n[实库字段检查](${dir}last-restaurants-downstream-check-01.json)、[输入日期检查](${dir}last-restaurants-inputs-check-01.json)与[实际消费](${consumptionFile})均无失败。3全文中2篇有既有分析，2602原null保持，未看图片。许记待审泛评退出当前消费不等于删除原文；7确认提及按相同来源去重为4语料/4看点，逐条字面值和日期保持。旧营业状态仍unknown，只有subject随规范名改变。\n\n18关系零增删/零端点变更，关系共同版本38，既有芙蓉街警示来源保持。159旧图片字段比上批多3个历史空字段，不代表新增照片。三旧图库3/1/2完全同返回，四餐馆均无图；mock4→1仅华祥保持普通回退，真实补图队列0。\n\n全仓与扩展typecheck、差异检查通过；[flow66](all-cities/flow/run-66/report.json)为329正例/113边界/52撤回，[audit63](all-cities/audit/run-63/report.json)为313PENDING，其余审核行保持，临时库清理完成。64个已安装上游文件的暂存/安装散列一致，本批无生产协议改动。\n\n## 当前断点\n\nreview44、实体64、flow66、audit63；下一批65使用flow67/audit64/review45，不重放64。九城固定978主体＋56依赖/1135原源不变；济南仍76行未完成，完整自查新增0。图片暂缓，地图凭据待轮换；未获用户验收，不提交、不归档、不标记完成。\n\n来源SHA：${sha(url('all-cities/batch-64-source.json'))}。导出SHA：${sync.exportHash}。关系SHA：${sync.relationHash}。\n`;
const quality={batch:64,at,stats,installedManifestHashesVerified:64,productionCodeChanged:false,isolatedSqlAndExport:true,reverseRollback:true,actualConsumptionTestPassed:true,rootTypecheck:true,extendedTypecheck:true,
  frozenMembershipPreserved:{primary:978,dependencies:56,sourceRows:1135},fullReviewsAdded:0,remainingPrimaryToReview:76,partiallyReviewedScopeRows:48,otherPendingPrimaryRows:28,reviewedIdentityMediaLocationPending:16,
  unappliedSemanticFindings:3,confirmed:7,pendingAdded:1,readOnlySources:1,publicationAndRawJsonAndAnalysisPreserved:true,consumptionFile,postFile,dualFile,
  imageComparison:'deferred_by_user',mapCredentialStatus:'rotation_required',userAcceptance:false,failures:[]};
const prd=fs.readFileSync(url('../prd.md'),'utf8'),continuation=fs.readFileSync(url('nine-cities-continuation-20261007.md'),'utf8');const range=/^- 用户最新明确：\*\*云南不处理，继续其他城市直到验收通过\*\*。[^\n]*$/m;assert.ok(range.test(prd));
const nextPrd=prd.replace(range,'- 用户最新明确：**云南不处理，继续其他城市直到验收通过**。九城固定978主体＋56依赖/1135源，183范围待审及4必去缺口。第64批三餐馆地址限定与完整scope已应用，7确认/1裸名待审，华祥地址对应只读待核。济南18行AI自查、76未完成，3项媒体相关文字发现未应用。图片暂缓；天地图凭据待轮换，云南和普通长尾不扩入，未获用户验收。').replace('## 已知事实\n','## 已知事实\n\n### 最新进展：第64批剩余餐馆地址限定\n\n'+progress+'见[第64批记录](research/'+reportFile+')。以下为历史快照。\n');
const nextContinuation=continuation.replace('## 本轮断点\n','## 本轮断点\n\n当前以review44为准。'+progress+'下一实体批次65使用flow67/audit64/review45，不重放64。见['+reportFile+']('+reportFile+')。以下为历史断点。\n');
const fresh=new Map([[reportFile,report],[dir+'review-44.json',json(ledger)],[dir+'review-44.md','# 济南98项重点清单核查台账（第64批）\n\n'+progress+'\n\n| 原名称 | 当前名称 | 版本 | 进度 | 说明 |\n| --- | --- | ---: | --- | --- |\n'+ledger.rows.map(r=>`| ${r.name} | ${r.currentName??r.name} | ${r.currentRevision} | ${r.status} | ${r.followup} |`).join('\n')+'\n'],['cleaning-scope/current-before-batch64.json',json(before)],[dir+'last-restaurants-final-verification-01.json',json(quality)]]);
for(const p of fresh.keys())assert.ok(!fs.existsSync(url(p)),p+'已存在，不可重放');
assert.ok(fs.readFileSync(new URL('../../../spec/server/backend/place-identity.md',import.meta.url),'utf8').includes('## 53.'));
const replace=new Map([['../task.json',json(task)],['../prd.md',nextPrd],['nine-cities-continuation-20261007.md',nextContinuation]]);
for(const kind of ['implement','check']){const p=`../${kind}.jsonl`,entry={file:'.trellis/tasks/10-06-place-identity-governance/research/'+reportFile,reason:'第64批三餐馆地址限定与完整scope，华祥只读待核；review44/flow66/audit63，356分配/133待审、76未完成，不重放，不看图，未验收不提交归档'};const original=fs.readFileSync(url(p),'utf8');assert.ok(!original.includes(entry.file));replace.set(p,original+JSON.stringify(entry)+'\n');}
for(const [p,value]of fresh)fs.writeFileSync(url(p),value,{flag:'wx'});for(const [p,value]of replace)fs.writeFileSync(url(p),value);fs.writeFileSync(url('cleaning-scope/current.json'),json(pointer));
console.log(JSON.stringify({batch:64,ledger:'review-44',fullyReviewed:18,remaining:76,partialScope:48,otherPending:28,identityMediaLocationPending:16,pendingMentions:133,currentReviewRows:183,unappliedFindings:3,stats}));
