// 仅记录经实际证据核验的工作断点；不提交、归档或标记完成。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const url=p=>new URL(p,import.meta.url);
const read=p=>JSON.parse(fs.readFileSync(url(p),'utf8'));
const write=(p,data,fresh=true)=>fs.writeFileSync(url(p),JSON.stringify(data,null,2)+'\n',{flag:fresh?'wx':'w'});
const dir='priority-cities/济南/',batch='all-cities/batch-42/',eid='550d6810857b4487aae8ce39c9ee093b';
const pointer=read('cleaning-scope/current.json');
assert.equal(pointer.latestAppliedEntityBatch,41);
assert.equal(pointer.cityReviewLedgers['济南'],'../'+dir+'review-20.json');
assert.equal(pointer.latestIndependentPhotoBatch,3);
assert.equal(pointer.userAcceptance,false);assert.equal(pointer.imageComparisonPolicy.status,'deferred_by_user');
assert.deepEqual(pointer.pendingVerification,[]);assert.deepEqual(pointer.unappliedFindings,[]);
const applied=read('all-cities/batch-42-applied.json');assert.equal(applied.apply,true);assert.equal(applied.changes.length,1);
const sync=read(batch+'sync-01/sync-state.json').cities['济南'];
assert.ok(sync.importedAt&&sync.relationsImportedAt&&sync.embeddingRunAt);assert.equal(sync.relationSnapshotRevision,16);
const actual=read(dir+'daminghu-downstream-check-01.json');
assert.deepEqual(actual.failures,[]);assert.equal(actual.consumedFieldsVerified,228);
assert.equal(actual.sqlProbes.length,3);assert.equal(actual.effectiveMinutes,120);assert.equal(actual.pendingMentions,77);
const consumption=read(batch+'sync-01/daminghu-consumption-1791480045281.json');
assert.deepEqual(consumption.failures,[]);assert.equal(consumption.actualPlaceFactsMinutes,120);
assert.equal(consumption.independentSubjectBoundaries,true);
const projections=read(dir+'daminghu-fact-projection-check-01.json');
assert.deepEqual(projections.failures,[]);assert.equal(projections.pendingProjectionEmpty.length,17);
assert.equal(projections.boatDescriptionRetained,true);assert.equal(projections.relationDowngrades.length,2);
for(const file of ['all-cities/batch-42-upstream-check.json',batch+'sync-01/verification-vectors.json',batch+'sync-01/post-import-check-1791479840159.json'])
  assert.deepEqual(read(file).failures,[]);
const isolated=read(batch+'scope-preview-1791479648469343400/report.json');
assert.ok(isolated.reverseRollback&&isolated.idempotent&&isolated.threeAliasesPreserved);
assert.equal(isolated.pendingAdded,17);assert.equal(isolated.existingReviewsPreserved,3);
const imported=read(batch+'sync-01/preview-济南/preview-1791479751371.json');assert.equal(imported.reverseRollback,true);
const flow=read('all-cities/flow/run-44/report.json'),audit=read('all-cities/audit/run-40/report.json');
assert.deepEqual(flow.failures,[]);assert.deepEqual(audit.failures,[]);
assert.equal(read('all-cities/flow/run-44/cleanup.json').removed,true);
assert.match(fs.readFileSync(url('upstream-installed-place_identity_test_1791479389123.log'),'utf8'),/593 passed/);
assert.match(fs.readFileSync(url('downstream-place_identity_test_1791480039570.log'),'utf8'),/pass 1/);
const install=read('upstream-install.json');assert.equal(install.apply,true);
for(const item of install.files) {
  const digest=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  assert.equal(item.after,digest(url('upstream/'+item.path)));
  assert.equal(item.after,digest('D:/Project/xhs-travel-pipeline/'+item.path));
}
const stats={positive:flow.cities.reduce((n,c)=>n+c.probes.length,0),boundaries:flow.cities.reduce((n,c)=>n+c.negativeProbes.length,0),
  withdrawals:flow.cities.reduce((n,c)=>n+c.withdrawalProbes.length,0),pending:audit.cities.reduce((n,c)=>n+(c.statuses.PENDING??0),0)};
