// 第47批成功证据一次性登记；不提交、归档或声明用户验收。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const url=p=>new URL(p,import.meta.url),read=p=>JSON.parse(fs.readFileSync(url(p),'utf8'));
const write=(p,v,fresh=true)=>fs.writeFileSync(url(p),JSON.stringify(v,null,2)+'\n',{flag:fresh?'wx':'w'});
const dir='priority-cities/济南/',batch='all-cities/batch-47/',at=new Date().toISOString();
const pointer=read('cleaning-scope/current.json');
assert.equal(pointer.latestAppliedEntityBatch,46);assert.equal(pointer.cityReviewLedgers['济南'],'../'+dir+'review-25.json');
assert.equal(pointer.userAcceptance,false);assert.equal(pointer.taskStatus,'in_progress');assert.equal(pointer.imageComparisonPolicy.status,'deferred_by_user');
assert.equal(pointer.latestIndependentPhotoBatch,3);assert.deepEqual(pointer.pendingVerification,[]);assert.equal(pointer.unappliedFindings.length,2);
const applied=read('all-cities/batch-47-applied.json');assert.equal(applied.apply,true);assert.equal(applied.changes.length,3);
const sync=read(batch+'sync-01/sync-state.json').cities['济南'];assert.ok(sync.importedAt&&sync.relationsImportedAt&&sync.embeddingRunAt);assert.equal(sync.relationSnapshotRevision,21);
assert.equal(createHash('sha256').update(fs.readFileSync(url('all-cities/batch-47-source.json'))).digest('hex'),'99b165c1f57f20b0d3ca864e66b4d86ac683947e3a98c07ac70936dd0912e201');
const actual=read(dir+'minzu-downstream-check-01.json');assert.equal(actual.consumedFieldsVerified,228);assert.equal(actual.assignmentRows,258);
assert.equal(actual.pendingMentions,109);assert.equal(actual.historicalReviewPreserved,369);assert.equal(actual.sqlProbes,2);assert.equal(actual.realVectorProbes,2);
const consumption=read(batch+'sync-01/minzu-consumption-1791486129430.json');
assert.ok(consumption.actualPlaceFacts&&consumption.accommodationWarningRemoved&&consumption.roadFoodTypeCorrected&&consumption.independentSourceDigestUnchanged);
assert.deepEqual(consumption.media.map(r=>r.count),[3,1]);assert.equal(consumption.queued,0);
const postPath=fs.readdirSync(url(batch+'sync-01/')).find(p=>/^post-import-check-\d+\.json$/.test(p));assert.ok(postPath);
const post=read(batch+'sync-01/'+postPath);assert.equal(post.cities[0].photoFieldsPreserved,78);assert.equal(post.cities[0].oldRowsPreserved,238);
const isolated=read(batch+'scope-preview-1791485970107242600/report.json');assert.ok(isolated.idempotent&&isolated.reverseRollback);
const flow=read('all-cities/flow/run-49/report.json'),audit=read('all-cities/audit/run-45/report.json');
for(const r of [actual,consumption,post,isolated,flow,audit,read('all-cities/batch-47-upstream-check.json'),read(batch+'sync-01/verification-vectors.json')])assert.deepEqual(r.failures,[]);
assert.equal(read('all-cities/flow/run-49/cleanup.json').removed,true);
assert.match(fs.readFileSync(url('downstream-place_identity_test_1791486122709.log'),'utf8'),/pass 1/);
const stats={positive:flow.cities.reduce((n,c)=>n+c.probes.length,0),boundaries:flow.cities.reduce((n,c)=>n+c.negativeProbes.length,0),
  withdrawals:flow.cities.reduce((n,c)=>n+c.withdrawalProbes.length,0),pending:audit.cities.reduce((n,c)=>n+(c.statuses.PENDING??0),0)};
assert.deepEqual(stats,{positive:299,boundaries:113,withdrawals:47,pending:289});
const ledger=read(dir+'review-25.json'),originalRows=ledger.rows.map(r=>[r.entityId,r.name]);
const scopes=read('all-cities/batch-47-scope-decisions.json');
for(const scope of scopes) {
  const eid=Object.keys(scope.expectedRevisions)[0],row=ledger.rows.find(r=>r.entityId===eid);assert.ok(row);
  assert.equal(row.status,'pending');assert.equal(row.currentRevision,1);
  const road=row.name==='民族大街',confirmed=scope.assignments.filter(a=>a.entityId===eid).map(a=>a.mentionId),pending=scope.assignments.filter(a=>!a.entityId).map(a=>a.mentionId);
  Object.assign(row,{currentName:row.name,currentEntityId:eid,currentRevision:road?3:2,changeBatch:47,reviewBatch:47,status:'reviewed_scope_partial',
    governedSourceIds:[scope.sourcePlaceId],scopeMentionIds:scope.assignments.map(a=>a.mentionId),currentMentionIds:confirmed,pendingScopeMentionIds:pending,
    dimensions:{...row.dimensions,identity:'street_market_part_of_preserved',category:road?'cultural_public_street_other_confirmed':'shopping_market_confirmed',
      media:'deferred_by_user',consumedFacts:road?'breakfast_experience_preserved_accommodation_warning_pending':'market_recommendations_preserved'},
    followup:road?'第47批完整scope保留两条早餐经历，住宿C区评价11608待审，food改other/文化；原名/ID/坐标保留，精确位置与图片待核。'
      :'第47批完整scope保留菜市场及小吃推荐，购物/market保持，与街道part_of审核369保留；原名/ID/坐标保持，精确位置与图片待核。',
    mediaBoundary:'本批冻结无上游图、独立图源或绑定，原图片字段NULL；只做元数据及消费保全，不作视觉验收。',
    reviewEvidence:[...(row.reviewEvidence??[]),dir+'minzu-source-review-01.json',dir+'minzu-downstream-check-01.json']});
}
assert.deepEqual(ledger.rows.map(r=>[r.entityId,r.name]),originalRows);
assert.equal(ledger.rows.filter(r=>['reviewed_scope_partial','mixed_source_withdrawn_assignment_pending'].includes(r.status)).length,20);
assert.equal(ledger.rows.filter(r=>['pending','reviewed_identity_media_location_pending'].includes(r.status)).length,56);
ledger.createdAt=at;ledger.previousLedger=dir+'review-25.json';
Object.assign(ledger.summary,{partiallyReviewedScopeRows:20,governedScopeMentions:395,pendingScopeMentions:109,otherPendingPrimaryRows:56,confirmedMinzuMentions:3,
  fullyReviewedMeaning:'18原入选行对应16现行主体；第47批新增完整自查0，2行推进部分scope，用户未验收。',
  scopeProgressMeaning:'98行保留：4非地点、18行AI自查、76未完成（20部分scope、56其余）；159正式范围审核、4必去缺口，余2项商业文字发现未应用。'});
