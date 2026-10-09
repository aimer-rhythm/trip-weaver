// 已验证的元数据修订登记，不创建提交，不归档或改变任务验收状态。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const url=p=>new URL(p,import.meta.url),read=p=>JSON.parse(fs.readFileSync(url(p),'utf8'));
const json=v=>JSON.stringify(v,null,2)+'\n',dir='priority-cities/济南/',base='metadata/content-dates-01/';
const sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const pointer=read('cleaning-scope/current.json'),before=structuredClone(pointer),ledger=read(dir+'review-29.json'),task=read('../task.json');
assert.equal(pointer.latestAppliedEntityBatch,50);assert.equal(pointer.latestIndependentPhotoBatch,3);
assert.equal(pointer.latestMetadataRefresh,undefined);assert.equal(pointer.latestAudit,'../all-cities/audit/run-48');
assert.equal(pointer.cityReviewLedgers['济南'],'../'+dir+'review-29.json');assert.equal(pointer.userAcceptance,false);
assert.equal(task.status,'in_progress');assert.equal(pointer.taskStatus,'in_progress');assert.deepEqual(pointer.pendingVerification,[]);
assert.equal(pointer.imageComparisonPolicy.status,'deferred_by_user');assert.equal(pointer.unappliedMetadataFindings.length,1);
assert.equal(pointer.unappliedFindings.length,2);assert.equal(sha(url('cleaning-scope/'+pointer.scopeFile)),pointer.scopeSha256);
const frozen=read('cleaning-scope/'+pointer.scopeFile);
assert.deepEqual([frozen.selected.length,frozen.dependencies.length,frozen.sourceIds.length],[978,56,1135]);
assert.deepEqual(ledger.rows.map(r=>[r.entityId,r.name]).sort(),frozen.selected.filter(r=>r.place.city==='济南').map(r=>[r.place.id,r.place.name]).sort());
const preview=read(base+'preview/report.json'),live=read(base+'sync-01/live-check.json'),upstream=read(base+'upstream-check.json'),identity=read(base+'identity-preservation.json');
const consumption=read(base+'sync-01/consumption-1791489596351.json'),state=read(base+'sync-01/state.json');
const audit=read('all-cities/audit/run-49/report.json');
for(const report of [preview,live,upstream,identity,consumption,audit])assert.deepEqual(report.failures,[]);
assert.equal(state.phase,'verified');assert.ok(state.placesImported&&state.relationsImported);assert.equal(state.sourceRevision,24);
assert.equal(sha(url(base+'sync-01/xhs-places-济南.json')),state.placesHash);
assert.equal(sha(url(base+'sync-01/xhs-place-relations-济南.json')),state.relationsHash);
assert.equal(preview.highlightsCorrected,148);assert.equal(preview.entitiesAffected,127);assert.ok(preview.repeatExportDatesStable);
assert.deepEqual(live.counts,{rows:238,exported:228,changedHighlights:148,changedEntities:127,photoFieldsPreserved:90,existingEmbeddingsPreserved:232});
assert.equal(live.pendingEmbeddings,0);assert.equal(live.namesVerified,256);assert.equal(live.trips.count,201);
assert.deepEqual(live.evidence,{rows:524,importTimestampsRefreshed:505,allOtherFieldsPreserved:true});
assert.ok(consumption.repeatImport&&consumption.reverseRollback&&consumption.actualPlaceFactsPreserved);
assert.deepEqual(consumption.media.map(r=>r.count),[3,1,0,0]);assert.deepEqual(consumption.mockEnqueueCalls,{before:2,after:2});assert.equal(consumption.actualEnqueues,0);
assert.equal(upstream.observation.hash,preview.sourceObservations[0].hash);
assert.equal(identity.identityRows,5495);assert.equal(identity.associationCities,10);assert.ok(identity.flowInputUnchanged&&identity.upstreamAuditInputUnchanged);
assert.equal(identity.flowReexecuted,false);assert.equal(audit.cities.reduce((n,c)=>n+(c.statuses.PENDING??0),0),287);
const install=read('upstream-install.json');assert.equal(install.files.length,61);assert.equal(install.files.filter(f=>f.changed).length,3);
for(const f of install.files)for(const p of [url('upstream/'+f.path),'D:/Project/xhs-travel-pipeline/'+f.path])assert.equal(sha(p),f.after);
assert.match(fs.readFileSync(url('upstream-full-place_identity_test_1791489338306.log'),'utf8'),/668 passed/);
assert.match(fs.readFileSync(url('upstream-installed-place_identity_test_1791489418926.log'),'utf8'),/668 passed/);
assert.match(fs.readFileSync(url('downstream-place_identity_test_1791489587689.log'),'utf8'),/pass 1/);
const at=new Date().toISOString(),reportFile='metadata01-content-dates-20261009.md';assert.ok(fs.existsSync(url(reportFile)));
const progress='元数据01已安装并同步：两导出路径旧reason补传原来源日期，济南148看点/127实体observedAt修复，两次导出稳定。无实体/scope/分配改动，实体50/图片03保持；61文件安装仅2入口及1测试变化，暂存全套668/安装后668通过。真实双导入两轮及4审计倒序回滚通过；238旧行/232向量、524语料内容、90图片字段/9绑定和201行程保持，505语料fetched_at按既有导入时间刷新，图库3/1及两无图结果不变，mock回调前后各2、真实入队0。256名称旧ID检查、222有效主体向量就绪，日期不改向量输入，无需重算。242原源/806提及及实体/分配指纹保持；228地点/18关系/direct3、来源revision24不变。新audit49仍287PENDING，5495身份行和10城关系输入与flow52相同，未重复跑flow。全仓/扩展typecheck通过。review30仍98行：4非地点、18行AI自查、76未完成（22部分scope、54其余）；107提及待审、157范围审核/4必去缺口。日期发现已解决，2商业文字发现不变；图片暂缓、云南不主动清洗，未验收不提交归档。';
const originalRows=structuredClone(ledger.rows);
ledger.createdAt=at;ledger.previousLedger=dir+'review-29.json';
Object.assign(ledger.summary,{unappliedMetadataFindings:0,resolvedMetadataFindings:1,
  fullyReviewedMeaning:'18原入选行对应16现行主体；元数据01修复日期但不增加地点完整自查，图片与未决位置仍待核，用户未验收。',
  scopeProgressMeaning:'98行保留：4非地点、18行AI自查、76未完成（22部分scope、54其余）；157正式范围审核、4必去缺口，2项商业文字发现未应用，日期元数据发现已同步修复。'});
