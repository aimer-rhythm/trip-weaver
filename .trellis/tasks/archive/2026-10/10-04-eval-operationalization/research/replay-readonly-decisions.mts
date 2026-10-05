// 回放已经保存的真实失败输出；不调用模型、不连接数据库、不改原报告。
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { applyDialogueDecision } from '../../../../../../apps/server/src/chat/brief';
import { hashSources, writeJson } from '../../../../../../eval/artifacts';

const campaign = path.resolve('eval/runs/campaign-2026-10-05-live-matrix');
const source = '2026-10-04T16-52-53-763Z-ef1eb0a0/intent-report.json';
const report = JSON.parse(fs.readFileSync(path.join(campaign, source), 'utf8'));
const originals = report.results.filter((r: { status: string }) => r.status === 'FAIL');
assert.equal(originals.length, 2);
const results = originals.map((r: (typeof report.results)[number]) => {
  const before = structuredClone(r.input.brief);
  const next = applyDialogueDecision(r.input.brief, r.observation.decision, 10);
  assert.equal(r.observation.intent, 'travel_qa');
  assert.deepEqual(next, before);
  assert.deepEqual(r.input.brief, before);
  return { id: r.id, attempt: r.attempt, status: 'PASS', decision: r.observation.decision, before, next };
});
const output = path.join(campaign, 'retests-small-fixes/readonly-decision-replay.json');
assert.ok(!fs.existsSync(output), '不覆盖已经完成的回放');
writeJson(output, { source, runtimeHash: hashSources(['apps/server/src/chat/brief.ts']), results });
console.log(`真实只读失败输出回放：${results.length}/${results.length} PASS；${output}`);
