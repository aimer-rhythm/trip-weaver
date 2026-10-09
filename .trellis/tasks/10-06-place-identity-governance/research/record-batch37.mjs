// 登记已验证的五泉类别修订及四个完整AI自查；不代替用户验收。
import fs from 'node:fs';
import assert from 'node:assert/strict';
const url=f=>new URL(f,import.meta.url),read=f=>JSON.parse(fs.readFileSync(url(f),'utf8'));
const write=(f,v,exclusive=true)=>fs.writeFileSync(url(f),JSON.stringify(v,null,2)+'\n',{flag:exclusive?'wx':'w'});
const pointer=read('cleaning-scope/current.json');assert.equal(pointer.latestAppliedEntityBatch,36);
assert.equal(pointer.cityReviewLedgers['济南'],'../priority-cities/济南/review-13.json');
const folder='all-cities/batch-37/sync-01/';
const sync=read(folder+'sync-state.json').cities['济南'];assert.ok(sync.importedAt&&sync.relationsImportedAt&&sync.embeddingRunAt);
assert.equal(sync.places,228);assert.equal(sync.relationSnapshotRevision,11);
const vectors=read(folder+'verification-vectors.json');assert.deepEqual(vectors.failures,[]);
assert.equal(vectors.cities[0].probes.length,5);assert.equal(vectors.cities[0].vectorProbes.length,5);
assert.ok(vectors.cities[0].vectorProbes.every(p=>p.diagnostics.vector==='used'));
assert.equal(vectors.cities[0].withdrawals.length,6);assert.ok(vectors.cities[0].withdrawals.every(p=>p.diagnostics.vector==='used'&&p.sqlExcluded));
const boundary=read(folder+'boundary-check.json');assert.deepEqual(boundary.failures,[]);
assert.equal(boundary.priorFactExclusionsPreserved,4);assert.equal(boundary.pendingMentionsPreserved,60);
const upstream=read('all-cities/batch-37-upstream-check.json');assert.deepEqual(upstream.failures,[]);
assert.equal(upstream.rawSourcesUnchanged,107);assert.equal(upstream.originalMentionsUnchanged,662);
const flow=read('all-cities/flow/run-39/report.json');assert.deepEqual(flow.failures,[]);
assert.equal(read('all-cities/flow/run-39/cleanup.json').removed,true);
const counts={positive:flow.cities.reduce((n,c)=>n+c.probes.length,0),negative:flow.cities.reduce((n,c)=>n+c.negativeProbes.length,0),withdrawal:flow.cities.reduce((n,c)=>n+c.withdrawalProbes.length,0)};
assert.deepEqual(counts,{positive:288,negative:113,withdrawal:47});
const audit=read('all-cities/audit/run-35/report.json');assert.deepEqual(audit.failures,[]);
assert.equal(audit.cities.reduce((n,c)=>n+(c.statuses.PENDING??0),0),240);
const source=read('priority-cities/济南/spring-upstream-check-01.json');assert.equal(source.mentions.length,12);
const targets=read('all-cities/batch-37-export-expectations.json');
const ledger=read('priority-cities/济南/review-13.json');
const reviews=[];
for(const target of targets) {
  const row=ledger.rows.find(r=>r.entityId===target.id);assert.ok(row);
  const full=target.name!=='刘氏泉',group=source.groups.find(g=>g.entity.entity_id===target.id);assert.ok(group);
  Object.assign(row,{currentRevision:target.revision,changeBatch:37,status:full?'reviewed_identity':'reviewed_scope_partial',
    dimensions:{...row.dimensions,identity:full?'reviewed_independent_spring':'2_spring_mentions_confirmed_1_photo_subject_pending',
      category:'reviewed_natural_spring_activity',location:'reviewed_named_spring_reference_point',
      media:'no_upstream_imported_or_independent_images',consumedFacts:target.name==='玛瑙泉'?'reviewed_source_subject_attribution':'group_duration_excluded_valid_description_preserved'},
    followup:full?'完整来源、实际同名泉体参考点及三类图库已核；类别修订自然已双同步，独立ID/有效描述/SQL和真实向量通过，错误时长未恢复。AI自查完成，待用户验收。'
      :'2条泉体提及与自然类别、位置、媒体已核，12692簪花少女摄影主体仍待补证并保持null。第36批字段排除未恢复；不计整组自查完成。'});
  row.evidenceFiles=[...new Set([...(row.evidenceFiles??[]),'priority-cities/济南/spring-upstream-check-01.json',
    'priority-cities/济南/spring-category-review-01.json','priority-cities/济南/spring-map-reference-check-01.json',
    'priority-cities/济南/spring-photo-sources-03.json','all-cities/batch-37-applied.json',
    'all-cities/batch-37-upstream-check.json',folder+'boundary-check.json',folder+'verification-vectors.json'])];
  reviews.push({entityId:target.id,name:target.name,revision:target.revision,fullReviewPassed:full,
    mentionIds:group.mentionIds,pendingMentionIds:full?[]:[12692],dimensions:row.dimensions,evidenceFiles:row.evidenceFiles});
}
assert.equal(ledger.rows.length,98);
assert.equal(ledger.rows.filter(r=>['reviewed_identity','reviewed_same_entity','reviewed_alias_redirect'].includes(r.status)).length,15);
assert.equal(ledger.rows.filter(r=>['reviewed_scope_partial','mixed_source_withdrawn_assignment_pending'].includes(r.status)).length,6);
ledger.createdAt=new Date().toISOString();ledger.previousLedger='priority-cities/济南/review-13.json';
Object.assign(ledger.summary,{fullyReviewed:15,remainingPrimaryToReview:79,partiallyReviewedScopeRows:6,otherPendingPrimaryRows:73,
  reviewedOrdinaryPrimaryRows:8,
  fullyReviewedMeaning:'AI自查15原入选行对应13现行主体；本轮新增王府池子、腾蛟泉、起凤泉、玛瑙泉，用户未验收。',
  scopeProgressMeaning:'98原入选行保留：4非地点、15行AI自查（13主体）、79未完成；其中6行部分scope治理，其余73继续。刘氏泉12692及其他59提及保持待审。'});
