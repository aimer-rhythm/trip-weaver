// 第49批成功证据登记；无提交、归档和验收状态变更。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const url=p=>new URL(p,import.meta.url),read=p=>JSON.parse(fs.readFileSync(url(p),'utf8'));
const write=(p,v,fresh=true)=>fs.writeFileSync(url(p),JSON.stringify(v,null,2)+'\n',{flag:fresh?'wx':'w'});
const dir='priority-cities/济南/',batch='all-cities/batch-49/',at=new Date().toISOString(),eid='c9c9ce7c33c95b71b859f0ab30bf7136';
const pointer=read('cleaning-scope/current.json');
assert.equal(pointer.latestAppliedEntityBatch,48);assert.equal(pointer.cityReviewLedgers['济南'],'../'+dir+'review-27.json');
assert.equal(pointer.userAcceptance,false);assert.equal(pointer.taskStatus,'in_progress');assert.equal(pointer.imageComparisonPolicy.status,'deferred_by_user');
assert.equal(pointer.latestIndependentPhotoBatch,3);assert.deepEqual(pointer.pendingVerification,[]);assert.equal(pointer.unappliedFindings.length,2);
const applied=read('all-cities/batch-49-applied.json');assert.equal(applied.apply,true);assert.equal(applied.changes.length,1);
const sync=read(batch+'sync-01/sync-state.json').cities['济南'];assert.ok(sync.importedAt&&sync.relationsImportedAt&&sync.embeddingRunAt);assert.equal(sync.relationSnapshotRevision,23);
assert.equal(createHash('sha256').update(fs.readFileSync(url('all-cities/batch-49-source.json'))).digest('hex'),'efba37b97e0274256f38b7f7584e0453c61d111cb3db90c4d9184857a2394f3d');
const actual=read(dir+'qushui-downstream-check-01.json');assert.equal(actual.consumedFieldsVerified,228);assert.equal(actual.assignmentRows,268);
assert.equal(actual.pendingMentions,107);assert.equal(actual.partialHighlightExclusions,2);assert.equal(actual.sqlProbes,2);assert.equal(actual.realVectorProbes,1);
assert.equal(actual.relationVersionOnlyChanges,6);assert.equal(actual.boundaryProbes,36);
const consumption=read(batch+'sync-01/qushui-consumption-1791487700416.json');
assert.ok(consumption.actualPlaceFacts&&consumption.mixedHighlightsRemoved&&consumption.remainingHighlightsPreserved&&consumption.independentSourceDigestUnchanged);
assert.deepEqual(consumption.media.map(r=>r.count),[3,1]);assert.equal(consumption.queued,0);
const post=read(batch+'sync-01/post-import-check-1791487614841.json');assert.equal(post.cities[0].photoFieldsPreserved,90);assert.equal(post.cities[0].oldRowsPreserved,238);
const isolated=read(batch+'scope-preview-1791487509203412800/report.json');assert.ok(isolated.idempotent&&isolated.reverseRollback&&isolated.existingScopeAndAssignmentsRestored);
const flow=read('all-cities/flow/run-51/report.json'),audit=read('all-cities/audit/run-47/report.json');
for(const r of [actual,consumption,post,isolated,flow,audit,read('all-cities/batch-49-upstream-check.json'),read(batch+'sync-01/verification-vectors.json')])assert.deepEqual(r.failures,[]);
assert.equal(read('all-cities/flow/run-51/cleanup.json').removed,true);
assert.match(fs.readFileSync(url('downstream-place_identity_test_1791487695381.log'),'utf8'),/pass 1/);
assert.match(fs.readFileSync(url('upstream-stage-place_identity_test_1791487507970.log'),'utf8'),/"reverseRollback": true/);
const stats={positive:flow.cities.reduce((n,c)=>n+c.probes.length,0),boundaries:flow.cities.reduce((n,c)=>n+c.negativeProbes.length,0),
  withdrawals:flow.cities.reduce((n,c)=>n+c.withdrawalProbes.length,0),pending:audit.cities.reduce((n,c)=>n+(c.statuses.PENDING??0),0)};