const progress='第47批民族大街/民族大街市场两源4提及/3全文完整scope已双同步；确认3、住宿C区评价11608待审，济南待审109。街道revision3、文化/other，市场revision2、购物/market；原名/ID/坐标及审核369 part_of保持，无合并、新主体或撤回。228地点/18关系/direct3、来源revision21，图逐项不变；2SQL/2真实向量/6独立名称及旧ID边界、258新旧分配、真实双导入/逆序回滚、全仓及扩展typecheck通过。107原源/662提及/82全文、238旧行/78图片字段/9绑定及201行程保持；老商埠3图、经三路1图旧消费保持，未查看图片。flow49为299正例/113边界/47撤回0失败，audit45为289PENDING。review26仍98行：4非地点、18行AI自查、76未完成（20部分scope、56其余）；159正式范围审核/4必去缺口，老商埠/经三路2项文字问题未应用。实体47/图片03，无未同步或向量待复核；图片暂缓、云南不处理，未验收不提交归档。';
const docs=[['../prd.md','## 已知事实\n','\n### 最新进展：第47批街道与市场文字范围\n\n'+progress+'见[第47批记录](research/batch47-jinan-minzu-20261009.md)。以下为历史快照。\n'],
  ['nine-cities-continuation-20261007.md','## 本轮断点\n','\n当前以review26为准。'+progress+'继续原固定范围与两项未应用文字发现；下一实体批次48使用flow50/audit46。以下为历史断点。\n']];
for(const [p,marker]of docs)assert.ok(fs.readFileSync(url(p),'utf8').includes(marker));
for(const p of [dir+'review-26.json',dir+'review-26.md','cleaning-scope/current-before-batch47.json',dir+'minzu-final-verification-01.json'])assert.ok(!fs.existsSync(url(p)));
write(dir+'review-26.json',ledger);
fs.writeFileSync(url(dir+'review-26.md'),'# 济南98项重点清单核查台账（第47批）\n\n'+progress+'\n\n| 原名称 | 当前名称 | 版本 | 进度 | 说明 |\n| --- | --- | ---: | --- | --- |\n'+ledger.rows.map(r=>`| ${r.name} | ${r.currentName??r.name} | ${r.currentRevision} | ${r.status} | ${r.followup} |`).join('\n')+'\n',{flag:'wx'});
write('cleaning-scope/current-before-batch47.json',pointer);
Object.assign(pointer,{latestAppliedEntityBatch:47,latestFlow:'../all-cities/flow/run-49',latestAudit:'../all-cities/audit/run-45',
  progressNote:progress,progressUpdatedAt:at,latestReviewEvidence:{file:'../'+dir+'minzu-downstream-check-01.json',fullReviewsAdded:0,partiallyReviewed:2,fullReviewsReopened:0}});
pointer.cityReviewLedgers['济南']='../'+dir+'review-26.json';
Object.assign(pointer.currentScopeReviews,{addedPendingMentions:109,currentReviewRows:159,
  meaning:'50固定重点实体对加109当前提及待审；第47批新增住宿C区评价待审1，老商埠/经三路两项文字发现仍未应用。'});
pointer.currentScopeReviews.evidence.push('../'+dir+'minzu-source-review-01.json');write('cleaning-scope/current.json',pointer,false);
const task=read('../task.json');assert.equal(task.status,'in_progress');task.notes=progress+'见research/batch47-jinan-minzu-20261009.md。';write('../task.json',task,false);
for(const [p,marker,insert]of docs)fs.writeFileSync(url(p),fs.readFileSync(url(p),'utf8').replace(marker,marker+insert));
for(const kind of ['implement','check']) {
  const p=url(`../${kind}.jsonl`),entry={file:'.trellis/tasks/10-06-place-identity-governance/research/batch47-jinan-minzu-20261009.md',
    reason:'第47批街道与市场完整scope已双同步，review26仍76未完成、待审109；两商业文字问题未应用、图片暂缓，不重放'};
  assert.ok(!fs.readFileSync(p,'utf8').includes(entry.file));fs.appendFileSync(p,JSON.stringify(entry)+'\n');
}
write(dir+'minzu-final-verification-01.json',{batch:47,at,stats,rootTypecheck:true,extendedTypecheck:true,fullReviewsAdded:0,
  remainingPrimaryToReview:76,partiallyReviewed:20,unappliedFindings:2,imageComparison:'deferred_by_user',userAcceptance:false});
console.log(JSON.stringify({batch:47,ledger:'review-26',fullyReviewed:18,remaining:76,partial:20,unapplied:2,stats}));