write('priority-cities/济南/spring-source-review-03.json',{city:'济南',batch:37,createdAt:ledger.createdAt,
  fullNotesRead:6,mentionsRead:12,fullyReviewed:4,partiallyReviewed:1,rows:reviews,userAcceptance:false});
write('priority-cities/济南/review-14.json',ledger);
const progress='第37批五泉活动类别改为自然并完成济南双同步，四受控主体revision3、玛瑙泉revision2；旧11分配/4时长排除/60待审、原源原文/位置/图片/201历史行程保持。5名称SQL/5真实向量及6撤回通过，甜沫儿前批超时项由本轮真实成功复核关闭。王府池子、腾蛟泉、起凤泉、玛瑙泉完成AI自查，刘氏泉12692仍待审。review14保持98项：4非地点、15行AI自查（13主体）、79未完成，其中6行部分scope治理，其余73继续；7待定位及教堂位置保持。scope06固定978主体+56依赖/1135源；范围110待审及4必去缺口不变。flow39为288正例/113边界/47撤回0失败，audit35为240PENDING。实体至37、图片03均禁止重放，无待同步步骤。云南不处理，未验收，不提交归档。';
fs.writeFileSync(url('priority-cities/济南/review-14.md'),'# 济南98项重点清单核查台账（第37批后）\n\n'+progress+'\n\n| 原入选名称 | 现行名称 | 版本 | 进度 | 说明 |\n| --- | --- | ---: | --- | --- |\n'
  +ledger.rows.map(r=>`| ${r.name} | ${r.currentName??r.name} | ${r.currentRevision} | ${r.status} | ${r.followup} |`).join('\n')+'\n',{flag:'wx'});
write('cleaning-scope/current-before-batch37.json',pointer);
const closed=pointer.pendingVerification.filter(p=>p.entityId==='033a692df5218d571ddd2cca8a8c91e3');assert.equal(closed.length,1);
pointer.resolvedVerification=[...(pointer.resolvedVerification??[]),{...closed[0],verifiedByEntityBatch:37,evidence:'../'+folder+'verification-vectors.json'}];
pointer.pendingVerification=pointer.pendingVerification.filter(p=>p.entityId!==closed[0].entityId);
Object.assign(pointer,{latestAppliedEntityBatch:37,latestFlow:'../all-cities/flow/run-39',latestAudit:'../all-cities/audit/run-35',
  progressNote:progress,progressUpdatedAt:ledger.createdAt,
  latestReviewEvidence:{file:'../priority-cities/济南/spring-source-review-03.json',fullReviewsAdded:4,partiallyReviewed:1}});
pointer.cityReviewLedgers['济南']='../priority-cities/济南/review-14.json';
write('cleaning-scope/current.json',pointer,false);
const task=read('../task.json');assert.equal(task.status,'in_progress');task.notes=progress+'见research/batch37-jinan-spring-categories-20261008.md。';write('../task.json',task,false);
const prd=url('../prd.md');let text=fs.readFileSync(prd,'utf8');
const start=text.indexOf('- 用户最新明确：'),end=text.indexOf('\n\n',start);assert.ok(start>=0&&end>start);
text=text.slice(0,start)+'- 用户最新明确：**云南不处理，继续其他城市直到验收通过**。九城固定978主体＋56依赖/1135源，50重点实体对＋60提及＝110范围内待审，另4必去缺口。scope06入选统计冻结，云南、89普通长尾和37已隔离错城来源归属不扩入主动范围。第37批已双同步，济南15行AI自查、79未完成，未获用户验收。'+text.slice(end);
fs.writeFileSync(prd,text.replace('## 已知事实\n','## 已知事实\n\n### 最新进展：第37批五泉类别与四处自查通过\n\n'+progress+'详见[第37批记录](research/batch37-jinan-spring-categories-20261008.md)。以下为历史快照。\n'));
const resume=url('nine-cities-continuation-20261007.md');fs.writeFileSync(resume,fs.readFileSync(resume,'utf8').replace('## 本轮断点\n','## 本轮断点\n\n当前以review-14为准。'+progress+'下一新flow40/audit36；接续街巷及其他重点地点、其余八城。以下为历史断点。\n'));
for(const name of ['implement','check']) {
  const file=url(`../${name}.jsonl`),entry={file:'.trellis/tasks/10-06-place-identity-governance/research/batch37-jinan-spring-categories-20261008.md',reason:'第37批五泉类别已应用双同步，四处自查通过，review14剩79行；旧分配/时长排除保持，甜沫儿向量复核关闭，禁止重放'};
  if(!fs.readFileSync(file,'utf8').includes(entry.file))fs.appendFileSync(file,JSON.stringify(entry)+'\n');
}
console.log(JSON.stringify({batch:37,ledger:'review-14',fullyReviewed:15,remaining:79,partiallyGoverned:6,currentScopeReviews:110,pendingVerification:pointer.pendingVerification,counts}));
