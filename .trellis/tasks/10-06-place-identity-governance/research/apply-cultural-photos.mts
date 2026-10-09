// 仅修改已核实五张独立图片分配；不导入启动迁移、不改地点/原目录/行程。
import assert from 'node:assert/strict';
import { open, readFile, readdir } from 'node:fs/promises';
import { Client, type PoolClient } from 'pg';
import { parse } from 'dotenv';
import { applyIndependentPhotoDecision, loadIndependentPhotoAssignments, type IndependentPhotoDecision } from '../../../../apps/server/src/services/independentPhotoIdentity';
import { loadIndependentPhotoSources, photoIdentityDigest } from '../../../../apps/server/src/services/independentPhotoSources';

const folder = new URL('independent-photo-batch-02/', import.meta.url);
const apply = process.argv.includes('--apply');
assert.ok(process.argv.slice(2).every(arg => arg === '--apply'));
const pointer = JSON.parse(await readFile(new URL('cleaning-scope/current.json', import.meta.url), 'utf8'));
assert.ok(!pointer.policy.excludedCities.includes('济南'));
const [decision] = JSON.parse(await readFile(new URL('decisions.json', folder), 'utf8')) as IndependentPhotoDecision[];
assert.ok(decision); assert.equal(decision.city, '济南'); assert.equal(decision.images.length, 5);
if (apply) {
  const preview = JSON.parse(await readFile(new URL('preview.json', folder), 'utf8'));
  assert.equal(preview.apply, false); assert.equal(preview.unchanged, true);
  assert.equal(preview.decisionHash, photoIdentityDigest(decision));
}
const testFile = (await readdir(folder)).filter(f => /^verify-\d+\.json$/.test(f)).sort().at(-1);
assert.ok(testFile);
const test = JSON.parse(await readFile(new URL(testFile, folder), 'utf8'));
assert.ok(test.idempotent && test.rollback && test.sourceUnchanged && test.approvedBindings === 4 && test.wrongPositiveWithdrawn === 1);
const output = await open(new URL(apply ? 'applied.json' : 'preview.json', folder), 'wx');
const client = new Client({ connectionString: parse(await readFile('apps/server/.env')).DATABASE_URL, connectionTimeoutMillis: 10000 });
const tables = ['canonical_places', 'research_evidence', 'place_relation', 'data_import', 'place_identity_imports', 'place_relation_snapshots', 'trips'];
const digest = async () => {
  const result: Record<string, { count: number; digest: string }> = {};
  for (const table of tables) result[table] = (await client.query(`SELECT count(*)::int count,md5(COALESCE(string_agg(h,'' ORDER BY h),'')) digest
    FROM (SELECT md5(to_jsonb(t)::text) h FROM "${table}" t) x`)).rows[0];
  return result;
};
try {
  await client.connect(); await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout='8s'"); await client.query("SET LOCAL statement_timeout='45s'");
  for (const table of tables) await client.query(`LOCK TABLE "${table}" IN SHARE MODE`);
  const before = await digest();
  assert.equal(before.trips?.count, 201); assert.equal(before.trips.digest, 'e01d67cbf42a62fc595f4ef052f99e75');
  assert.equal((await client.query('SELECT count(*)::int count FROM independent_photo_changes WHERE change_key=$1', [decision.key])).rows[0].count, 0, '批次已应用，禁止重放');
  const beforeAssignments = (await client.query('SELECT * FROM independent_photo_assignments ORDER BY city,image_key')).rows;
  const inputs = await loadIndependentPhotoSources('济南'); const sourceDigest = photoIdentityDigest(inputs);
  assert.equal(inputs.sources.length, 123); assert.deepEqual(inputs.warnings, []);
  const bad = decision.images.find(i => i.entityId === null)!;
  const badSource = inputs.sources.find(s => s.imageKey === bad.imageKey)!;
  // 不允许撤销当前错误正例时影响另一个正确目录中的同资产图片。
  assert.ok(inputs.sources.filter(s => s.assetKey === badSource.assetKey).every(s => s.catalogName === '洪家楼天主教堂'));
  const state = await applyIndependentPhotoDecision(client as unknown as PoolClient, decision, loadIndependentPhotoSources);
  const assignments = await loadIndependentPhotoAssignments(client, '济南');
  const current = assignments.filter(a => a.change_key === decision.key);
  assert.equal(current.length, 5); assert.equal(current.filter(a => a.entity_id).length, 4);
  const afterAssignments = (await client.query('SELECT * FROM independent_photo_assignments ORDER BY city,image_key')).rows;
  assert.deepEqual(afterAssignments.filter(a => a.change_key !== decision.key), beforeAssignments);
  const after = await digest(); assert.deepEqual(after, before);
  assert.equal(photoIdentityDigest(await loadIndependentPhotoSources('济南')), sourceDigest);
  const report = { apply, at: new Date().toISOString(), key: decision.key, decisionHash: photoIdentityDigest(decision), sourceDigest,
    before, after, unchanged: true, previousGlobalAssignments: beforeAssignments.length, globalAssignmentsAfter: afterAssignments.length,
    reviewedImages: 22, boundImages: 4, withdrawnWrongPositive: 1, existingRejectionsUnchanged: 17, changes: [state], failures: [] };
  await client.query(apply ? 'COMMIT' : 'ROLLBACK');
  await output.writeFile(JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ apply, boundImages: 4, withdrawnWrongPositive: 1, unchanged: true, trips: after.trips,
    file: `independent-photo-batch-02/${apply ? 'applied' : 'preview'}.json` }));
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  await output.writeFile(JSON.stringify({ ok: false, apply, error: error instanceof Error ? error.message : '图片治理失败' }) + '\n');
  throw error;
} finally { await client.end(); await output.close(); }
