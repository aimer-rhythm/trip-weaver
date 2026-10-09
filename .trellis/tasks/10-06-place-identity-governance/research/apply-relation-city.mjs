// 只应用已经通过真实冻结库预演的两份文件；每一步单独留日志和状态，未决步骤禁止重放。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { parse } from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const folder = path.resolve(process.argv[2] ?? '');
assert.equal(path.dirname(folder), path.join(here, 'relation-sync'));
assert.match(path.basename(folder), /^run-\d+$/);
const statePath = path.join(folder, 'state.json');
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
assert.equal(state.phase, 'frozen', '仅接受尚未开始应用的当前冻结；中断步骤须先核实实际进程及审计，禁止重放');
assert.equal(state.placesImported, false); assert.equal(state.relationsImported, false);
const save = () => {
  fs.writeFileSync(statePath + '.tmp', JSON.stringify(state, null, 2));
  fs.renameSync(statePath + '.tmp', statePath);
};
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const placesFile = path.join(folder, `xhs-places-${state.city}.json`);
const relationsFile = path.join(folder, `xhs-place-relations-${state.city}.json`);
assert.equal(hash(placesFile), state.placesHash); assert.equal(hash(relationsFile), state.relationsHash);
assert.equal(hash(path.join(folder, 'library-before.json')), state.libraryHash);
const preview = fs.readdirSync(folder).filter(name => /^preview-\d+\.json$/.test(name))
  .map(name => JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8')))
  .find(report => report.preview && report.reverseRollback && report.city === state.city && report.failures.length === 0
    && ['placesHash', 'relationsHash', 'libraryHash', 'sourceHash'].every(key => report[key] === state[key]));
assert.ok(preview, '没有对应当前文件的成功隔离预演');
const config = parse(fs.readFileSync(path.join(root, 'apps/server/.env')));
const upstreamConfig = parse(fs.readFileSync(path.resolve(root, '../xhs-travel-pipeline/.env')));
const client = new Client({ connectionString: config.DATABASE_URL, connectionTimeoutMillis: 10000 });
const upstream = new Client({ connectionString: upstreamConfig.DATABASE_URL.replace('postgresql+asyncpg:', 'postgresql:'), connectionTimeoutMillis: 10000 });
const expectedManifest = JSON.parse(fs.readFileSync(placesFile, 'utf8')).relationIdentity;
assert.equal(expectedManifest.sourceState.algorithmVersion, 3, '当前应用须使用已通过全城证据审阅的算法3');
const review = JSON.parse(fs.readFileSync(path.join(folder, 'evidence-review.json'), 'utf8'));
assert.equal(review.scope, 'all_direct_evidence_and_boundary_deltas');
assert.equal(review.placesHash, state.placesHash); assert.equal(review.relationsHash, state.relationsHash);
assert.equal(review.sourceHash, expectedManifest.sourceHash); assert.equal(review.relationHash, expectedManifest.relationHash);
const checkSource = async () => {
  const result = await upstream.query('SELECT revision,payload FROM place_relation_snapshot WHERE city=$1', [state.city]);
  assert.equal(result.rows[0]?.revision, expectedManifest.revision, '上游已发布新的来源版本');
  assert.equal(result.rows[0]?.payload.sourceHash, expectedManifest.sourceHash, '上游来源已变化');
  assert.equal(result.rows[0]?.payload.relationHash, expectedManifest.relationHash, '上游关系已变化');
};
const tripDigest = async () => (await client.query(`SELECT count(*)::int count,
  md5(COALESCE(string_agg(h,'' ORDER BY h),'')) digest FROM (SELECT md5(to_jsonb(t)::text) h FROM trips t) x`)).rows[0];
const run = async (kind, file) => {
  const log = fs.createWriteStream(path.join(folder, `apply-${kind}.log`), { flags: 'wx' });
  state.phase = `importing_${kind}`; save();
  const child = spawn(process.execPath, ['--import', 'tsx', `scripts/seed-xhs-${kind}.ts`, file], {
    cwd: path.join(root, 'apps/server'), windowsHide: true, env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  state.childPid = child.pid; save();
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
  const exitCode = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  await new Promise(resolve => log.end(resolve));
  assert.equal(exitCode, 0, `${kind}导入失败；核实日志与审计后恢复，不重放`);
  state[`${kind}Imported`] = true;
  delete state.childPid;
  save();
};
try {
  await client.connect(); await upstream.connect();
  await checkSource();
  const library = JSON.parse(fs.readFileSync(path.join(folder, 'library-before.json'), 'utf8'));
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  for (const table of ['canonical_places', 'research_evidence', 'place_relation', 'data_import', 'independent_photo_assignments', 'place_relation_snapshots']) {
    const current = (await client.query(`SELECT to_jsonb(t) value FROM ${table} t WHERE city=$1 ORDER BY to_jsonb(t)::text`, [state.city])).rows.map(r => r.value);
    assert.deepEqual(current, library.tables[table], `下游${table}已偏离冻结，须重新预演`);
  }
  const beforeTrips = await tripDigest();
  await client.query('ROLLBACK');
  state.beforeTrips = beforeTrips; save();
  await run('places', placesFile);
  await run('relations', relationsFile);
  await checkSource();
  const afterTrips = await tripDigest();
  assert.deepEqual(afterTrips, beforeTrips, '行程摘要变化，须核实并发写入或迁移影响');
  const imports = (await client.query(`SELECT source,content_hash,row_count FROM data_import
    WHERE city=$1 AND source IN ('xhs_places','xhs_relations') ORDER BY source`, [state.city])).rows;
  assert.equal(imports.find(r => r.source === 'xhs_places')?.content_hash, state.placesHash.slice(0, 32));
  assert.equal(imports.find(r => r.source === 'xhs_relations')?.content_hash, state.relationsHash.slice(0, 32));
  assert.equal(imports.find(r => r.source === 'xhs_relations')?.row_count, preview.strongUsable);
  const audits = (await client.query('SELECT id,content_hash FROM place_identity_imports WHERE city=$1 AND content_hash=ANY($2::text[]) ORDER BY created_at',
    [state.city, [state.placesHash.slice(0, 32), state.relationsHash.slice(0, 32)]])).rows;
  Object.assign(state, { phase: 'imported', afterTrips, imports, audits, importedAt: new Date().toISOString() });
  save();
  console.log(JSON.stringify({ city: state.city, phase: state.phase, strongUsable: preview.strongUsable, audits, tripsUnchanged: true }));
} finally { await client.query('ROLLBACK').catch(() => {}); await client.end(); await upstream.end(); }
