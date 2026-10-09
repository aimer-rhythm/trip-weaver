import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pool } from '../../../../apps/server/src/db/client';
import { createPlaceRetriever } from '../../../../apps/server/src/generation/placeRetrieval';
import { loadCityPlaceFacts } from '../../../../apps/server/src/generation/scheduling/placeFacts';
import { visitWeight } from '../../../../apps/server/src/generation/scheduling/visitWeight';
import { loadPlaceIdentityIndex } from '../../../../apps/server/src/services/placeIdentityService';
import { captureIdentityImport, rollbackIdentityImport } from '../../../../apps/server/src/services/placeIdentityAudit';
import { validateRelationManifest, validateBoundRelations } from '../../../../apps/server/src/services/placeRelationIdentity';
after(() => pool.end());

test('真实导入清除普通及金集旧时长，保留独立地点/描述/有效时长，幂等与倒序回滚', async () => {
  assert.match(process.env.DATABASE_URL ?? '', /127\.0\.0\.1:18798\/place_identity_test_\d+$/);
  const folder = new URL(process.env.FACT_FLOW_FIXTURE ?? './fact-exclusion-preview-1791403284802/', import.meta.url);
  const report = JSON.parse(await readFile(new URL('report.json', folder), 'utf8'));
  const before = JSON.parse(await readFile(new URL(report.before, folder), 'utf8'));
  const afterExport = JSON.parse(await readFile(new URL(report.after, folder), 'utf8'));
  const city: string = report.city;
  const execute = (label: string, kind: 'places' | 'relations') => promisify(execFile)(process.execPath, ['--import', 'tsx',
    fileURLToPath(new URL(`../../../../apps/server/scripts/seed-xhs-${kind}.ts`, import.meta.url)),
    fileURLToPath(new URL(`xhs-${kind === 'places' ? 'places' : 'place-relations'}-${label}.json`, folder))],
    { env: process.env, windowsHide: true, timeout: 30_000 });
  assert.deepEqual(report.failures, []); assert.equal(before.places.length, 5); assert.equal(afterExport.places.length, 5);
  const client = await pool.connect();
  try {
    // 既有金集也必须清旧字段，不能取max恢复30；该记录属于专用临时数据库。
    const old = before.places.find((p: { name: string }) => p.name === '乙泉'); assert.ok(old);
    await client.query(`INSERT INTO canonical_places(id,city,name,category,lat,lng,source,verified,payload,created_at)
      VALUES($1,$2,$3,$4,$5,$6,'goldset',true,$7,now())`, [old.id, city, old.name, old.category, old.lat, old.lng,
      { typicalVisitMinutes: 30, originalSeed: 'field-exclusion-test' }]);
    const baseline = await captureIdentityImport(client, city);
    await execute('before', 'places'); await execute('before', 'relations');
    const initialFacts = await loadCityPlaceFacts(city);
    assert.equal(initialFacts.get('乙泉')?.visitMinutes, 30);
    await execute('after', 'places'); await execute('after', 'relations');
    const facts = await loadCityPlaceFacts(city);
    assert.equal(facts.size, 5);
    const expectedMinutes: Record<string, number | undefined> = { 甲泉: 45, 乙泉: undefined, 丙泉: undefined, 丁泉: undefined, 戊泉: 75 };
    const index = await loadPlaceIdentityIndex(city);
    const retrieve = createPlaceRetriever({ query: (sql, values) => client.query(sql, values), embed: async () => null });
    const probes = [];
    for (const place of afterExport.places) {
      const fact = facts.get(place.name); assert.ok(fact);
      assert.equal(fact.canonicalPlaceId, place.id); assert.equal(fact.visitMinutes, expectedMinutes[place.name]);
      assert.equal(visitWeight(fact), visitWeight(initialFacts.get(place.name)));
      const resolved = index.resolve(city, place.name, place.id);
      assert.equal(resolved.status, 'resolved');
      if (resolved.status === 'resolved') assert.equal(resolved.canonicalPlaceId, place.id);
      const hits = await retrieve([place.name], { city, vector: 'off', limit: 8 });
      assert.equal(hits[0]?.canonicalPlaceId, place.id);
      const row = (await client.query('SELECT source,verified,payload FROM canonical_places WHERE id=$1', [place.id])).rows[0];
      assert.equal(row.verified, true); assert.equal(row.payload.identityWithdrawal, undefined);
      assert.equal(row.payload.typicalVisitMinutes, expectedMinutes[place.name]);
      assert.deepEqual(row.payload.content, place.payload.content);
      if (place.id === old.id) assert.equal(row.source, 'goldset');
      if (report.governedIds.includes(place.id)) {
        assert.equal(row.payload.mentionSources.length, place.name === '甲泉' ? 2 : 1);
        assert.equal(row.payload.mentionCount, place.name === '甲泉' ? 2 : 1);
      }
      probes.push({ name: place.name, entityId: place.id, visitMinutes: fact.visitMinutes ?? null, weight: visitWeight(fact), source: row.source });
    }
    const snapshot = (await client.query('SELECT manifest,relations FROM place_relation_snapshots WHERE city=$1', [city])).rows[0];
    const manifest = validateRelationManifest(snapshot.manifest, city); validateBoundRelations(snapshot.relations, manifest);
    assert.equal(manifest.sourceState.mentions.length, 6);
    assert.ok(manifest.sourceState.mentions.every(m => m.status === 'resolved'));
    const stable = await captureIdentityImport(client, city);
    await execute('after', 'places'); await execute('after', 'relations');
    // 实际导入会更新抓取/导入时间；幂等比较保留全部业务字段，仅忽略这三个既有时间戳。
    const businessState = (state: Awaited<ReturnType<typeof captureIdentityImport>>) => ({ ...state,
      evidence: state.evidence.map(({ fetched_at: _time, ...row }) => row),
      imports: state.imports.map(({ imported_at: _time, ...row }) => row),
      relationImports: state.relationImports?.map(({ imported_at: _time, ...row }) => row),
    });
    assert.deepEqual(businessState(await captureIdentityImport(client, city)), businessState(stable));
    await assert.rejects(execute('before', 'places'), /版本回退|旧|快照/);
    const audits = (await client.query('SELECT id FROM place_identity_imports WHERE city=$1 ORDER BY created_at DESC,id DESC', [city])).rows;
    await client.query('BEGIN');
    for (const a of audits) await rollbackIdentityImport(client, a.id, true);
    assert.deepEqual(await captureIdentityImport(client, city), baseline);
    await client.query('COMMIT');
    await writeFile(new URL(`downstream-verification-${Date.now()}.json`, folder), JSON.stringify({ city, probes,
      independentEntities: 5, mentionsPreserved: 6, rawFactHashPreserved: true, goldenSetOldDurationCleared: true,
      defaultWeightUnchanged: true, idempotent: true, reverseRollback: true, failures: [] }, null, 2), { flag: 'wx' });
  } finally { await client.query('ROLLBACK'); client.release(); }
});
