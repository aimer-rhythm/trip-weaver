// 第39批正式同步后更新台账；全部证据先验证，既有批次与台账不能覆盖。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const url = p => new URL(p, import.meta.url);
const read = p => JSON.parse(fs.readFileSync(url(p), 'utf8'));
const sha = p => createHash('sha256').update(fs.readFileSync(url(p))).digest('hex');
const write = (p, data, fresh = true) => fs.writeFileSync(url(p), JSON.stringify(data, null, 2)+'\n', {flag:fresh?'wx':'w'});
const dir = 'priority-cities/济南/';
const batch = 'all-cities/batch-39/';
const pointer = read('cleaning-scope/current.json');
assert.equal(pointer.latestAppliedEntityBatch, 38);
assert.equal(pointer.cityReviewLedgers['济南'], '../'+dir+'review-16.json');
assert.ok(!fs.existsSync(url(dir+'review-17.json')));
const applied = read('all-cities/batch-39-applied.json'); assert.equal(applied.apply, true); assert.equal(applied.changes.length, 2);
const sync = read(batch+'sync-01/sync-state.json').cities['济南'];
assert.ok(sync.importedAt && sync.relationsImportedAt && sync.embeddingRunAt);
const consumed = read(dir+'lingyan-downstream-check-01.json'); assert.deepEqual(consumed.failures, []);
assert.equal(consumed.effectiveTypicalVisitMinutes, null); assert.equal(consumed.consumedFieldsVerified, 228);
const upstream = read('all-cities/batch-39-upstream-check.json'); assert.deepEqual(upstream.failures, []);
const vectors = read(batch+'sync-01/verification-vectors.json'); assert.deepEqual(vectors.failures, []);
const isolated = read(batch+'scope-preview-1791440695249945300/report.json');
assert.equal(isolated.reverseRollback, true); assert.equal(isolated.validDescriptionPreserved, true);
const flow = read('all-cities/flow/run-41/report.json'), audit = read('all-cities/audit/run-37/report.json');
assert.deepEqual(flow.failures, []); assert.deepEqual(audit.failures, []);
assert.equal(read('all-cities/flow/run-41/cleanup.json').removed, true);
const testLog = 'upstream-full-place_identity_test_1791441173971.log';
// 日志名由本次实际执行结果核实后填写；不能把未结束测试当通过。
assert.match(fs.readFileSync(url(testLog),'utf8'), /561 passed/);
const install = read('upstream-install.json');
for (const name of ['scripts/build_visit_duration.py', 'tests/test_build_visit_duration.py']) {
  const item = install.files.find(f => f.path===name); assert.ok(item && install.apply);
  assert.equal(item.after, sha('upstream/'+name));
  assert.equal(item.after, createHash('sha256').update(fs.readFileSync('D:/Project/xhs-travel-pipeline/'+name)).digest('hex'));
}
const eid = '29f4a4b260878eb8d9143b15b8fca54f';
const ledger = read(dir+'review-16.json'), beforeIds = ledger.rows.map(r => r.entityId);
const row = ledger.rows.find(r => r.entityId===eid); assert.ok(row); assert.equal(row.status, 'pending');
row.currentRevision=3; row.changeBatch=39; row.reviewBatch=39; row.status='reviewed_identity';
row.dimensions={identity:'reviewed_independent_temple',category:'reviewed_cultural_temple',location:'reviewed_reference_point',
  media:'no_upstream_imported_or_independent_images',consumedFacts:'reviewed_duration_budget_rejected_valid_mention_preserved'};
row.followup='原文及第5页原图已核；半天是时间不足劝退条件。第39批完整scope保留11686，文化与同名寺庙参考点保持，下游错误180分钟清除。有效彩塑看点、SQL/真实向量及图库已核，AI自查通过；原canonical缓存保留追溯但不再消费。';
row.evidenceFiles=[...new Set([...(row.evidenceFiles??[]),dir+'lingyan-duration-review-01.json',dir+'lingyan-downstream-check-01.json',
  dir+'lingyan-photo-sources-01.json','all-cities/batch-39-applied.json','all-cities/batch-39-upstream-check.json',batch+'sync-01/verification-vectors.json'])];
assert.deepEqual(ledger.rows.map(r=>r.entityId),beforeIds);
assert.equal(ledger.rows.length,98);
assert.equal(ledger.rows.filter(r=>['reviewed_identity','reviewed_same_entity','reviewed_alias_redirect'].includes(r.status)).length,19);
ledger.createdAt=new Date().toISOString(); ledger.previousLedger=dir+'review-16.json';
Object.assign(ledger.summary,{fullyReviewed:19,remainingPrimaryToReview:75,otherPendingPrimaryRows:69,governedScopeMentions:148,unappliedSemanticFindings:0,
  fullyReviewedMeaning:'AI自查19原入选行对应17现行主体；本轮新增灵岩寺，用户未验收。',
  scopeProgressMeaning:'98原入选行保留：4非地点、19行AI自查、75未完成，其中6行部分scope治理，其余69继续。范围内110审核行与4必去缺口不变。'});
