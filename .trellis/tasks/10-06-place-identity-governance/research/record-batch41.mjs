// 仅更新经证据核验的工作断点；不提交、归档或标记任务完成。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const url=p=>new URL(p,import.meta.url);
const read=p=>JSON.parse(fs.readFileSync(url(p),'utf8'));
const write=(p,data,fresh=true)=>fs.writeFileSync(url(p),JSON.stringify(data,null,2)+'\n',{flag:fresh?'wx':'w'});
const dir='priority-cities/济南/', batch='all-cities/batch-41/', eid='2c8372d3a47dbcb68abd998af495436d';
const pointer=read('cleaning-scope/current.json');
assert.equal(pointer.latestAppliedEntityBatch,40);
assert.equal(pointer.cityReviewLedgers['济南'],'../'+dir+'review-19.json');
assert.equal(pointer.latestIndependentPhotoBatch,3);
assert.equal(pointer.userAcceptance,false); assert.equal(pointer.imageComparisonPolicy.status,'deferred_by_user');
const applied=read('all-cities/batch-41-applied.json'); assert.equal(applied.apply,true); assert.equal(applied.changes.length,2);
const sync=read(batch+'sync-01/sync-state.json').cities['济南'];
assert.ok(sync.importedAt && sync.relationsImportedAt && sync.embeddingRunAt);
const actual=read(dir+'platform-downstream-check-01.json');
assert.deepEqual(actual.failures,[]); assert.equal(actual.consumedFieldsVerified,228);
assert.equal(actual.foodQueryExcluded,true); assert.equal(actual.bareCafeNameCannotBind,true);
const consumption=read(batch+'sync-01/platform-consumption-1791478328214.json');
assert.deepEqual(consumption.failures,[]); assert.equal(consumption.actualPlaceFactsType,'photo_spot');
assert.equal(consumption.oldFoodHitConfirmed,true); assert.equal(consumption.afterFoodExcluded,true);
assert.equal(consumption.visitWeight,1); assert.equal(consumption.automaticGeoSchedulingCovered,false);
for(const file of ['all-cities/batch-41-upstream-check.json',batch+'sync-01/verification-vectors.json',batch+'sync-01/post-import-check-1791478136108.json'])
  assert.deepEqual(read(file).failures,[]);
const isolated=read(batch+'scope-preview-1791477937038516500/report.json');
assert.ok(isolated.reverseRollback && isolated.idempotent && isolated.bareCafeNameNotAlias);
const flow=read('all-cities/flow/run-43/report.json'),audit=read('all-cities/audit/run-39/report.json');
assert.deepEqual(flow.failures,[]); assert.deepEqual(audit.failures,[]);
assert.equal(read('all-cities/flow/run-43/cleanup.json').removed,true);
assert.match(fs.readFileSync(url('upstream-installed-place_identity_test_1791477882585.log'),'utf8'),/587 passed/);
assert.match(fs.readFileSync(url('downstream-place_identity_test_1791478322812.log'),'utf8'),/pass 1/);
const install=read('upstream-install.json'); assert.equal(install.apply,true);
for(const item of install.files) {
  const digest=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  assert.equal(item.after,digest(url('upstream/'+item.path)));
  assert.equal(item.after,digest('D:/Project/xhs-travel-pipeline/'+item.path));
}
const stats={positive:flow.cities.reduce((n,c)=>n+c.probes.length,0),boundaries:flow.cities.reduce((n,c)=>n+c.negativeProbes.length,0),
  withdrawals:flow.cities.reduce((n,c)=>n+c.withdrawalProbes.length,0),pending:audit.cities.reduce((n,c)=>n+(c.statuses.PENDING??0),0)};
assert.deepEqual(stats,{positive:291,boundaries:113,withdrawals:47,pending:240});
const ledger=read(dir+'review-19.json'),beforeIds=ledger.rows.map(r=>r.entityId);
const row=ledger.rows.find(r=>r.entityId===eid); assert.ok(row); assert.equal(row.status,'pending');
Object.assign(row,{currentName:'尚泉尚水茶馆前平台',currentRevision:4,changeBatch:41,reviewBatch:41,status:'reviewed_scope_partial',
  governedSourceIds:[5945],scopeMentionIds:[12653],currentMentionIds:[12653],pendingScopeMentionIds:[],
  dimensions:{...row.dimensions,identity:'platform_scope_confirmed_bare_cafe_excluded',category:'photo_spot_nature_confirmed',
    location:'wrong_point_cleared_position_pending',media:'deferred_by_user',consumedFacts:'photo_spot_type_and_valid_photography_description_confirmed'},
  mediaBoundary:'图片比对依用户要求暂缓；数据库空图库与字段不变不代表视觉核查。',
  followup:'第41批完整scope及主名/细分类修订已双同步，原ID/revision4、唯一12653及摄影描述保留；裸茶馆名即使带旧ID也不绑定平台，餐饮筛选排除。精确机位仍未知，图片比对暂缓，完整自查未通过。',
  evidenceFiles:[...new Set([...(row.evidenceFiles??[]),dir+'platform-source-review-01.json',dir+'platform-downstream-check-01.json',
    'all-cities/batch-41-applied.json','all-cities/batch-41-upstream-check.json',batch+'sync-01/verification-vectors.json',
    batch+'sync-01/platform-consumption-1791478328214.json'])]});
