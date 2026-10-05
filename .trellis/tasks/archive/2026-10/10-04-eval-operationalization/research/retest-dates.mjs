// 已授权范围：北京两份原失败输入 + 3/5日各偏好；各批独立保存，不覆盖旧报告。
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
const out = `eval/runs/date-retest-${Date.now()}`;
fs.mkdirSync(out);
const stages = [
  ['avoid-remote', '--suite', 'notes', '--case', 'beijing-notes-avoid-remote'],
  ['food-no-spicy', '--suite', 'notes', '--case', 'beijing-notes-food-no-spicy'],
  ['beijing-matrix', '--suite', 'matrix', '--city', '北京'],
];
const results = [];
for (const [id, ...args] of stages) {
  console.log(`START ${id} ${out}`);
  const log = fs.openSync(path.join(out, `${id}.log`), 'wx');
  const child = spawn(process.execPath, ['--import', 'tsx', 'eval/run.ts', '--live', ...args,
    '--knowledge', 'frozen', '--knowledge-snapshot', 'eval/knowledge-snapshots/kb-2026-10-05-matrix', '--out', path.join(out, id)],
    { env: process.env, stdio: ['ignore', log, log], windowsHide: true });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  fs.closeSync(log);
  results.push({ id, exitCode: code });
  fs.writeFileSync(path.join(out, 'progress.json'), JSON.stringify({ out, results }, null, 2));
  console.log(`END ${id} ${code}`);
}
process.exitCode = results.some((r) => r.exitCode !== 0) ? 1 : 0;
