// 第48批成功证据一次性登记；不提交、归档或声明用户验收。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const url=p=>new URL(p,import.meta.url),read=p=>JSON.parse(fs.readFileSync(url(p),'utf8'));
const write=(p,v,fresh=true)=>fs.writeFileSync(url(p),JSON.stringify(v,null,2)+'\n',{flag:fresh?'wx':'w'});
const dir='priority-cities/济南/',batch='all-cities/batch-48/',at=new Date().toISOString();
const pointer=read('cleaning-scope/current.json');
assert.equal(pointer.latestAppliedEntityBatch,47);assert.equal(pointer.cityReviewLedgers['济南'],'../'+dir+'review-26.json');
assert.equal(pointer.userAcceptance,false);assert.equal(pointer.taskStatus,'in_progress');assert.equal(pointer.imageComparisonPolicy.status,'deferred_by_user');
assert.equal(pointer.latestIndependentPhotoBatch,3);assert.deepEqual(pointer.pendingVerification,[]);assert.equal(pointer.unappliedFindings.length,2);
const applied=read('all-cities/batch-48-applied.json');assert.equal(applied.apply,true);assert.equal(applied.changes.length,4);
const sync=read(batch+'sync-01/sync-state.json').cities['济南'];assert.ok(sync.importedAt&&sync.relationsImportedAt&&sync.embeddingRunAt);assert.equal(sync.relationSnapshotRevision,22);
assert.equal(createHash('sha256').update(fs.readFileSync(url('all-cities/batch-48-source.json'))).digest('hex'),'4a08326144d7a9ce0c37ddc0a4f6356fcdff1614d66333a6c8a9462fd854d98f');
const actual=read(dir+'pearl-downstream-check-01.json');assert.equal(actual.consumedFieldsVerified,228);assert.equal(actual.assignmentRows,268);
assert.equal(actual.pendingMentions,109);assert.equal(actual.partialHighlightExclusions,2);assert.equal(actual.sqlProbes,2);assert.equal(actual.realVectorProbes,2);
const consumption=read(batch+'sync-01/pearl-consumption-1791486931573.json');
assert.ok(consumption.actualPlaceFacts&&consumption.mixedHighlightsRemoved&&consumption.remainingHighlightsPreserved&&consumption.independentSourceDigestUnchanged);
assert.deepEqual(consumption.media.map(r=>r.count),[3,1]);assert.equal(consumption.queued,0);
const postPath=fs.readdirSync(url(batch+'sync-01/')).find(p=>/^post-import-check-\d+\.json$/.test(p));assert.ok(postPath);
const post=read(batch+'sync-01/'+postPath);assert.equal(post.cities[0].photoFieldsPreserved,84);assert.equal(post.cities[0].oldRowsPreserved,238);
const isolated=read(batch+'scope-preview-1791486805843155700/report.json');assert.ok(isolated.idempotent&&isolated.reverseRollback);
const flow=read('all-cities/flow/run-50/report.json'),audit=read('all-cities/audit/run-46/report.json');
for(const r of [actual,consumption,post,isolated,flow,audit,read('all-cities/batch-48-upstream-check.json'),read(batch+'sync-01/verification-vectors.json')])assert.deepEqual(r.failures,[]);
assert.equal(read('all-cities/flow/run-50/cleanup.json').removed,true);
assert.match(fs.readFileSync(url('downstream-place_identity_test_1791486923988.log'),'utf8'),/pass 1/);
const stats={positive:flow.cities.reduce((n,c)=>n+c.probes.length,0),boundaries:flow.cities.reduce((n,c)=>n+c.negativeProbes.length,0),
  withdrawals:flow.cities.reduce((n,c)=>n+c.withdrawalProbes.length,0),pending:audit.cities.reduce((n,c)=>n+(c.statuses.PENDING??0),0)};