assert.deepEqual(ledger.rows,originalRows);assert.equal(ledger.summary.fullyReviewed,18);assert.equal(ledger.summary.remainingPrimaryToReview,76);
assert.equal(ledger.summary.unappliedSemanticFindings,2);
const finding=pointer.unappliedMetadataFindings[0];
pointer.unappliedMetadataFindings=[];
pointer.resolvedMetadataFindings=[{...finding,status:'resolved_metadata01',resolvedAt:at,productionFixApplied:true,
  resolvedEvidence:'../'+base+'sync-01/live-check.json',repeatExportEvidence:'../'+base+'preview/report.json',
  reason:'旧reason分支已传递原来源日期，济南148看点已双同步且重复导出稳定；原始来源日期不改写。'}];
pointer.latestMetadataRefresh={run:1,kind:'legacy_content_dates',afterEntityBatch:50,city:'济南',sourceRevision:24,
  state:'../'+base+'sync-01/state.json',evidence:'../'+base+'sync-01/live-check.json',verifiedAt:at};
pointer.latestAudit='../all-cities/audit/run-49';pointer.cityReviewLedgers['济南']='../'+dir+'review-30.json';
pointer.progressNote=progress;pointer.progressUpdatedAt=at;
assert.deepEqual(pointer.unappliedFindings,before.unappliedFindings);assert.deepEqual(pointer.currentScopeReviews,before.currentScopeReviews);
assert.deepEqual(pointer.summary,before.summary);assert.equal(pointer.latestFlow,before.latestFlow);
task.notes=progress+'见research/'+reportFile+'。';
const prd=fs.readFileSync(url('../prd.md'),'utf8'),continuation=fs.readFileSync(url('nine-cities-continuation-20261007.md'),'utf8');
const range=/^- 用户最新明确：\*\*云南不处理，继续其他城市直到验收通过\*\*。[^\n]*$/m;
assert.ok(range.test(prd)&&prd.includes('## 已知事实\n')&&continuation.includes('## 本轮断点\n'));
const nextPrd=prd.replace(range,'- 用户最新明确：**云南不处理，继续其他城市直到验收通过**。九城固定978主体＋56依赖/1135源，157范围内待审及4必去缺口。实体第50批及元数据01已同步，图片比对暂缓；济南18行AI自查、76未完成；2项商业文字发现待处理，148看点日期问题已修复。云南、89普通长尾和37已隔离错城来源归属不扩入主动范围，未获用户验收。')
  .replace('## 已知事实\n','## 已知事实\n\n### 最新进展：元数据01旧看点来源日期\n\n'+progress+'见[元数据01记录](research/'+reportFile+')。以下为历史快照。\n');