assert.deepEqual(stats,{positive:301,boundaries:113,withdrawals:47,pending:287});
const install=read('upstream-install.json');assert.equal(install.apply,true);assert.equal(install.files.length,60);
for(const f of install.files)for(const p of [url('upstream/'+f.path),'D:/Project/xhs-travel-pipeline/'+f.path])assert.equal(createHash('sha256').update(fs.readFileSync(p)).digest('hex'),f.after);
const ledger=read(dir+'review-27.json'),originalRows=ledger.rows.map(r=>[r.entityId,r.name]);
const scope=read('all-cities/batch-49-scope-decisions.json')[0],row=ledger.rows.find(r=>r.entityId===eid);
assert.equal(row.currentRevision,3);assert.equal(row.status,'reviewed_scope_partial');assert.equal(row.currentMentionIds.length,44);
Object.assign(row,{currentRevision:4,changeBatch:49,reviewBatch:49,currentMentionIds:scope.assignments.filter(a=>a.entityId).map(a=>a.mentionId),
  pendingScopeMentionIds:scope.assignments.filter(a=>!a.entityId).map(a=>a.mentionId),
  dimensions:{...row.dimensions,consumedFacts:'partial_highlights_recovered_street_only_independent_50_preserved'},
  followup:'第49批两条曲水亭街提及排除起凤桥机位，街道看点和有效引文保留，46确认/10待审已同步；原名/ID/坐标及50分钟保持。图片与位置待核，仍部分治理。',
  evidenceFiles:[...row.evidenceFiles,dir+'qushui-source-review-01.json',dir+'qushui-downstream-check-01.json',batch+'sync-01/qushui-consumption-1791487700416.json']});
assert.deepEqual(ledger.rows.map(r=>[r.entityId,r.name]),originalRows);
assert.equal(ledger.rows.filter(r=>['reviewed_scope_partial','mixed_source_withdrawn_assignment_pending'].includes(r.status)).length,22);
assert.equal(ledger.rows.filter(r=>['pending','reviewed_identity_media_location_pending'].includes(r.status)).length,54);
ledger.createdAt=at;ledger.previousLedger=dir+'review-27.json';
Object.assign(ledger.summary,{pendingScopeMentions:107,confirmedQushuitingMentions:46,
  fullyReviewedMeaning:'18原入选行对应16现行主体；第49批新增完整自查0，曲水亭街保持部分scope，用户未验收。',
  scopeProgressMeaning:'98行保留：4非地点、18行AI自查、76未完成（22部分scope、54其余）；157正式范围审核、4必去缺口，余2项商业文字发现未应用。'});
const progress='第49批曲水亭街已有联合scope两源56提及/45全文再审已同步；11369/12610排除起凤桥机位reason及看点1，保留街道看点0和有效引文，44确认/12待审变46确认/10待审，其余54条策略保持。scope1→2、根3→4，原名/ID/坐标/50分钟保持；百花洲12946仍待审。济南107待审、157正式范围审核/4必去缺口。228地点/18关系/direct3、来源revision23；6关系仅端点版本变化。2SQL/1真实向量/36边界、268新旧分配及13审核、隔离SQL/导出/幂等/原scope回滚、实际事实和双导入通过。107原源/662提及/82全文、238旧行/90图片字段/9绑定及201行程保持，老商埠3图/经三路1图旧消费不变，未查看图片；无生产安装。flow51为301正例/113边界/47撤回0失败，audit47为287PENDING，全仓及扩展typecheck通过。review28仍98行：4非地点、18行AI自查、76未完成（22部分scope、54其余）；两商业文字发现仍未应用。实体49/图片03，无未同步或向量待核；图片暂缓、云南不处理，未验收不提交归档。';
const docs=[['../prd.md','## 已知事实\n','\n### 最新进展：第49批曲水亭街混合看点再审\n\n'+progress+'见[第49批记录](research/batch49-jinan-qushui-20261009.md)。以下为历史快照。\n'],
  ['nine-cities-continuation-20261007.md','## 本轮断点\n','\n当前以review28为准。'+progress+'下一实体批次50使用flow52/audit48。以下为历史断点。\n']];
