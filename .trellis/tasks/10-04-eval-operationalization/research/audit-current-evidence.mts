// 交付证据审计：读取既有产物与当前源文件，不调用模型，不改应用或原报告。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { hashSources, readReport, writeJson } from '../../../../eval/artifacts';
import { parseSnapshot } from '../../../../eval/contracts';
import { MATRIX_CASES, NOTE_CASES } from '../../../../eval/scenarios';

const campaign = path.resolve('eval/runs/campaign-2026-10-05-live-matrix');
const read = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));
const summary = read(path.join(campaign, 'summary/summary.json'));
const expected = [...MATRIX_CASES, ...NOTE_CASES].map((c) => c.id).sort();
const observed: string[] = [];
const failures: string[] = [];
for (const item of summary.runs) {
  const file = path.join(campaign, item.file);
  const report = readReport(file);
  for (const c of report.cases) {
    const snapshot = parseSnapshot(read(path.join(path.dirname(file), 'snapshots', `${c.caseId}.json`)));
    assert.equal(snapshot.caseId, c.caseId);
    assert.notEqual(snapshot.form.destination, '云南');
    observed.push(c.caseId);
    if (c.status !== 'PASS') failures.push(c.caseId);
  }
}
assert.deepEqual(observed.sort(), expected, '原始报告必须精确覆盖当前矩阵与备注集合，不漏例、不重复');
assert.equal(failures.length, 3);

const flowDirectory = path.resolve('eval/runs/flow-2026-10-04T17-56-56-425Z');
const flow = read(path.join(flowDirectory, 'flow-report.json'));
const flowHash = hashSources(['eval/flow.ts', 'eval/currentFlow.ts', 'scripts', 'apps/server/src', 'apps/web/src', 'packages/shared/src']);
assert.equal(flow.runtimeHash, flowHash, '流程验证后源文件已变化，需要重新评估证据有效性');
assert.equal(flow.complete, true);
assert.equal(flow.results.length, 12);
for (const stage of flow.results) {
  assert.equal(stage.status, 'PASS');
  assert.ok(fs.statSync(path.join(flowDirectory, stage.log)).size > 0);
}

const intent = read(path.join(campaign, 'retests-small-fixes/intent-context-v2/2026-10-04T17-56-45-566Z-695eaac6/intent-report.json'));
const intentHash = hashSources(['apps/server/src/chat', 'apps/server/src/generation/agents', 'apps/server/src/generation/model.ts', 'eval/intent.ts', 'eval/intentCases.ts']);
assert.equal(intent.runtimeHash, intentHash, '意图验证后运行代码或测试输入已变化');
assert.equal(intent.complete, true);
assert.equal(intent.results.length, 40);
assert.ok(intent.results.every((r: { status: string }) => r.status === 'PASS'));

const coverage = read(path.join(campaign, 'summary/place-coverage.json'));
const eligible = coverage.rows.filter((r: { exclusion: string | null }) => !r.exclusion);
const totals = {
  eligible: eligible.length,
  candidate: eligible.filter((r: { candidateCases: string[] }) => r.candidateCases.length > 0).length,
  selected: eligible.filter((r: { selectedCases: string[] }) => r.selectedCases.length > 0).length,
  uncovered: eligible.filter((r: { candidateCases: string[]; selectedCases: string[] }) => !r.candidateCases.length && !r.selectedCases.length).length,
};
assert.deepEqual(totals, { eligible: 4705, candidate: 430, selected: 319, uncovered: 4275 });
const task = read(path.resolve('.trellis/tasks/10-04-eval-operationalization/task.json'));
assert.equal(task.status, 'in_progress');
assert.equal(task.commit, null);
const result = {
  checkedAt: new Date().toISOString(),
  evidenceConsistent: true,
  objectiveComplete: false,
  generation: { observed: observed.length, expected: expected.length, originalFailures: failures },
  flow: { stages: 12, pass: 12, currentRuntimeMatches: true, runtimeHash: flowHash },
  intent: { attempts: 40, pass: 40, currentRuntimeMatches: true, runtimeHash: intentHash },
  placeCoverage: totals,
  pending: ['北京两个闭馆排程失败的核心修复，方案已交付待用户确认', '上游营业信息归属修复，方案已交付待用户确认', '用户验收'],
};
const output = path.join(campaign, `evidence-audit-${Date.now()}.json`);
writeJson(output, result);
console.log(JSON.stringify({ ...result, output }, null, 2));
