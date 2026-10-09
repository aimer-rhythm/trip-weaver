import fs from 'node:fs';
import assert from 'node:assert/strict';
const read = file => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), 'utf8'));
const write = (file, value, exclusive = true) => fs.writeFileSync(new URL(file, import.meta.url),
  JSON.stringify(value, null, 2) + '\n', { flag: exclusive ? 'wx' : 'w' });
const flow = read('all-cities/flow/run-33/report.json');
assert.deepEqual(flow.failures, []);
assert.equal(read('all-cities/flow/run-33/cleanup.json').removed, true);
const verification = read('all-cities/batch-31/sync-01/verification-vectors.json');
assert.deepEqual(verification.failures, []);
assert.equal(verification.cities[0].withdrawals.length, 4);
assert.ok(verification.cities[0].withdrawals.every(w => w.diagnostics.vector === 'used'));
const sync = read('all-cities/batch-31/sync-01/sync-state.json').cities['济南'];
assert.ok(sync.importedAt && sync.relationsImportedAt && sync.embeddingRunAt);
const original = read('all-cities/batch-31-upstream-check.json');
assert.equal(original.excludedMentionsVerified, 8);
assert.deepEqual(original.failures, []);
const ledger = read('priority-cities/济南/review-01.json');
ledger.createdAt = new Date().toISOString();
ledger.previousLedger = 'priority-cities/济南/review-01.json';
const scopes = read('all-cities/batch-31-scope-decisions.json');
for (const scope of scopes) {
  const id = Object.keys(scope.expectedRevisions)[0];
  const row = ledger.rows.find(r => r.entityId === id);
  assert.ok(row);
  row.currentRevision = 2;
  row.status = 'reviewed_non_place_excluded';
  row.dimensions = { identity: 'reviewed_non_place', category: 'not_a_place',
    location: 'not_applicable', media: 'withdrawal_verified' };
  row.changeBatch = 31;
  row.evidenceFiles = ['all-cities/batch-31-source.json', 'all-cities/batch-31-applied.json',
    'all-cities/batch-31-upstream-check.json', 'all-cities/batch-31/sync-01/verification-vectors.json'];
  row.followup = 'note2560的两条提及均已确认仅为菜品/品类，已显式撤回地点候选。旧ID及原始资料保留，新提及或原文变化须重新核查。';
}
ledger.summary.reviewedNonPlaceExcluded = 4;
ledger.summary.remainingPrimaryToReview = 94;
write('priority-cities/济南/review-02.json', ledger);
const md = '# 济南98项重点清单核查台账（第31批后）\n\n保留原98项：4项已确认非地点并撤回，94项继续逐项核查；位置修正不等于整项验收。\n\n'
  + '| 地点 | 版本 | 处理进度 | 后续 |\n| --- | ---: | --- | --- |\n'
  + ledger.rows.map(r => `| ${r.name} | ${r.currentRevision} | ${r.status === 'reviewed_non_place_excluded' ? r.status : r.dimensions.location} | ${r.followup} |`).join('\n') + '\n';
fs.writeFileSync(new URL('priority-cities/济南/review-02.md', import.meta.url), md, { flag: 'wx' });
const pointer = read('cleaning-scope/current.json');
write('cleaning-scope/current-before-batch31.json', pointer);
Object.assign(pointer, { latestAppliedEntityBatch: 31, latestFlow: '../all-cities/flow/run-33',
  latestAudit: '../all-cities/audit/run-29', cityReviewLedgers: { ...pointer.cityReviewLedgers,
    济南: '../priority-cities/济南/review-02.json' }, progressUpdatedAt: new Date().toISOString(),
  progressNote: 'scope06保留batch29后的固定入选集合。batch30修正10项位置；batch31确认4项非地点/8提及并撤回，地点关系已双同步。济南原98项保留，4项排除、94项继续核查，7项仍待定位。不得把旧范围版本当作新扫描或把清空位置者移出台账。' });
write('cleaning-scope/current.json', pointer, false);
const task = read('../task.json');
task.notes = '用户目标：云南不处理，继续其余九城直到明确验收。scope06为batch29后的固定入选基线：978主体+56依赖/1135源，50对重点待审+4必去缺口；89普通长尾暂缓、37已隔离错城来源归属待审保留。最新research/batch31-non-place-20261008.md：明确非地点排除已安装迁移，519上游/26下游及全仓typecheck通过，八治理表旧行摘要不变。batch31已应用4scope/8提及，4菜品实体显式撤回，230地点/25关系双同步（226有效地点、13强边）；4真实向量排除、旧ID和238旧行保留，107原源/662提及与201历史行程摘要不变。flow/run-33为12城279正例/113独立包含/45撤回0失败，audit/run-29仍180PENDING行，图片0异常0。济南review-02保留98项：4非地点排除、94继续核查，7仍待定位。01-v2至31禁止重放，无batch32或待同步步骤。未验收，不提交/归档/标记完成/push。';
write('../task.json', task, false);
console.log(JSON.stringify({ batch: 31, ledger: 'review-02', excluded: 4, remainingPrimaryToReview: 94,
  positive: flow.cities.reduce((n,c) => n+c.probes.length,0),
  negative: flow.cities.reduce((n,c) => n+c.negativeProbes.length,0),
  withdrawals: flow.cities.reduce((n,c) => n+c.withdrawalProbes.length,0) }));
