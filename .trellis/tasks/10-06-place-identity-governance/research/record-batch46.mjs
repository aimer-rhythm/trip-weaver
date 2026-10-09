// 仅记录第46批成功证据；不提交、归档或宣称用户验收。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const url=p=>new URL(p,import.meta.url),read=p=>JSON.parse(fs.readFileSync(url(p),'utf8'));
const write=(p,v,fresh=true)=>fs.writeFileSync(url(p),JSON.stringify(v,null,2)+'\n',{flag:fresh?'wx':'w'});
const dir='priority-cities/济南/',batch='all-cities/batch-46/',at=new Date().toISOString(),eid='ce733b67e45f0d657e53ff9bff8cbbce';
const pointer=read('cleaning-scope/current.json');
assert.equal(pointer.latestAppliedEntityBatch,45);assert.equal(pointer.cityReviewLedgers['济南'],'../'+dir+'review-24.json');
assert.equal(pointer.userAcceptance,false);assert.equal(pointer.taskStatus,'in_progress');assert.equal(pointer.imageComparisonPolicy.status,'deferred_by_user');
assert.equal(pointer.latestIndependentPhotoBatch,3);assert.deepEqual(pointer.pendingVerification,[]);assert.equal(pointer.unappliedFindings.length,3);
const applied=read('all-cities/batch-46-applied.json');assert.equal(applied.apply,true);assert.equal(applied.changes.length,2);
const sync=read(batch+'sync-01/sync-state.json').cities['济南'];assert.ok(sync.importedAt&&sync.relationsImportedAt&&sync.embeddingRunAt);assert.equal(sync.relationSnapshotRevision,20);
const actual=read(dir+'light-downstream-check-01.json');assert.equal(actual.consumedFieldsVerified,228);assert.equal(actual.assignmentRows,254);
const consumption=read(batch+'sync-01/light-consumption-1791485169904.json');assert.ok(consumption.actualPlaceFacts&&consumption.descriptionRemoved&&consumption.independentSourceDigestUnchanged);
assert.deepEqual(consumption.media.map(r=>r.count),[3,1]);assert.equal(consumption.queued,0);
const post=read(batch+'sync-01/post-import-check-1791485164999.json');assert.equal(post.cities[0].photoFieldsPreserved,75);
const isolated=read(batch+'scope-preview-1791485034062313700/report.json');assert.ok(isolated.idempotent&&isolated.reverseRollback);
const flow=read('all-cities/flow/run-48/report.json'),audit=read('all-cities/audit/run-44/report.json');
for(const r of [actual,consumption,post,isolated,flow,audit,read('all-cities/batch-46-upstream-check.json'),read(batch+'sync-01/verification-vectors.json')])assert.deepEqual(r.failures,[]);
assert.equal(read('all-cities/flow/run-48/cleanup.json').removed,true);
assert.match(fs.readFileSync(url('upstream-stage-place_identity_test_1791484824814.log'),'utf8'),/410 passed/);
assert.match(fs.readFileSync(url('upstream-installed-place_identity_test_1791484899857.log'),'utf8'),/637 passed/);
assert.match(fs.readFileSync(url('downstream-place_identity_test_1791485160938.log'),'utf8'),/pass 1/);
const install=read('upstream-install.json');assert.equal(install.apply,true);assert.equal(install.files.length,59);
for(const f of install.files)for(const p of [url('upstream/'+f.path),'D:/Project/xhs-travel-pipeline/'+f.path])
  assert.equal(createHash('sha256').update(fs.readFileSync(p)).digest('hex'),f.after);
const stats={positive:flow.cities.reduce((n,c)=>n+c.probes.length,0),boundaries:flow.cities.reduce((n,c)=>n+c.negativeProbes.length,0),
  withdrawals:flow.cities.reduce((n,c)=>n+c.withdrawalProbes.length,0),pending:audit.cities.reduce((n,c)=>n+(c.statuses.PENDING??0),0)};
