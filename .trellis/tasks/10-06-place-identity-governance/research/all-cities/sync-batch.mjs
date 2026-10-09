// 分步骤执行全城同步，导出冻结、导入事务留快照；中断后从未完成步骤恢复。
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {batchCities, validateScopeExpectations, validateBatchExport, validateImportPreflight} from './sync-contract.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../../..');
const upstream = path.resolve(root, '../xhs-travel-pipeline');
const [batch, step, attempt = 'sync-01'] = process.argv.slice(2);
assert.match(batch ?? '', /^batch-\d{2}(?:-v\d+)?$/);
assert.match(attempt, /^sync-\d{2}$/);
assert.ok(['export', 'import', 'embed'].includes(step));
const appliedPath=path.join(here,`${batch}-applied.json`);
assert.ok(fs.existsSync(appliedPath),'须等待正式应用结束并生成报告后再同步');
assert.equal(JSON.parse(fs.readFileSync(appliedPath,'utf8')).apply,true,'批次尚未正式应用');
const decisions = JSON.parse(fs.readFileSync(path.join(here, `${batch}-decisions.json`), 'utf8'));
const folder = path.join(here, batch, attempt);
fs.mkdirSync(folder, {recursive:true});
const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const decisionHash = digest(path.join(here, `${batch}-decisions.json`));
const scopePath = path.join(here, `${batch}-scope-decisions.json`);
const scopeDecisionHash = fs.existsSync(scopePath) ? digest(scopePath) : null;
const scopes = scopeDecisionHash ? JSON.parse(fs.readFileSync(scopePath, 'utf8')) : [];
const expectationsPath = path.join(here, `${batch}-export-expectations.json`);
const expectationsHash = fs.existsSync(expectationsPath) ? digest(expectationsPath) : null;
const expectations = expectationsHash ? JSON.parse(fs.readFileSync(expectationsPath, 'utf8')) : null;
const cities = batchCities(decisions, scopes);
validateScopeExpectations(decisions, scopes, expectations);
const manifestPath = path.join(folder, 'sync-state.json');
const state = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  : {batch, decisionHash, ...(scopeDecisionHash ? {scopeDecisionHash} : {}),
    ...(expectationsHash ? {expectationsHash} : {}), cities:{}};
assert.equal(state.decisionHash, decisionHash, '已冻结批次决策不能改写');
assert.equal(state.scopeDecisionHash ?? null, scopeDecisionHash, '已冻结逐提及分配不能改写');
assert.equal(state.expectationsHash ?? null, expectationsHash, '已冻结导出预期不能改写');
const save = () => fs.writeFileSync(manifestPath, JSON.stringify(state,null,2)+'\n');

async function run(command, args, cwd, logName) {
  const log = fs.createWriteStream(path.join(folder, logName), {flags:'a'});
  const child = spawn(command,args,{cwd,windowsHide:true,
    env:{...process.env,PYTHONIOENCODING:'utf-8'},stdio:['ignore','pipe','pipe']});
  child.stdout.pipe(log,{end:false}); child.stderr.pipe(log,{end:false});
  const code = await new Promise((resolve,reject) => {child.once('error',reject);child.once('close',resolve);});
  await new Promise(resolve=>log.end(resolve));
  assert.equal(code,0,`执行失败，查看 ${logName}`);
}

for (const city of cities) {
  const item = state.cities[city] ??= {};
  const file = path.join(folder, `xhs-places-${city}.json`);
  if (step === 'export') {
    if (item.exportHash) { assert.equal(digest(file),item.exportHash); continue; }
    assert.ok(!fs.existsSync(file),'未登记的导出文件须先检查，不能覆盖');
    await run(path.join(upstream,'.venv/Scripts/python.exe'), ['-B','scripts/export_to_tripweaver.py',
      '--city',city,'--out',file], upstream, `export-${city}.log`);
    const data = JSON.parse(fs.readFileSync(file,'utf8'));
    validateBatchExport(data, city, decisions, expectations);
    Object.assign(item,{exportHash:digest(file),exportedAt:new Date().toISOString(),places:data.places.length});
    if (data.relationIdentity) {
      const relationFile = path.join(folder, `xhs-place-relations-${city}.json`);
      const relations = JSON.parse(fs.readFileSync(relationFile, 'utf8'));
      assert.deepEqual(relations.relationIdentity, data.relationIdentity, '地点与关系不是同一来源快照');
      Object.assign(item, {relationHash: digest(relationFile), relationSnapshotRevision: data.relationIdentity.revision});
    }
  } else {
    assert.ok(item.exportHash,'必须先导出'); assert.equal(digest(file),item.exportHash,'导出被改写');
    if (step === 'import') {
      if (!item.importedAt) {
        // 新导入必须有成功的实库前置检查；参数/编排失败不能继续写入。
        const preflightFile = path.join(folder, 'pre-import-check.json');
        assert.ok(fs.existsSync(preflightFile), '缺少成功的导入前检查；先执行 check-batch-state.mts before <batch>');
        const preflight = JSON.parse(fs.readFileSync(preflightFile, 'utf8'));
        validateImportPreflight(preflight, city, item.exportedAt);
        await run(process.execPath,['--import','tsx','scripts/seed-xhs-places.ts',file],
          path.join(root,'apps/server'),`import-${city}.log`);
        item.importedAt = new Date().toISOString();
        save(); // 后续关系失败时不重放已经成功的地点导入。
      }
      if (item.relationHash && !item.relationsImportedAt) {
        const relationFile = path.join(folder, `xhs-place-relations-${city}.json`);
        assert.equal(digest(relationFile), item.relationHash, '关系导出被改写');
        await run(process.execPath,['--import','tsx','scripts/seed-xhs-relations.ts',relationFile],
          path.join(root,'apps/server'),`relations-${city}.log`);
        item.relationsImportedAt = new Date().toISOString();
      }
    } else {
      assert.ok(item.importedAt,'必须先导入');
      assert.ok(!item.relationHash || item.relationsImportedAt, '同版本关系尚未导入');
      // 回填命令是幂等的；退出 0 只记执行，不等于覆盖率通过，最终由实际库探针核验。
      await run(process.execPath,['--import','tsx','scripts/embed-backfill.ts','--tables','places','--city',city],
        path.join(root,'apps/server'),`embed-${city}.log`);
      item.embeddingRunAt = new Date().toISOString();
    }
  }
  save();
  console.log(JSON.stringify({batch,step,city,...item}));
}