assert.deepEqual(stats,{positive:291,boundaries:113,withdrawals:47,pending:257});
const ledger=read(dir+'review-20.json'),beforeIds=ledger.rows.map(r=>r.entityId);
const scope=read('all-cities/batch-42-scope-decisions.json')[0];
const row=ledger.rows.find(r=>r.entityId===eid);assert.ok(row);assert.equal(row.status,'pending');
const confirmed=scope.assignments.filter(a=>a.entityId).map(a=>a.mentionId),pending=scope.assignments.filter(a=>!a.entityId).map(a=>a.mentionId);
assert.equal(confirmed.length,48);assert.equal(pending.length,17);
Object.assign(row,{currentName:'大明湖',currentRevision:3,changeBatch:42,reviewBatch:42,status:'reviewed_scope_partial',
  governedSourceIds:[5348,5953,5968],scopeMentionIds:scope.assignments.map(a=>a.mentionId),currentMentionIds:confirmed,pendingScopeMentionIds:pending,
  dimensions:{...row.dimensions,identity:'three_aliases_preserved_48_confirmed_17_pending',category:'nature_confirmed',
    location:'existing_coordinates_preserved_review_pending',media:'deferred_by_user',consumedFacts:'boat_30_minutes_excluded_effective_120_confirmed'},
  mediaBoundary:'本批未查看或比对图片；导入前无图片字段和独立绑定，不代表独立原图目录不存在或视觉验收通过。',
  followup:'第42批完整三源scope已双同步，三名及历史ID保持，48确认/17待审；船上30分钟排除，实际时长120分钟。两条关系因正文位置绑定不足降为weak。精确位置和媒体仍未完成自查，不计验收通过。',
  evidenceFiles:[...new Set([...(row.evidenceFiles??[]),dir+'daminghu-source-review-01.json',dir+'daminghu-downstream-check-01.json',
    dir+'daminghu-fact-projection-check-01.json','all-cities/batch-42-applied.json','all-cities/batch-42-upstream-check.json',
    batch+'sync-01/verification-vectors.json',batch+'sync-01/daminghu-consumption-1791480045281.json'])]});
assert.deepEqual(ledger.rows.map(r=>r.entityId),beforeIds);assert.equal(ledger.rows.length,98);
assert.equal(ledger.rows.filter(r=>['reviewed_identity','reviewed_same_entity','reviewed_alias_redirect'].includes(r.status)).length,19);
assert.equal(ledger.rows.filter(r=>['reviewed_scope_partial','mixed_source_withdrawn_assignment_pending'].includes(r.status)).length,10);
ledger.createdAt=new Date().toISOString();ledger.previousLedger=dir+'review-20.json';
Object.assign(ledger.summary,{partiallyReviewedScopeRows:10,otherPendingPrimaryRows:65,governedScopeMentions:218,pendingScopeMentions:77,
  confirmedDaminghuMentions:48,unappliedSemanticFindings:0,
  fullyReviewedMeaning:'AI自查19原入选行对应17现行主体；第42批新增完整自查0，用户未验收。',
  scopeProgressMeaning:'98行保留：4非地点、19行AI自查、75未完成，其中10行部分scope治理、其余65继续；127范围内审核行和4必去缺口。'});
const progress='第42批大明湖三源65提及/54篇全文完整scope已应用并双同步：48确认、17待审，三名称/三个历史ID/自然类别/原坐标保持，revision3；12700船上30分钟排除而描述保留，实际导出与placeFacts时长120分钟。228地点/20关系，来源revision16；两条大明湖关系因多次同名位置绑定不足降为weak，direct由9降7。593上游全套、真实上下游导入/回滚、3别名SQL/真实向量及根ID边界、全仓和扩展typecheck通过；107原源/662提及/82原文、238旧行/51既有图片字段/9绑定及201历史行程保持。flow44为291正例/113边界/47撤回0失败，audit40为257PENDING。review21仍98行：4非地点、19行AI自查、75未完成，其中10行部分scope；范围内审核127行、4必去缺口。实体42/独立图片03，无未同步或向量待复核。图片暂不比对、云南不处理；继续17条待审、位置及剩余重点。未验收，不提交归档。';
// 所有输出路径和后续替换标记先检查，再写工作记录。
const fresh=[dir+'review-21.json',dir+'review-21.md','cleaning-scope/current-before-batch42.json',dir+'daminghu-final-verification-01.json'];
for(const file of fresh)assert.ok(!fs.existsSync(url(file)),`不能覆盖${file}`);
const documents=[
  ['../prd.md','## 已知事实\n','\n### 最新进展：第42批大明湖三源与活动时长治理\n\n'+progress+'见[第42批记录](research/batch42-jinan-daminghu-20261009.md)。以下为历史快照。\n'],
  ['nine-cities-continuation-20261007.md','## 本轮断点\n','\n当前以review21为准。'+progress+'后续新回归flow45/audit41；禁止重放已应用批次。以下为历史断点。\n']];