assert.deepEqual(stats,{positive:297,boundaries:113,withdrawals:47,pending:288});
const ledger=read(dir+'review-24.json'),originalRows=ledger.rows.map(r=>[r.entityId,r.name]);
const row=ledger.rows.find(r=>r.entityId===eid);assert.ok(row);assert.equal(row.status,'pending');assert.equal(row.currentRevision,2);
const scope=read('all-cities/batch-46-scope-decisions.json')[0];assert.deepEqual(scope.assignments.map(a=>a.mentionId),[12776]);
const finding=pointer.unappliedFindings.find(f=>f.entityId===eid);assert.ok(finding);
const resolved={...finding,status:'resolved_qualified_heading_description_batch46',resolvedByEntityBatch:46,
  evidence:'../'+dir+'light-downstream-check-01.json',fullReviewPassed:false};
Object.assign(row,{currentName:row.name,currentEntityId:eid,currentRevision:4,changeBatch:46,reviewBatch:46,status:'reviewed_scope_partial',
  governedSourceIds:[5970],scopeMentionIds:[12776],currentMentionIds:[12776],pendingScopeMentionIds:[],
  dimensions:{...row.dimensions,identity:'main_subject_confirmed',category:'cultural_photo_spot_confirmed',media:'deferred_by_user',
    consumedFacts:'qualified_heading_subject_mismatch_descriptions_excluded'},
  followup:'第46批限定标题引用与完整scope已双同步，12776身份和原名保留，三错误胡同描述清除，revision4；原NULL坐标保持，精确位置与图片比对待核，未整项自查通过。',
  resolvedFinding:resolved,mediaBoundary:'本主体无匹配上游/独立图片及绑定；只检查元数据与原字节保全，不作视觉验收。',
  reviewEvidence:[...(row.reviewEvidence??[]),dir+'light-source-review-01.json',dir+'light-downstream-check-01.json']});
delete row.unappliedFinding;
assert.deepEqual(ledger.rows.map(r=>[r.entityId,r.name]),originalRows);
ledger.createdAt=at;ledger.previousLedger=dir+'review-24.json';
Object.assign(ledger.summary,{partiallyReviewedScopeRows:18,governedScopeMentions:391,otherPendingPrimaryRows:58,unappliedSemanticFindings:2,confirmedLightMentions:1,
  fullyReviewedMeaning:'18原入选行对应16现行主体；第46批新增完整自查0，1行推进部分scope，用户未验收。',
  scopeProgressMeaning:'98行保留：4非地点、18行AI自查、76未完成（18部分scope、58其余）；158正式范围审核、4必去缺口不变，红绿灯发现已处理，余2项文字发现未应用。'});
const progress='第46批经三路爱心红绿灯一源/一提及/一全文完整scope与三描述字段修正已双同步，原名/ID/NULL位置保持，文化photo_spot revision4。显式subjectAnchor严格校验原文相邻且唯一的主体：限定标题，不创建别名；410暂存/637安装后上游全套通过，59文件哈希备份安装仅2变化。228地点/18关系/direct3、来源revision20，关系逐项不变。1SQL/1真实向量/5独立边界、254新旧分配、真实双导入及逆序回滚、全仓/扩展typecheck通过。107原源/662提及/82全文、238旧行/75图片字段/9绑定及201行程保持；老商埠3图、经三路1图旧消费保持，未查看图片。flow48为297正例/113边界/47撤回0失败，audit44为288PENDING。review25仍98行：4非地点、18行AI自查、76未完成（18部分scope、58其余）；158正式范围审核/4必去缺口不变，红绿灯发现已解决，老商埠/经三路2项文字问题未应用。实体46/图片03，无未同步或向量待复核；图片暂缓、云南不处理，未验收不提交归档。';
const docs=[['../prd.md','## 已知事实\n','\n### 最新进展：第46批红绿灯限定标题与描述\n\n'+progress+'见[第46批记录](research/batch46-jinan-light-20261009.md)。以下为历史快照。\n'],
  ['nine-cities-continuation-20261007.md','## 本轮断点\n','\n当前以review25为准。'+progress+'继续原固定范围与两项未应用文字发现；下一实体批次使用flow49/audit45。以下为历史断点。\n']];
