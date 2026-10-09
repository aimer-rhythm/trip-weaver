// 补记已存在的工件，不执行迁移、治理、同步或任务收尾。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const url = f => new URL(f, import.meta.url);
const read = f => JSON.parse(fs.readFileSync(url(f), 'utf8'));
const digest = f => createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const pointer = read('cleaning-scope/current.json');
assert.equal(pointer.latestAppliedEntityBatch, 35);
assert.equal(pointer.cityReviewLedgers['济南'], '../priority-cities/济南/review-12.json');
assert.ok(!fs.existsSync(url('all-cities/batch-36-applied.json')));
assert.equal(digest(url('all-cities/batch-36-source.json')), 'a190876abe15758195d146c395a0313f1e6619b2c422b11eb18a9d39359face6');
const preview = read('all-cities/batch-36/scope-preview-1791418665241022500/report.json');
assert.equal(preview.isolated, true); assert.equal(preview.reverseRollback, true);
assert.equal(preview.resolved, 10); assert.deepEqual(preview.pending, [12692]);
assert.equal(preview.durationFieldsExcluded, 4);
const installed = read('upstream-install.json'); assert.equal(installed.apply, true);
for (const item of installed.files) {
  assert.equal(digest(new URL(item.path, url('upstream/'))), item.after, item.path);
  assert.equal(digest(new URL(item.path, 'file:///D:/Project/xhs-travel-pipeline/')), item.after, item.path);
}
const migration = read('mention-fact-exclusions-migration-1791403818698220800.json');
assert.equal(migration.apply, true); assert.equal(migration.dataUnchanged, true);
assert.deepEqual(migration.repeated.missingColumns, []);
fs.writeFileSync(url('cleaning-scope/current-before-batch36-start.json'), JSON.stringify(pointer, null, 2) + '\n', { flag: 'wx' });
const progress = '字段级时长治理代码已安装、可空列迁移完成；第36批四泉决定已准备并通过真实资料隔离预演（10确认、12692待审、4时长排除），尚未正式应用或同步。实体最新已应用仍35、图片03；review-12保持98项、4非地点、11行AI自查、83未完成，范围内109待审和4必去缺口不变。接续正式事务预演、应用、完整济南双同步与验证；云南不处理，未验收，不提交归档。';
pointer.preparedEntityBatch = { batch: 36, status: 'isolated_preview_passed_not_applied', evidence: '../all-cities/batch-36/scope-preview-1791418665241022500/report.json' };
pointer.progressNote = progress; pointer.progressUpdatedAt = new Date().toISOString();
fs.writeFileSync(url('cleaning-scope/current.json'), JSON.stringify(pointer, null, 2) + '\n');
const task = read('../task.json'); assert.equal(task.status, 'in_progress'); task.notes = progress;
fs.writeFileSync(url('../task.json'), JSON.stringify(task, null, 2) + '\n');
for (const [file, marker, title] of [['../prd.md', '## 已知事实\n', '### 最新进展：第36批已准备，尚未应用'], ['nine-cities-continuation-20261007.md', '## 本轮断点\n', '### 第36批准备断点']]) {
  const content = fs.readFileSync(url(file), 'utf8'); assert.ok(content.includes(marker));
  fs.writeFileSync(url(file), content.replace(marker, marker + '\n' + title + '\n\n' + progress + '以下为历史快照。\n'));
}
for (const name of ['implement', 'check']) {
  const file = url(`../${name}.jsonl`);
  const entry = { file: '.trellis/tasks/10-06-place-identity-governance/research/mention-fact-exclusion-design-20261008.md', reason: '第36批字段级时长排除已安装并迁移；保留主体、有效描述与原始指纹，待正式应用和同步' };
  if (!fs.readFileSync(file, 'utf8').includes(entry.file)) fs.appendFileSync(file, JSON.stringify(entry) + '\n');
}
console.log(JSON.stringify({ prepared: 36, applied: 35, installedFilesVerified: installed.files.length, migrationVerified: true }));