assert.deepEqual(stats,{positive:301,boundaries:113,withdrawals:47,pending:289});
assert.match(fs.readFileSync(url('upstream-stage-place_identity_test_1791486584545.log'),'utf8'),/438 passed/);
assert.match(fs.readFileSync(url('upstream-installed-place_identity_test_1791486668803.log'),'utf8'),/665 passed/);
const install=read('upstream-install.json');assert.equal(install.apply,true);assert.equal(install.files.length,60);
for(const f of install.files)for(const p of [url('upstream/'+f.path),'D:/Project/xhs-travel-pipeline/'+f.path])assert.equal(createHash('sha256').update(fs.readFileSync(p)).digest('hex'),f.after);
const ledger=read(dir+'review-26.json'),originalRows=ledger.rows.map(r=>[r.entityId,r.name]);
const scopes=read('all-cities/batch-48-scope-decisions.json');
for(const scope of scopes) {
  const eid=Object.keys(scope.expectedRevisions)[0],row=ledger.rows.find(r=>r.entityId===eid);assert.ok(row);
  assert.equal(row.status,'pending');assert.equal(row.currentRevision,1);
  const spring=row.name==='珍珠泉',confirmed=scope.assignments.map(a=>a.mentionId);
  Object.assign(row,{currentName:row.name,currentEntityId:eid,currentRevision:3,changeBatch:48,reviewBatch:48,status:'reviewed_scope_partial',
    governedSourceIds:[scope.sourcePlaceId],scopeMentionIds:confirmed,currentMentionIds:confirmed,pendingScopeMentionIds:[],
    dimensions:{...row.dimensions,identity:'spring_and_courtyard_distinct_confirmed',category:spring?'natural_spring_confirmed':'cultural_courtyard_confirmed',
      media:'deferred_by_user',consumedFacts:'mixed_highlights_partially_excluded_valid_content_preserved'},
    followup:spring?'第48批9提及完整scope，12592园林评价及两描述字段排除，气泡看点与独立60/30分钟保留；自然/attraction，原名/ID/坐标保持，位置图片待核。'
      :'第48批唯一大院提及保留，排除三大名泉错误看点及两描述字段，院内泉名单保留；文化/attraction，原名/ID/坐标保持，位置图片待核。',
    mediaBoundary:'本批冻结无上游图、独立图源或绑定，原图片字段NULL；只做元数据及消费保全，不作视觉验收。',
    reviewEvidence:[...(row.reviewEvidence??[]),dir+'pearl-source-review-01.json',dir+'pearl-downstream-check-01.json']});
}
assert.deepEqual(ledger.rows.map(r=>[r.entityId,r.name]),originalRows);
assert.equal(ledger.rows.filter(r=>['reviewed_scope_partial','mixed_source_withdrawn_assignment_pending'].includes(r.status)).length,22);
assert.equal(ledger.rows.filter(r=>['pending','reviewed_identity_media_location_pending'].includes(r.status)).length,54);
ledger.createdAt=at;ledger.previousLedger=dir+'review-26.json';
Object.assign(ledger.summary,{partiallyReviewedScopeRows:22,governedScopeMentions:405,pendingScopeMentions:109,otherPendingPrimaryRows:54,confirmedPearlMentions:10,
  fullyReviewedMeaning:'18原入选行对应16现行主体；第48批新增完整自查0，2行推进部分scope，用户未验收。',
  scopeProgressMeaning:'98行保留：4非地点、18行AI自查、76未完成（22部分scope、54其余）；159正式范围审核、4必去缺口，余2项商业文字发现未应用。'});
const progress='第48批珍珠泉/珍珠泉大院两源10提及/8全文完整scope及逐条看点排除已双同步；10条身份保留，待审109不变。两主体revision3，自然泉池/文化大院均attraction；原名/ID/坐标保持，12592园林评价及12582三大名泉错误看点与四描述字段排除，气泡及院内泉名单保留，独立60/30分钟聚合仍60。新增highlightIndexes严格绑定原看点引用，438暂存/665安装后全套通过，60文件哈希备份安装仅2变化。228地点/18关系/direct3、来源revision22，图逐项不变；2SQL/2真实向量/8独立边界、268新旧分配、真实双导入/逆序回滚、全仓及扩展typecheck通过。107原源/662提及/82全文、238旧行/84图片字段/9绑定及201行程保持；老商埠3图、经三路1图旧消费保持，未查看图片。flow50为301正例/113边界/47撤回0失败，audit46为289PENDING。review27仍98行：4非地点、18行AI自查、76未完成（22部分scope、54其余）；159正式范围审核/4必去缺口，老商埠/经三路2项文字问题未应用。实体48/图片03，无未同步或向量待核；图片暂缓、云南不处理，未验收不提交归档。';
const docs=[['../prd.md','## 已知事实\n','\n### 最新进展：第48批珍珠泉与大院逐条看点\n\n'+progress+'见[第48批记录](research/batch48-jinan-pearl-20261009.md)。以下为历史快照。\n'],
  ['nine-cities-continuation-20261007.md','## 本轮断点\n','\n当前以review27为准。'+progress+'继续原固定范围与两项未应用文字发现；下一实体批次49使用flow51/audit47。以下为历史断点。\n']];