for(const [p,marker]of docs)assert.ok(fs.readFileSync(url(p),'utf8').includes(marker));
for(const p of [dir+'review-25.json',dir+'review-25.md','cleaning-scope/current-before-batch46.json',dir+'light-final-verification-01.json'])assert.ok(!fs.existsSync(url(p)));
write(dir+'review-25.json',ledger);
fs.writeFileSync(url(dir+'review-25.md'),'# 济南98项重点清单核查台账（第46批）\n\n'+progress+'\n\n| 原名称 | 当前名称 | 版本 | 进度 | 说明 |\n| --- | --- | ---: | --- | --- |\n'+ledger.rows.map(r=>`| ${r.name} | ${r.currentName??r.name} | ${r.currentRevision} | ${r.status} | ${r.followup} |`).join('\n')+'\n',{flag:'wx'});
write('cleaning-scope/current-before-batch46.json',pointer);
pointer.resolvedFindings.push(resolved);
Object.assign(pointer,{latestAppliedEntityBatch:46,latestFlow:'../all-cities/flow/run-48',latestAudit:'../all-cities/audit/run-44',
  progressNote:progress,progressUpdatedAt:at,unappliedFindings:pointer.unappliedFindings.filter(f=>f.entityId!==eid),
  latestReviewEvidence:{file:'../'+dir+'light-downstream-check-01.json',fullReviewsAdded:0,partiallyReviewed:1,fullReviewsReopened:0}});
pointer.cityReviewLedgers['济南']='../'+dir+'review-25.json';
pointer.currentScopeReviews.meaning='50固定重点实体对加108当前提及待审；第46批未增加正式待审，解决1项文字发现，余2项另列未应用。';
pointer.currentScopeReviews.evidence.push('../'+dir+'light-source-review-01.json');write('cleaning-scope/current.json',pointer,false);
const task=read('../task.json');assert.equal(task.status,'in_progress');task.notes=progress+'见research/batch46-jinan-light-20261009.md。';write('../task.json',task,false);
for(const [p,marker,insert]of docs) {
  let t=fs.readFileSync(url(p),'utf8').replace(marker,marker+insert);
  if(p==='../prd.md')t=t.replace('158范围内待审及4必去缺口。第45批已双同步','158范围内待审及4必去缺口。第46批已双同步');
  fs.writeFileSync(url(p),t);
}
for(const kind of ['implement','check'])for(const [name,reason] of [
  ['qualified-heading-design-20261009.md','限定标题的显式字段引用契约，拒绝截断/跨句/重复定位，不创建别名或变更图库'],
  ['batch46-jinan-light-20261009.md','第46批已双同步，红绿灯三描述字段已修正，review25仍76未完成；两文字发现待办、图片暂缓，不重放']]) {
  const p=url(`../${kind}.jsonl`),entry={file:'.trellis/tasks/10-06-place-identity-governance/research/'+name,reason};
  assert.ok(!fs.readFileSync(p,'utf8').includes(entry.file));fs.appendFileSync(p,JSON.stringify(entry)+'\n');
}
const reportPath=url('batch46-jinan-light-20261009.md');
fs.writeFileSync(reportPath,fs.readFileSync(reportPath,'utf8').replace('全城flow48/audit44及review25的最终统计由一次性`record-batch46.mjs`核对成功证据后登记；登记前以current.json为权威，不提前宣称整任务验收通过。',
  '全城flow48：297正例/113边界/47撤回，0失败且专用测试库已清理；audit44：288 PENDING、0结构错误。review25保留98冻结行：4非地点、18行AI自查、76未完成（18部分scope、58其余）；158正式范围审核＋4必去缺口不变。'));
write(dir+'light-final-verification-01.json',{batch:46,at,stats,stagedTests:410,installedFullTests:637,rootTypecheck:true,extendedTypecheck:true,
  fullReviewsAdded:0,remainingPrimaryToReview:76,partiallyReviewed:18,unappliedFindings:2,imageComparison:'deferred_by_user',userAcceptance:false});
console.log(JSON.stringify({batch:46,ledger:'review-25',fullyReviewed:18,remaining:76,partial:18,unapplied:2,stats}));
