// 最终交付只读审计；不运行生成，不改原报告，不标记验收/提交。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { hash, createManifest, readReport, hashSources, writeJson } from '../../../../../../eval/artifacts';
import { readFrozen } from '../../../../../../eval/frozenKnowledge';

const root = 'eval/runs/date-retest-1791169501846';
const paths = [
  `${root}/avoid-remote/2026-10-05T03-05-02-502Z-35e07223/report.json`,
  `${root}/food-no-spicy/2026-10-05T03-05-33-767Z-59c681d7/report.json`,
  `${root}/beijing-matrix/2026-10-05T03-06-13-120Z-45e8313b/report.json`,
  'eval/runs/hours-preview-2026-10-05-v2/live/2026-10-05T03-20-46-550Z-d2f77f33/report.json',
  'eval/runs/hours-applied-live-2026-10-05/2026-10-05T04-12-38-530Z-6f873112/report.json',
];
const runtime = createManifest([], 'live', 'full').runtimeHash;
const reports = paths.map((file) => {
  const report = readReport(file);
  assert.equal(report.manifest.runtimeHash, runtime, `${file}: 测试后的产品/评估代码漂移`);
  assert.ok(report.gate.pass && report.cases.every((c) => c.status === 'PASS'));
  return { file, cases: report.cases.map((c) => ({ id: c.caseId, status: c.status, problems: c.problems })), gate: report.gate };
});
assert.equal(reports.reduce((sum, r) => sum + r.cases.length, 0), 12);
const flowPath = 'eval/runs/flow-2026-10-05T03-12-13-907Z/flow-report.json';
const flow = JSON.parse(fs.readFileSync(flowPath, 'utf8'));
assert.equal(flow.runtimeHash, hashSources(['eval/flow.ts', 'eval/currentFlow.ts', 'scripts', 'apps/server/src', 'apps/web/src', 'packages/shared/src']));
assert.ok(flow.complete && flow.results.length === 12 && flow.results.every((r: any) => r.status === 'PASS'));
const replay = JSON.parse(fs.readFileSync('eval/runs/date-replay-1791169006716/report.json', 'utf8'));
assert.equal(replay.rows.length, 96);
for (const row of replay.rows) {
  assert.equal(row.status, 'PASS');
  assert.equal(row.sourceHash, hash(fs.readFileSync(row.source, 'utf8')));
}
// 回放之后加了最终保存守卫和纯函数整理；相同排程仍通过最终源文件对应的单测与12例真实执行。
const original = readFrozen('eval/knowledge-snapshots/kb-2026-10-05-matrix');
assert.equal(original.contentHash, 'f5a31c5092769d093bbcd4f6eca7e265c3111b480d42c238b02be9b89b9cb3c6');
const preview = JSON.parse(fs.readFileSync('eval/runs/hours-preview-2026-10-05-v2/preview.json', 'utf8'));
assert.equal(readFrozen(preview.candidateDirectory).contentHash, preview.candidateKnowledgeHash);
assert.equal(preview.status, 'PREVIEW_NOT_APPLIED');
// 原预览保留当时状态；新应用证据独立保存，不重写历史交付审计。
const applied = readFrozen('eval/knowledge-snapshots/kb-2026-10-05-hours-applied');
assert.equal(applied.contentHash, preview.candidateKnowledgeHash);
const applicationPath = 'eval/runs/hours-apply-1791173395975';
const application = JSON.parse(fs.readFileSync(`${applicationPath}/result.json`, 'utf8'));
assert.equal(application.updated, 402);
assert.equal(application.protectedFieldsVerified, true);
const readback = JSON.parse(fs.readFileSync(`${applicationPath}/verification-1791173546137.json`, 'utf8'));
assert.equal(readback.appliedKnowledgeHash, applied.contentHash);
assert.equal(readback.rowsReadBack, 402);
assert.equal(readback.sourceNonHoursFieldsUnchanged, true);
const knowledgeVerification = JSON.parse(fs.readFileSync('eval/runs/verify-knowledge-1791173500003/verification.json', 'utf8'));
assert.equal(knowledgeVerification.contentHash, applied.contentHash);
assert.equal(knowledgeVerification.rowContentHashesMatch, true);
assert.equal(knowledgeVerification.vectorQueryVerified, true);
assert.equal(knowledgeVerification.isolatedDatabaseCleaned, true);
for (const lock of ['eval/data/live.lock', 'eval/runs/campaign-2026-10-05-live-matrix/campaign.lock']) assert.ok(!fs.existsSync(lock));
const task = JSON.parse(fs.readFileSync('.trellis/tasks/archive/2026-10/10-04-eval-operationalization/task.json', 'utf8'));
assert.equal(task.status, 'in_progress');
assert.equal(task.commit, null);
const output = `${applicationPath}/delivery-audit-${Date.now()}.json`;
writeJson(output, { checkedAt: new Date().toISOString(), runtime, reports, flowPath, flowStages: 12,
  original96SnapshotsUnchanged: true, originalKnowledgeUnchanged: true, previewRows: preview.changedRows,
  previewSemanticChanges: preview.semanticChanges, productionKnowledgeApplied: true,
  appliedKnowledgeHash: applied.contentHash, applicationPath, knowledgeVerification,
  acceptance: 'pending_user', taskStatus: task.status });
console.log(`PASS 12例真实执行与完整流程对应当前代码，96份原快照/原冻结库保持不变；402条预览已应用，等待用户验收。\n${output}`);
