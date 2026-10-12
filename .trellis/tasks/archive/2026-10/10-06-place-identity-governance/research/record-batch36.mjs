// 登记第36批已应用事实，并明确保留未通过的外部向量验证；不提交归档。
import fs from 'node:fs';
import assert from 'node:assert/strict';
const url=f=>new URL(f,import.meta.url);
const read=f=>JSON.parse(fs.readFileSync(url(f),'utf8'));
const write=(f,v,exclusive=true)=>fs.writeFileSync(url(f),JSON.stringify(v,null,2)+'\n',{flag:exclusive?'wx':'w'});
const pointer=read('cleaning-scope/current.json');
assert.equal(pointer.latestAppliedEntityBatch,35);
assert.equal(pointer.cityReviewLedgers['济南'],'../priority-cities/济南/review-12.json');
const folder='all-cities/batch-36/sync-01/';
const sync=read(folder+'sync-state.json').cities['济南'];
assert.ok(sync.importedAt&&sync.relationsImportedAt&&sync.embeddingRunAt);
assert.equal(sync.places,228);assert.equal(sync.relationSnapshotRevision,10);
assert.equal(read('all-cities/batch-36-applied.json').apply,true);
const boundary=read(folder+'boundary-check.json');assert.deepEqual(boundary.failures,[]);
assert.equal(boundary.durationFieldsRemoved,4);assert.deepEqual(boundary.pending,[12692]);
const source=read('all-cities/batch-36-upstream-check.json');assert.deepEqual(source.failures,[]);
assert.equal(source.rawSourcesUnchanged,107);assert.equal(source.originalMentionsUnchanged,662);assert.equal(source.factExclusionsVerified,4);
const snapshots=['verification-vectors.json','verification-vectors-qifeng-recheck.json'].map(f=>read(folder+f));
const targets=read('all-cities/batch-36-export-expectations.json');
for(const t of targets) assert.ok(snapshots.some(s=>s.cities[0].vectorProbes.some(p=>p.id===t.id&&p.diagnostics.vector==='used')));
const withdrawalIds=snapshots[0].cities[0].withdrawals.map(p=>p.id);
const unverified=withdrawalIds.filter(id=>!snapshots.some(s=>s.cities[0].withdrawals.some(p=>p.id===id&&p.diagnostics.vector==='used'&&p.sqlExcluded)));
assert.deepEqual(unverified,['033a692df5218d571ddd2cca8a8c91e3']);
const recheck=read(folder+'withdrawal-vectors-recheck-01.json');assert.ok(recheck.failures.length);
assert.ok(recheck.requests.every(r=>r.error==='TimeoutError'));
const photoBefore=read('priority-cities/济南/spring-photo-sources-01.json');
const photoAfter=read('priority-cities/济南/spring-photo-sources-02.json');
assert.equal(photoAfter.inputDigest,photoBefore.inputDigest);assert.deepEqual(photoAfter.warnings,[]);
assert.equal(photoAfter.sourceImages,123);assert.equal(photoAfter.reviewedCatalogs,12);
assert.ok(photoAfter.entities.every(e=>e.revision===2&&e.independentSources.length===0));
const flow=read('all-cities/flow/run-38/report.json');assert.deepEqual(flow.failures,[]);
assert.equal(read('all-cities/flow/run-38/cleanup.json').removed,true);
const flowCounts={positive:flow.cities.reduce((n,c)=>n+c.probes.length,0),negative:flow.cities.reduce((n,c)=>n+c.negativeProbes.length,0),withdrawals:flow.cities.reduce((n,c)=>n+c.withdrawalProbes.length,0)};
assert.deepEqual(flowCounts,{positive:287,negative:113,withdrawals:47});
const audit=read('all-cities/audit/run-34/report.json');assert.deepEqual(audit.failures,[]);
assert.equal(audit.cities.reduce((n,c)=>n+(c.statuses.PENDING??0),0),240);
const pendingRows=read('all-cities/audit/run-34/snapshot.json').reviews.filter(r=>r.city==='济南'&&r.detail?.mentionId===12692);
assert.equal(pendingRows.length,1);assert.equal(pendingRows[0].status,'PENDING');assert.equal(pendingRows[0].auditValid,true);
const ledger=read('priority-cities/济南/review-12.json');
const scopes=read('all-cities/batch-36-scope-decisions.json');
for(const target of targets) {
  const row=ledger.rows.find(r=>r.entityId===target.id);assert.ok(row);
  assert.equal(row.status,'reviewed_sources_fact_correction_required');
  const decision=scopes.find(s=>Object.keys(s.expectedRevisions).includes(target.id));assert.ok(decision);
  Object.assign(row,{currentRevision:2,changeBatch:36,status:'reviewed_scope_partial',governedSourceIds:[decision.sourcePlaceId],
    scopeMentionIds:decision.assignments.map(a=>a.mentionId),currentMentionIds:target.mentionIds,
    pendingScopeMentionIds:decision.assignments.filter(a=>!a.entityId).map(a=>a.mentionId),
    dimensions:{...row.dimensions,identity:target.name==='刘氏泉'?'2_spring_mentions_confirmed_1_photo_subject_pending':'independent_subject_preserved',
      consumedFacts:'group_duration_excluded_valid_description_preserved',media:'no_upstream_imported_or_independent_images'},
    followup:'第36批已应用双同步，保留独立主体和有效描述，清错误单点30分钟；类别/位置仍待自查。'+(target.name==='刘氏泉'?'12692摄影主体待审。':'')+'不计作完整自查完成。'});
  row.evidenceFiles=[...new Set([...(row.evidenceFiles??[]),'priority-cities/济南/spring-source-review-02.json',
    'priority-cities/济南/spring-photo-sources-02.json','all-cities/batch-36-applied.json','all-cities/batch-36-upstream-check.json',folder+'boundary-check.json'])];
  if(target.name==='刘氏泉') row.reviewIds=pendingRows.map(r=>Number(r.id));
}
assert.equal(ledger.rows.length,98);
assert.equal(ledger.rows.filter(r=>['reviewed_identity','reviewed_same_entity','reviewed_alias_redirect'].includes(r.status)).length,11);
const progress='第36批四泉时长治理已应用及济南完整双同步，4个错误30分钟清除、10有效提及保留、12692摄影主体待审；四独立ID/revision2/原类别位置保持。228地点、20关系/9强边，原107源/662提及/82原文及238旧行/图片/201历史行程通过。四泉SQL和真实向量已验证；既有撤回甜沫儿本轮向量连续超时，单列待复核。flow38为287正例/113边界/47撤回0失败，audit34为240PENDING；正式范围110待审和4必去缺口。review13仍98行：4非地点、11行AI自查、83未完成（9行部分scope治理，其余74）。原7待定位及教堂位置、四泉类别位置和玛瑙泉继续。scope06固定978主体+56依赖/1135源。云南不处理，未验收，不提交归档。';
ledger.createdAt=new Date().toISOString();ledger.previousLedger='priority-cities/济南/review-12.json';
Object.assign(ledger.summary,{partiallyReviewedScopeRows:9,governedScopeMentions:147,confirmedSpringMentions:10,
  pendingScopeMentions:60,otherPendingPrimaryRows:74,unappliedSemanticFindings:0,
  scopeProgressMeaning:'98原入选行保留：4非地点、11行AI自查（9主体）、83未完成。9行部分scope治理，其余74继续；60提及仍待审。四泉仅完成字段治理，类别/位置仍待核。'});