for(const [file,marker]of documents)assert.ok(fs.readFileSync(url(file),'utf8').includes(marker));
const task=read('../task.json');assert.equal(task.status,'in_progress');
write(dir+'review-21.json',ledger);
fs.writeFileSync(url(dir+'review-21.md'),'# 济南98项重点清单核查台账（第42批）\n\n'+progress+'\n\n| 原入选名称 | 当前名称 | 版本 | 进度 | 说明 |\n| --- | --- | ---: | --- | --- |\n'+ledger.rows.map(r=>`| ${r.name} | ${r.currentName??r.name} | ${r.currentRevision} | ${r.status} | ${r.followup} |`).join('\n')+'\n',{flag:'wx'});
write('cleaning-scope/current-before-batch42.json',pointer);
Object.assign(pointer,{latestAppliedEntityBatch:42,latestFlow:'../all-cities/flow/run-44',latestAudit:'../all-cities/audit/run-40',
  progressNote:progress,progressUpdatedAt:ledger.createdAt,
  latestReviewEvidence:{file:'../'+dir+'daminghu-downstream-check-01.json',fullReviewsAdded:0,partiallyReviewed:1}});
pointer.cityReviewLedgers['济南']='../'+dir+'review-21.json';
Object.assign(pointer.currentScopeReviews,{addedPendingMentions:77,currentReviewRows:127,
  meaning:'50重点实体对仍待审；五龙潭18、趵突泉38、泉城广场3、刘氏泉摄影主体1及大明湖17条scope保持null，固定scope06统计不作实时队列。'});
pointer.currentScopeReviews.evidence.push('../'+dir+'daminghu-source-review-01.json');
pointer.resolvedFindings.push({entityId:eid,name:'大明湖',sourceIds:[5348,5953,5968],mentionIds:confirmed,pendingMentionIds:pending,
  status:'resolved_scenic_scope_and_boat_duration_batch42',resolvedByEntityBatch:42,
  evidence:'../'+dir+'daminghu-downstream-check-01.json',fullReviewPassed:false,locationPending:true});
write('cleaning-scope/current.json',pointer,false);
task.notes=progress+'见research/batch42-jinan-daminghu-20261009.md。';write('../task.json',task,false);
for(const [file,marker,insert]of documents) {
  let content=fs.readFileSync(url(file),'utf8').replace(marker,marker+insert);
  if(file==='../prd.md')content=content.replace('第41批已双同步，图片比对暂缓','第42批已双同步，图片比对暂缓');
  fs.writeFileSync(url(file),content);
}
for(const kind of ['implement','check']) {
  const file=url(`../${kind}.jsonl`),entry={file:'.trellis/tasks/10-06-place-identity-governance/research/batch42-jinan-daminghu-20261009.md',
    reason:'第42批已双同步，大明湖48确认/17待审、三别名及120分钟消费通过；review21仍75未完成，图片暂缓，不重放'};
  assert.ok(!fs.readFileSync(file,'utf8').includes(entry.file));fs.appendFileSync(file,JSON.stringify(entry)+'\n');
}
write(dir+'daminghu-final-verification-01.json',{batch:42,at:ledger.createdAt,stats,fullUpstreamTests:593,
  fullReviewsAdded:0,remainingPrimaryToReview:75,partiallyReviewed:10,currentScopeReviewRows:127,
  imageComparison:'deferred_by_user',userAcceptance:false,rootTypecheck:true,extendedTypecheck:true});
console.log(JSON.stringify({ledger:'review-21',fullyReviewed:19,remaining:75,partiallyReviewed:10,stats,entityBatch:42}));
