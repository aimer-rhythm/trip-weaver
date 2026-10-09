// 仅登记已经应用和验证的第35批；不重放治理、提交或归档。
import fs from 'node:fs';
import assert from 'node:assert/strict';
const url = file => new URL(file,import.meta.url);
const read = file => JSON.parse(fs.readFileSync(url(file),'utf8'));
const write = (file,value,exclusive=true) => fs.writeFileSync(url(file),JSON.stringify(value,null,2)+'\n',{flag:exclusive?'wx':'w'});
const pointer=read('cleaning-scope/current.json');
assert.equal(pointer.latestAppliedEntityBatch,34); assert.equal(pointer.latestIndependentPhotoBatch,3);
assert.equal(pointer.cityReviewLedgers['济南'],'../priority-cities/济南/review-09.json');
const sync=read('all-cities/batch-35/sync-01/sync-state.json').cities['济南'];
assert.ok(sync.importedAt && sync.relationsImportedAt && sync.embeddingRunAt);
assert.equal(sync.places,228); assert.equal(sync.relationSnapshotRevision,9);
const verify=read('all-cities/batch-35/sync-01/verification-vectors.json'); assert.deepEqual(verify.failures,[]);
assert.equal(verify.cities[0].vectorProbes[0].diagnostics.vector,'used');
assert.ok(verify.cities[0].withdrawals.every(w=>w.diagnostics.vector==='used' && w.sqlExcluded));
const boundary=read('all-cities/batch-35/sync-01/boundary-check.json'); assert.deepEqual(boundary.failures,[]);
assert.equal(boundary.assigned,30); assert.deepEqual(boundary.pending,[11420,12580,12913]);
const source=read('all-cities/batch-35-upstream-check.json'); assert.deepEqual(source.failures,[]);
assert.equal(source.rawSourcesUnchanged,107); assert.equal(source.originalMentionsUnchanged,662);
const flow=read('all-cities/flow/run-37/report.json'); assert.deepEqual(flow.failures,[]);
assert.equal(read('all-cities/flow/run-37/cleanup.json').removed,true);
assert.equal(flow.cities.reduce((n,c)=>n+c.probes.length,0),283);
const audit=read('all-cities/audit/run-33/report.json'); assert.deepEqual(audit.failures,[]);
assert.equal(audit.cities.reduce((n,c)=>n+(c.statuses.PENDING??0),0),239);
const currentReviews=read('all-cities/audit/run-33/snapshot.json').reviews.filter(r=>r.city==='济南' && boundary.pending.includes(r.detail?.mentionId));
assert.equal(currentReviews.length,3); assert.ok(currentReviews.every(r=>r.status==='PENDING' && r.auditValid));
const detail=read('priority-cities/济南/square-source-review-02.json');
const ledger=read('priority-cities/济南/review-09.json');
const row=ledger.rows.find(r=>r.entityId==='8cc25e536e67519c958ee54248ead04f'); assert.ok(row);
Object.assign(row,{currentRevision:3,changeBatch:35,status:'reviewed_scope_partial',governedSourceIds:[5354],
  scopeMentionIds:detail.rows.map(r=>r.mentionId),pendingScopeMentionIds:boundary.pending,
  currentMentionIds:detail.rows.filter(r=>r.entityId).map(r=>r.mentionId),reviewIds:currentReviews.map(r=>Number(r.id)),
  dimensions:{identity:'30_square_mentions_confirmed_3_scope_or_fact_issues_pending',category:'reviewed_entertainment',
    location:'reviewed_reference_point',media:'no_upstream_imported_or_independent_images'},
  followup:'33提及/27原文复核，30条归广场，11420住宿区域、12580混入住宿性价比、12913错写五龙潭东门出发点已隔离待审。稳定ID/坐标/娱乐类别保留；双同步、SQL/真实向量、30条语料与旧ID/图片/历史行程通过。三条尚未解决，不计作全部自查完成。'});
row.evidenceFiles.push('priority-cities/济南/square-source-review-02.json','all-cities/batch-35-applied.json',
  'all-cities/batch-35-upstream-check.json','all-cities/batch-35/sync-01/verification-vectors.json','all-cities/batch-35/sync-01/boundary-check.json');
ledger.createdAt=new Date().toISOString(); ledger.previousLedger='priority-cities/济南/review-09.json';
Object.assign(ledger.summary,{partiallyReviewedScopeRows:5,governedScopeMentions:136,confirmedSquareMentions:30,
  pendingScopeMentions:59,otherPendingPrimaryRows:81,unappliedSemanticFindings:0,
  scopeProgressMeaning:'98原入选行保留：4非地点、8行AI自查；86未完成中5行部分治理（4行泉池/公园和泉城广场1行），其余81继续。三组受控来源共59提及待审。'});