write(dir+'review-17.json',ledger);
const stats={positive:flow.cities.reduce((n,c)=>n+c.probes.length,0),boundaries:flow.cities.reduce((n,c)=>n+c.negativeProbes.length,0),
  withdrawals:flow.cities.reduce((n,c)=>n+c.withdrawalProbes.length,0),pending:audit.cities.reduce((n,c)=>n+(c.statuses.PENDING??0),0)};
const progress='第39批灵岩寺完整scope及文化类别已应用，228地点/20关系双同步、SQL/真实向量和实际字段复核通过；唯一11686及彩塑看点、位置保留，错误180分钟不再导出消费，原canonical缓存保留追溯。抽取入口先检查整句否定/预算/通勤，再截窗且同篇去重；最终561上游回归通过。原107源/662提及/82原文、238旧行/39图片字段/9绑定及201历史行程保持。review17为98行：4非地点、19行AI自查（17主体）、75未完成，其中6行部分scope治理；110正式待审和4必去缺口不变。实体至39、图片03，flow41/audit37，无未同步或向量待复核。云南不处理，未验收，不提交归档。';
fs.writeFileSync(url(dir+'review-17.md'),'# 济南98项重点清单核查台账（第39批）\n\n'+progress+'\n\n| 原入选名称 | 版本 | 进度 | 说明 |\n| --- | ---: | --- | --- |\n'+ledger.rows.map(r=>`| ${r.name} | ${r.currentRevision} | ${r.status} | ${r.followup} |`).join('\n')+'\n',{flag:'wx'});
write('cleaning-scope/current-before-batch39.json',pointer);
pointer.latestAppliedEntityBatch=39; pointer.latestFlow='../all-cities/flow/run-41'; pointer.latestAudit='../all-cities/audit/run-37';
pointer.cityReviewLedgers['济南']='../'+dir+'review-17.json'; pointer.progressNote=progress; pointer.progressUpdatedAt=ledger.createdAt;
pointer.resolvedFindings=[...(pointer.resolvedFindings??[]),...pointer.unappliedFindings.filter(f=>f.entityId===eid).map(f=>({...f,
  status:'resolved_effective_duration_batch39',resolvedByEntityBatch:39,evidence:'../'+dir+'lingyan-downstream-check-01.json',
  conclusion:'错误180分钟已从有效导出与下游消费移除；原始源与旧派生缓存保留追溯，唯一有效提及不撤回。',next:'本项AI自查通过；继续其他重点主体。'}))];
pointer.unappliedFindings=pointer.unappliedFindings.filter(f=>f.entityId!==eid);
pointer.latestReviewEvidence={file:'../'+dir+'lingyan-downstream-check-01.json',fullReviewsAdded:1,partiallyReviewed:0};
assert.deepEqual(pointer.pendingVerification,[]); write('cleaning-scope/current.json',pointer,false);
const task=read('../task.json'); assert.equal(task.status,'in_progress'); task.notes=progress+'见research/batch39-jinan-lingyan-20261008.md。';write('../task.json',task,false);
for(const [file,marker,insert] of [
  ['../prd.md','## 已知事实\n','\n### 最新进展：第39批灵岩寺时长修复与完整自查\n\n'+progress+'见[第39批记录](research/batch39-jinan-lingyan-20261008.md)。以下为历史快照。\n'],
  ['nine-cities-continuation-20261007.md','## 本轮断点\n','\n当前以review17为准。'+progress+'下一步继续明水古城12581字段主语、野生动物园名称/园区与其余济南/八城重点；桥/门洞仍待边界裁定。以下为历史断点。\n'],
]) {
  let text=fs.readFileSync(url(file),'utf8');assert.ok(text.includes(marker));text=text.replace(marker,marker+insert);
  if(file==='../prd.md') text=text.replace('第38批已双同步，济南18行AI自查、76未完成','第39批已双同步，济南19行AI自查、75未完成');
  fs.writeFileSync(url(file),text);
}
for(const kind of ['implement','check']) {
  const f=url(`../${kind}.jsonl`),entry={file:'.trellis/tasks/10-06-place-identity-governance/research/batch39-jinan-lingyan-20261008.md',
    reason:'第39批已双同步：灵岩寺错误派生时长停止消费且有效提及保留，抽取入口修复已安装；review17剩75行，继续其他重点，禁止重放旧批次'};
  assert.ok(!fs.readFileSync(f,'utf8').includes(entry.file));fs.appendFileSync(f,JSON.stringify(entry)+'\n');
}
write(dir+'lingyan-final-verification-01.json',{batch:39,at:ledger.createdAt,stats,fullUpstreamTests:561,testLog,
  extractorInstalledSha256:sha('upstream/scripts/build_visit_duration.py'),reviewedPhoto:'all-cities/jinan-lingyan-images-01/note-2609-p05.webp',
  actualConsumedFacts:dir+'lingyan-downstream-check-01.json',remainingPrimaryToReview:75,userAcceptance:false});
console.log(JSON.stringify({ledger:'review-17',fullyReviewed:19,remaining:75,stats,entityBatch:39}));