const nextContinuation=continuation.replace('## 本轮断点\n','## 本轮断点\n\n当前review30、实体50/元数据01/图片03、flow52/audit49。'+progress+'下一实体批次51使用flow53/audit50。见['+reportFile+']('+reportFile+')。以下为历史断点。\n');
const fresh=new Map([
  ['cleaning-scope/current-before-metadata01.json',json(before)],
  [dir+'review-30.json',json(ledger)],
  [dir+'review-30.md','# 济南98项重点清单核查台账（元数据01）\n\n'+progress+'\n\n逐行状态与review29相同。\n\n| 原名称 | 当前名称 | 版本 | 进度 | 说明 |\n| --- | --- | ---: | --- | --- |\n'+ledger.rows.map(r=>`| ${r.name} | ${r.currentName??r.name} | ${r.currentRevision} | ${r.status} | ${r.followup} |`).join('\n')+'\n'],
  [base+'final-verification.json',json({metadataRun:1,at,entityBatch:50,photoBatch:3,review:'review-30',
    stagedFullTests:668,installedFullTests:668,installedFiles:61,rootTypecheck:true,extendedTypecheck:true,
    counts:live.counts,evidence:live.evidence,repeatExportStable:true,reverseRollback:true,
    audit:'run-49',flowReused:'run-52',flowInputUnchanged:true,remainingPrimaryToReview:76,unappliedSemanticFindings:2,
    unappliedMetadataFindings:0,imageComparison:'deferred_by_user',taskStatus:'in_progress',userAcceptance:false})],
]);
for(const p of fresh.keys())assert.ok(!fs.existsSync(url(p)),p+'已存在，不可重放');
const replace=new Map([['../task.json',json(task)],['../prd.md',nextPrd],['nine-cities-continuation-20261007.md',nextContinuation]]);
for(const kind of ['implement','check']) {
  const p=`../${kind}.jsonl`,entry={file:'.trellis/tasks/10-06-place-identity-governance/research/'+reportFile,
    reason:'元数据01日期已修复双同步，review30/实体50/flow52/audit49；668全套和实城导入回滚通过，不重放，仍76行未完成'};
  const original=fs.readFileSync(url(p),'utf8');assert.ok(!original.includes(entry.file));replace.set(p,original+JSON.stringify(entry)+'\n');
}
for(const [p,value]of fresh)fs.writeFileSync(url(p),value,{flag:'wx'});
for(const [p,value]of replace)fs.writeFileSync(url(p),value);
fs.writeFileSync(url('cleaning-scope/current.json'),json(pointer));
console.log(JSON.stringify({metadataRun:1,entityBatch:50,review:'review-30',audit:'run-49',flow:'run-52',remaining:76,unappliedMetadata:0,userAcceptance:false}));