write('priority-cities/济南/review-10.json',ledger);
fs.writeFileSync(url('priority-cities/济南/review-10.md'),'# 济南98项重点清单核查台账（第35批后）\n\n'+ledger.summary.scopeProgressMeaning
  +'原7待定位及教堂位置保持；整城未验收。\n\n| 原入选名称 | 现行名称 | 版本 | 进度 | 说明 |\n| --- | --- | ---: | --- | --- |\n'
  +ledger.rows.map(r=>`| ${r.name} | ${r.currentName??r.name} | ${r.currentRevision} | ${r.status} | ${r.followup} |`).join('\n')+'\n',{flag:'wx'});
write('cleaning-scope/current-before-batch35.json',pointer);
const progress='第35批泉城广场已正式应用及双同步：33提及/27原文复核，30归广场、3条住宿语境或错路线隔离待审；稳定ID/位置/娱乐类别保持，revision3。228导出（222有效+6撤回）、20关系/9强边，SQL/真实向量及原源/旧ID/图片/201历史行程通过。flow/run-37为283正例/113独立包含/47撤回0失败，audit/run-33为239PENDING。scope06固定978主体+56依赖/1135源不重排；范围内50实体对+59提及=109审核行及4必去缺口。review-10保留98行：4非地点、8行AI自查、86未完成（5行部分治理，其余81），原7待定位及教堂位置继续。实体01-v2至35、独立图片01至03禁止重放，无batch36或待同步步骤。未验收，不提交归档。';
Object.assign(pointer,{latestAppliedEntityBatch:35,latestFlow:'../all-cities/flow/run-37',latestAudit:'../all-cities/audit/run-33',
  progressNote:progress,progressUpdatedAt:new Date().toISOString()});
pointer.cityReviewLedgers['济南']='../priority-cities/济南/review-10.json';
pointer.unappliedFindings=(pointer.unappliedFindings??[]).filter(r=>!(r.city==='济南' && boundary.pending.includes(r.mentionId)));
Object.assign(pointer.currentScopeReviews,{addedPendingMentions:59,currentReviewRows:109,
  meaning:'原50重点实体对仍待审；五龙潭18、趵突泉38、泉城广场3条已读但范围或事实主语待清，scope保持null。固定scope06统计不作实时队列。'});
pointer.currentScopeReviews.evidence.push('../priority-cities/济南/square-source-review-02.json');
write('cleaning-scope/current.json',pointer,false);
const task=read('../task.json'); assert.equal(task.status,'in_progress');
task.notes='云南不处理，九城继续。'+progress+'见research/batch35-jinan-square-20261008.md。'; write('../task.json',task,false);
const prdPath=url('../prd.md'); let prd=fs.readFileSync(prdPath,'utf8');
const start=prd.indexOf('- 用户最新明确：'); const end=prd.indexOf('\n\n',start); assert.ok(start>=0 && end>start);
prd=prd.slice(0,start)+'- 用户最新明确：**云南不处理，继续其他城市直到验收通过**。当前九城固定978主体＋56依赖/1135源，50重点实体对及4必去缺口不变。第33/34/35批新增18＋38＋3条范围内提及待审，现109审核行；原scope06统计保持冻结。云南、89普通长尾及37已隔离来源归属待审不扩入主动清洗范围。持续实施不等于预先验收。'+prd.slice(end);
prd=prd.replace('## 已知事实\n','## 已知事实\n\n### 最新进展：泉城广场第35批逐提及治理已同步\n\n'+progress+'详见[第35批记录](research/batch35-jinan-square-20261008.md)。以下为历史快照。\n');
fs.writeFileSync(prdPath,prd);
const resume=url('nine-cities-continuation-20261007.md');
fs.writeFileSync(resume,fs.readFileSync(resume,'utf8').replace('## 本轮断点\n','## 本轮断点\n\n当前以review-10为准。'+progress+'接着继续普通重点地点；教堂有新边界证据再补位置，其余八城持续推进。以下为历史断点。\n'));
for(const name of ['implement','check']) {
  const file=url(`../${name}.jsonl`); const entry={file:'.trellis/tasks/10-06-place-identity-governance/research/batch35-jinan-square-20261008.md',reason:'第35批双同步与当前109待审；原文主体及提取事实分别核查，旧批次禁止重放'};
  if(!fs.readFileSync(file,'utf8').includes(entry.file)) fs.appendFileSync(file,JSON.stringify(entry)+'\n');
}
console.log(JSON.stringify({batch:35,ledger:'review-10',assigned:30,pending:3,currentScopeReviewRows:109,remaining:86}));