assert.deepEqual(ledger.rows.map(r=>r.entityId),beforeIds); assert.equal(ledger.rows.length,98);
assert.equal(ledger.rows.filter(r=>['reviewed_identity','reviewed_same_entity','reviewed_alias_redirect'].includes(r.status)).length,19);
assert.equal(ledger.rows.filter(r=>['reviewed_scope_partial','mixed_source_withdrawn_assignment_pending'].includes(r.status)).length,9);
ledger.createdAt=new Date().toISOString(); ledger.previousLedger=dir+'review-19.json';
Object.assign(ledger.summary,{partiallyReviewedScopeRows:9,otherPendingPrimaryRows:66,governedScopeMentions:153,unappliedSemanticFindings:0,
  fullyReviewedMeaning:'AI自查19原入选行对应17现行主体；第41批新增完整自查0，用户未验收。',
  scopeProgressMeaning:'98行保留：4非地点、19行AI自查、75未完成，其中9行部分scope治理、其余66继续；110范围内审核行和4必去缺口保持。'});
const progress='第41批尚泉尚水茶馆前平台已完成完整scope、主名及photo_spot/自然细分类修订与228地点/20关系双同步，保留原ID、12653提及与摄影描述，revision4、精确坐标仍null。实际餐饮筛选排除、平台名SQL/真实向量、茶馆裸名+旧ID拒绝及排程细分类消费通过。587上游全套、真实上下游导入/回滚、全仓及扩展typecheck通过；107原源/662提及/82原文、238旧行/48既有图片字段/9绑定与201历史行程保持。flow43为291正例/113边界/47撤回0失败，audit39为240PENDING。review20仍98行：4非地点、19行AI自查、75未完成，其中9行部分scope治理；110正式待审及4必去缺口保持。实体41/独立图片03，无未同步或向量待复核。图片暂不比对、云南不处理；位置与剩余重点继续。未验收，不提交归档。';
write(dir+'review-20.json',ledger);
fs.writeFileSync(url(dir+'review-20.md'),'# 济南98项重点清单核查台账（第41批）\n\n'+progress+'\n\n| 原入选名称 | 当前名称 | 版本 | 进度 | 说明 |\n| --- | --- | ---: | --- | --- |\n'+ledger.rows.map(r=>`| ${r.name} | ${r.currentName??r.name} | ${r.currentRevision} | ${r.status} | ${r.followup} |`).join('\n')+'\n',{flag:'wx'});
write('cleaning-scope/current-before-batch41.json',pointer);
Object.assign(pointer,{latestAppliedEntityBatch:41,latestFlow:'../all-cities/flow/run-43',latestAudit:'../all-cities/audit/run-39',
  progressNote:progress,progressUpdatedAt:ledger.createdAt,
  latestReviewEvidence:{file:'../'+dir+'platform-downstream-check-01.json',fullReviewsAdded:0,partiallyReviewed:1}});
pointer.cityReviewLedgers['济南']='../'+dir+'review-20.json';
assert.equal(pointer.unappliedFindings.filter(f=>f.entityId===eid).length,1);
pointer.unappliedFindings=pointer.unappliedFindings.filter(f=>f.entityId!==eid);
pointer.resolvedFindings.push({entityId:eid,name:row.currentName,sourceId:5945,mentionIds:[12653],
  status:'resolved_platform_identity_and_type_batch41',resolvedByEntityBatch:41,
  evidence:'../'+dir+'platform-downstream-check-01.json',fullReviewPassed:false,locationPending:true});
assert.deepEqual(pointer.pendingVerification,[]); write('cleaning-scope/current.json',pointer,false);
const task=read('../task.json'); assert.equal(task.status,'in_progress');
task.notes=progress+'见research/batch41-jinan-platform-20261009.md。'; write('../task.json',task,false);
for(const [file,marker,insert] of [
  ['../prd.md','## 已知事实\n','\n### 最新进展：第41批平台身份与细分类修订\n\n'+progress+'见[第41批记录](research/batch41-jinan-platform-20261009.md)。以下为历史快照。\n'],
  ['nine-cities-continuation-20261007.md','## 本轮断点\n','\n当前以review20为准。'+progress+'后续新回归flow44/audit40；禁止重放已应用批次。以下为历史断点。\n']]) {
  let content=fs.readFileSync(url(file),'utf8'); assert.ok(content.includes(marker)); content=content.replace(marker,marker+insert);
  if(file==='../prd.md') content=content.replace('第40批已双同步，图片比对暂缓','第41批已双同步，图片比对暂缓');
  fs.writeFileSync(url(file),content);
}
for(const kind of ['implement','check']) {
  const file=url(`../${kind}.jsonl`),entry={file:'.trellis/tasks/10-06-place-identity-governance/research/batch41-jinan-platform-20261009.md',
    reason:'第41批已双同步，前平台名称/细分类消费通过；位置未知、图片比对暂缓；review20仍75未完成，不重放已应用批次'};
  assert.ok(!fs.readFileSync(file,'utf8').includes(entry.file)); fs.appendFileSync(file,JSON.stringify(entry)+'\n');
}
write(dir+'platform-final-verification-01.json',{batch:41,at:ledger.createdAt,stats,fullUpstreamTests:587,
  fullReviewsAdded:0,remainingPrimaryToReview:75,partiallyReviewed:9,imageComparison:'deferred_by_user',userAcceptance:false,
  rootTypecheck:true,extendedTypecheck:true,automaticGeoSchedulingCovered:false});
console.log(JSON.stringify({ledger:'review-20',fullyReviewed:19,remaining:75,partiallyReviewed:9,stats,entityBatch:41}));