write('priority-cities/济南/review-13.json',ledger);
fs.writeFileSync(url('priority-cities/济南/review-13.md'),'# 济南98项重点清单核查台账（第36批后）\n\n'+progress+'\n\n| 原入选名称 | 现行名称 | 版本 | 进度 | 说明 |\n| --- | --- | ---: | --- | --- |\n'
  +ledger.rows.map(r=>`| ${r.name} | ${r.currentName??r.name} | ${r.currentRevision} | ${r.status} | ${r.followup} |`).join('\n')+'\n',{flag:'wx'});
write('cleaning-scope/current-before-batch36.json',pointer);
Object.assign(pointer,{latestAppliedEntityBatch:36,latestFlow:'../all-cities/flow/run-38',latestAudit:'../all-cities/audit/run-34',progressNote:progress,progressUpdatedAt:ledger.createdAt});
delete pointer.preparedEntityBatch;
pointer.pendingVerification=[{batch:36,city:'济南',entityId:unverified[0],name:'甜沫儿',kind:'withdrawal_live_vector',reason:'production_timeout',evidence:'../'+folder+'withdrawal-vectors-recheck-01.json'}];
pointer.cityReviewLedgers['济南']='../priority-cities/济南/review-13.json';
pointer.unappliedFindings=pointer.unappliedFindings.filter(f=>![12941,12942,12943,12944].includes(f.mentionId));
assert.deepEqual(pointer.unappliedFindings,[]);
Object.assign(pointer.currentScopeReviews,{addedPendingMentions:60,currentReviewRows:110,
  meaning:'50重点实体对仍待审；五龙潭18、趵突泉38、泉城广场3及刘氏泉摄影主体1条scope保持null，固定scope06统计不作实时队列。'});