for(const [p,marker]of docs)assert.ok(fs.readFileSync(url(p),'utf8').includes(marker));
for(const p of [dir+'review-28.json',dir+'review-28.md','cleaning-scope/current-before-batch49.json',dir+'qushui-final-verification-01.json'])assert.ok(!fs.existsSync(url(p)));
write(dir+'review-28.json',ledger);
fs.writeFileSync(url(dir+'review-28.md'),'# 济南98项重点清单核查台账（第49批）\n\n'+progress+'\n\n| 原名称 | 当前名称 | 版本 | 进度 | 说明 |\n| --- | --- | ---: | --- | --- |\n'+ledger.rows.map(r=>`| ${r.name} | ${r.currentName??r.name} | ${r.currentRevision} | ${r.status} | ${r.followup} |`).join('\n')+'\n',{flag:'wx'});
write('cleaning-scope/current-before-batch49.json',pointer);
Object.assign(pointer,{latestAppliedEntityBatch:49,latestFlow:'../all-cities/flow/run-51',latestAudit:'../all-cities/audit/run-47',
  progressNote:progress,progressUpdatedAt:at,latestReviewEvidence:{file:'../'+dir+'qushui-downstream-check-01.json',fullReviewsAdded:0,partiallyReviewed:1,fullReviewsReopened:0}});
pointer.cityReviewLedgers['济南']='../'+dir+'review-28.json';
Object.assign(pointer.currentScopeReviews,{addedPendingMentions:107,currentReviewRows:157,
  meaning:'50固定重点实体对加107当前提及待审；第49批曲水亭街两条混合看点已解决，百花洲12946及两商业文字发现仍未应用。'});
pointer.currentScopeReviews.evidence.push('../'+dir+'qushui-source-review-01.json');
pointer.resolvedFindings.push({entityId:eid,name:'曲水亭街',sourceIds:[5352,5493],mentionIds:[11369,12610],noteId:2546,
  status:'resolved_partial_highlights_batch49',resolvedByEntityBatch:49,confirmed:46,pending:10,
  evidence:'../'+dir+'qushui-downstream-check-01.json',fullReviewPassed:false});
write('cleaning-scope/current.json',pointer,false);
const task=read('../task.json');assert.equal(task.status,'in_progress');task.notes=progress+'见research/batch49-jinan-qushui-20261009.md。';write('../task.json',task,false);
for(const [p,marker,insert]of docs)fs.writeFileSync(url(p),fs.readFileSync(url(p),'utf8').replace(marker,marker+insert));
for(const kind of ['implement','check']) {
  const p=url(`../${kind}.jsonl`),entry={file:'.trellis/tasks/10-06-place-identity-governance/research/batch49-jinan-qushui-20261009.md',
    reason:'第49批已有联合scope再审已同步，review28待审107、仍76未完成；保留两商业文字问题与图片暂缓，不重放'};
  assert.ok(!fs.readFileSync(p,'utf8').includes(entry.file));fs.appendFileSync(p,JSON.stringify(entry)+'\n');
}
write(dir+'qushui-final-verification-01.json',{batch:49,at,stats,productionCodeInstalled:false,installedManifestHashesVerified:60,
  isolatedSqlAndExport:true,existingScopeReverseRollback:true,actualConsumptionTestPassed:true,rootTypecheck:true,extendedTypecheck:true,
  fullReviewsAdded:0,remainingPrimaryToReview:76,partiallyReviewed:22,unappliedFindings:2,imageComparison:'deferred_by_user',userAcceptance:false});
console.log(JSON.stringify({batch:49,ledger:'review-28',fullyReviewed:18,remaining:76,partial:22,unapplied:2,stats}));
