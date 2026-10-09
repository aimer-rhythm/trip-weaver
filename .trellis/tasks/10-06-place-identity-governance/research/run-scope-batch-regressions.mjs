// 仅在一次性库重建已应用批次，加载暂存模块；不重放实库、不覆盖冻结预演报告。
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
const batches = Array.from({ length: 23 }, (_, i) => `batch-${String(i + 1).padStart(2, '0')}${[0, 4].includes(i) ? '-v2' : ''}`);
const results = [];
for (const batch of batches) {
  const child = spawn(process.execPath, ['.trellis/tasks/10-06-place-identity-governance/research/run-upstream-tests.mjs',
    '--batch-preview', batch, '--staged'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  const result = { batch, exitCode: code, output };
  results.push(result);
  console.log(JSON.stringify(result));
  if (code !== 0) { process.exitCode = 1; break; }
}
const file = `scope-batch-regression-${Date.now()}.json`;
await writeFile(new URL(file, import.meta.url), JSON.stringify({ isolated: true, results }, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ file, passed: results.filter(r => r.exitCode === 0).length, total: batches.length }));