for(const [p,marker]of docs)assert.ok(fs.readFileSync(url(p),'utf8').includes(marker));
for(const p of [dir+'review-27.json',dir+'review-27.md','cleaning-scope/current-before-batch48.json',dir+'pearl-final-verification-01.json'])assert.ok(!fs.existsSync(url(p)));
write(dir+'review-27.json',ledger);
fs.writeFileSync(url(dir+'review-27.md'),'# 济南98项重点清单核查台账（第48批）\n\n'+progress+'\n\n| 原名称 | 当前名称 | 版本 | 进度 | 说明 |\n| --- | --- | ---: | --- | --- |\n'+ledger.rows.map(r=>`| ${r.name} | ${r.currentName??r.name} | ${r.currentRevision} | ${r.status} | ${r.followup} |`).join('\n')+'\n',{flag:'wx'});
write('cleaning-scope/current-before-batch48.json',pointer);
Object.assign(pointer,{latestAppliedEntityBatch:48,latestFlow:'../all-cities/flow/run-50',latestAudit:'../all-cities/audit/run-46',
  progressNote:progress,progressUpdatedAt:at,latestReviewEvidence:{file:'../'+dir+'pearl-downstream-check-01.json',fullReviewsAdded:0,partiallyReviewed:2,fullReviewsReopened:0}});
pointer.cityReviewLedgers['济南']='../'+dir+'review-27.json';
Object.assign(pointer.currentScopeReviews,{addedPendingMentions:109,currentReviewRows:159,
  meaning:'50固定重点实体对加109当前提及待审；第48批未新增待审，珍珠泉/大院混合看点已修正，老商埠/经三路两项文字发现仍未应用。'});
pointer.currentScopeReviews.evidence.push('../'+dir+'pearl-source-review-01.json');write('cleaning-scope/current.json',pointer,false);
const task=read('../task.json');assert.equal(task.status,'in_progress');task.notes=progress+'见research/batch48-jinan-pearl-20261009.md。';write('../task.json',task,false);
for(const [p,marker,insert]of docs)fs.writeFileSync(url(p),fs.readFileSync(url(p),'utf8').replace(marker,marker+insert));
for(const kind of ['implement','check']) {
  const p=url(`../${kind}.jsonl`),entry={file:'.trellis/tasks/10-06-place-identity-governance/research/batch48-jinan-pearl-20261009.md',
    reason:'第48批逐条看点及泉池/大院scope已双同步，review27仍76未完成、待审109；两商业文字问题未应用、图片暂缓，不重放'};
  assert.ok(!fs.readFileSync(p,'utf8').includes(entry.file));fs.appendFileSync(p,JSON.stringify(entry)+'\n');
  const design={file:'.trellis/tasks/10-06-place-identity-governance/research/highlight-exclusion-design-20261009.md',
    reason:'逐条看点索引与原文绑定契约；保留有效看点和原始记录，已随第48批安装验证，无图库变更'};
  assert.ok(!fs.readFileSync(p,'utf8').includes(design.file));fs.appendFileSync(p,JSON.stringify(design)+'\n');
}
write(dir+'pearl-final-verification-01.json',{batch:48,at,stats,stagedTests:438,installedFullTests:665,rootTypecheck:true,extendedTypecheck:true,fullReviewsAdded:0,
  remainingPrimaryToReview:76,partiallyReviewed:22,unappliedFindings:2,imageComparison:'deferred_by_user',userAcceptance:false});
console.log(JSON.stringify({batch:48,ledger:'review-27',fullyReviewed:18,remaining:76,partial:22,unapplied:2,stats}));