pointer.currentScopeReviews.evidence.push('../priority-cities/济南/spring-source-review-02.json');
write('cleaning-scope/current.json',pointer,false);
const task=read('../task.json');assert.equal(task.status,'in_progress');task.notes=progress+'见research/batch36-jinan-spring-duration-20261008.md。';write('../task.json',task,false);
const prd=url('../prd.md');let content=fs.readFileSync(prd,'utf8');
const start=content.indexOf('- 用户最新明确：'),end=content.indexOf('\n\n',start);assert.ok(start>=0&&end>start);
content=content.slice(0,start)+'- 用户最新明确：**云南不处理，继续其他城市直到验收通过**。当前九城固定978主体＋56依赖/1135源；50重点实体对＋60提及＝110范围内待审，另4必去缺口。scope06入选统计冻结，云南、89普通长尾和37已隔离错城来源归属不扩入主动范围。第36批已应用双同步，四泉类别位置及原剩余清单继续；甜沫儿真实向量超时复核单列。'+content.slice(end);
fs.writeFileSync(prd,content.replace('## 已知事实\n','## 已知事实\n\n### 最新进展：第36批四泉时长已清除\n\n'+progress+'见[第36批记录](research/batch36-jinan-spring-duration-20261008.md)。以下为历史快照。\n'));
const resume=url('nine-cities-continuation-20261007.md');fs.writeFileSync(resume,fs.readFileSync(resume,'utf8').replace('## 本轮断点\n','## 本轮断点\n\n当前以review-13为准。'+progress+'下一新flow39/audit35，禁止重放旧批次。以下为历史断点。\n'));
for(const name of ['implement','check']) {
  const file=url(`../${name}.jsonl`),entry={file:'.trellis/tasks/10-06-place-identity-governance/research/batch36-jinan-spring-duration-20261008.md',reason:'第36批已应用双同步、四时长已清，剩余110待审与四泉其他维度；甜沫儿向量超时须复核，不重放批次'};
  if(!fs.readFileSync(file,'utf8').includes(entry.file))fs.appendFileSync(file,JSON.stringify(entry)+'\n');
}
console.log(JSON.stringify({applied:36,ledger:'review-13',fullyReviewed:11,remaining:83,partiallyGoverned:9,currentScopeReviews:110,unverifiedVectorWithdrawals:unverified,flowCounts}));
