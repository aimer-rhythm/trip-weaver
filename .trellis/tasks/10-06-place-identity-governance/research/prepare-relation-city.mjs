// 每城新目录：发布双文件、冻结当前知识库、专用数据库执行正式双导入及倒序回滚。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const upstream = path.resolve(root, '../xhs-travel-pipeline');
const [runId, city, reviewedAudit] = process.argv.slice(2);
assert.match(runId ?? '', /^run-\d{2}$/);
assert.ok(['上海','云南','北京','厦门','广州','成都','杭州','济南','西安','重庆'].includes(city));
const folder = path.join(here, 'relation-sync', runId);
assert.ok(!fs.existsSync(folder), '中断目录先核实原进程与文件，不重放');
fs.mkdirSync(folder);
const statePath = path.join(folder, 'state.json');
const save = value => fs.writeFileSync(statePath, JSON.stringify(value, null, 2));
save({ city, phase: 'exporting', placesImported: false, relationsImported: false });
async function run(command, args, cwd, name, extraEnv = {}) {
  const log = fs.createWriteStream(path.join(folder, name), { flags: 'wx' });
  const child = spawn(command, args, { cwd, windowsHide: true, stdio: ['ignore','pipe','pipe'],
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', ...extraEnv } });
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  save({ ...state, activeStep: name, childPid: child.pid });
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  // 冻结脚本的完整证据留文件，终端仅报步骤，便于逐城审阅。
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  await new Promise(resolve => log.end(resolve));
  assert.equal(code, 0, `步骤失败：${runId}/${name}`);
  const next = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  delete next.childPid; delete next.activeStep; save(next);
  console.log(JSON.stringify({ city, runId, step: name, exitCode: code }));
}
await run(path.join(upstream, '.venv/Scripts/python.exe'), ['-B', 'scripts/export_to_tripweaver.py', '--city', city,
  '--out', path.join(folder, `xhs-places-${city}.json`)], upstream, 'export.log');
await run(process.execPath, ['--import','tsx',path.join(here,'freeze-relation-city.mts'),folder], root, 'freeze.log');
await run(process.execPath, [path.join(here,'run-tests.mjs'),path.join(here,'verify-relation-city.test.mts')], root, 'preview.log',
  { RELATION_CITY_FIXTURE: pathToFileURL(folder + path.sep).href });
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
if (reviewedAudit) {
  const audit = path.resolve(reviewedAudit);
  assert.equal(path.dirname(audit), here);
  assert.match(path.basename(audit), /^mention-relations-audit-\d+$/);
  const reportBytes = fs.readFileSync(path.join(audit, 'report.json'));
  const entry = JSON.parse(reportBytes).cities.find(item => item.city === city);
  assert.ok(entry);
  assert.equal(path.basename(entry.file), entry.file);
  const sourceBytes = fs.readFileSync(path.join(audit, entry.file));
  const source = JSON.parse(sourceBytes);
  const exported = JSON.parse(fs.readFileSync(path.join(folder, `xhs-place-relations-${city}.json`), 'utf8'));
  assert.equal(source.sourceHash, exported.relationIdentity.sourceHash, '来源偏离已审阅只读试算');
  assert.equal(source.relationHash, exported.relationIdentity.relationHash, '关系偏离已审阅只读试算');
  assert.deepEqual(source.relations, exported.relations);
  fs.writeFileSync(path.join(folder, 'evidence-review.json'), JSON.stringify({
    scope: 'all_direct_evidence_and_boundary_deltas', audit: path.basename(audit),
    reportHash: createHash('sha256').update(reportBytes).digest('hex'),
    cityFileHash: createHash('sha256').update(sourceBytes).digest('hex'),
    placesHash: state.placesHash, relationsHash: state.relationsHash,
    sourceHash: source.sourceHash, relationHash: source.relationHash, reviewedAt: new Date().toISOString(),
  }, null, 2), { flag: 'wx' });
}
console.log(JSON.stringify({city,runId,phase:state.phase,counts:state.counts}));
