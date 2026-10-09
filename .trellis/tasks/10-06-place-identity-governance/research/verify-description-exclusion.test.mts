import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pool } from '../../../../apps/server/src/db/client';
import { placeEmbeddingText } from '../../../../apps/server/src/lib/placeEmbeddingText';
import { createPlaceRetriever } from '../../../../apps/server/src/generation/placeRetrieval';
import { loadCityPlaceFacts } from '../../../../apps/server/src/generation/scheduling/placeFacts';
import { captureIdentityImport, rollbackIdentityImport } from '../../../../apps/server/src/services/placeIdentityAudit';

after(() => pool.end());
test('描述排除经过真实双导入清旧证据与缓存，保留独立事实、名称向量文本及可逆导入', async () => {
  assert.match(process.env.DATABASE_URL ?? '', /127\.0\.0\.1:18798\/place_identity_test_\d+$/);
  assert.ok(process.env.DESCRIPTION_FLOW_FIXTURE, '须显式提供本次上游导出夹具');
  const folder = new URL(process.env.DESCRIPTION_FLOW_FIXTURE, import.meta.url);
  const read = async (name: string) => JSON.parse(await readFile(new URL(name, folder), 'utf8'));
  const report = await read('report.json'); assert.deepEqual(report.failures, []);
  const before = await read(report.before), afterExport = await read(report.after), city: string = report.city;
  const execute = (label: string, kind: 'places' | 'relations') => promisify(execFile)(process.execPath, ['--import', 'tsx',
    fileURLToPath(new URL(`../../../../apps/server/scripts/seed-xhs-${kind}.ts`, import.meta.url)),
    fileURLToPath(new URL(`xhs-${kind === 'places' ? 'places' : 'place-relations'}-${label}.json`, folder))],
    { env: process.env, windowsHide: true, timeout: 30_000 });
  const db = await pool.connect();
  try {
    const old = before.places.find((p: {name: string}) => p.name === '甲古城'); assert.ok(old);
    await db.query(`INSERT INTO canonical_places(id,city,name,category,source,verified,payload,created_at)
      VALUES($1,$2,$3,$4,'goldset',true,$5,now())`, [old.id, city, old.name, old.category,
      {content: {intro: '整座城市泉水泡茶的旧金集介绍'}, topReasons: ['旧金集错误理由'], originalSeed: true}]);
    const baseline = await captureIdentityImport(db, city);
    await execute('before', 'places'); await execute('before', 'relations');
    assert.ok((await db.query('SELECT content FROM research_evidence WHERE city=$1', [city])).rows.some(r => /整座城市|乙动物园/.test(r.content)));
    await execute('after', 'places'); await execute('after', 'relations');
    const facts = await loadCityPlaceFacts(city);
    const retrieve = createPlaceRetriever({query: (sql, values) => db.query(sql, values), embed: async () => null});
    const probes = [];
    for (const p of afterExport.places) {
      const row = (await db.query('SELECT id,city,name,category,source,verified,payload FROM canonical_places WHERE id=$1', [p.id])).rows[0];
      assert.equal(row.verified, true); assert.equal(row.payload.identityWithdrawal, undefined);
      assert.equal(row.payload.mentionCount, 1); assert.equal(row.payload.mentionSources.length, 1);
      for (const k of ['content', 'topReasons', 'mentionSources', 'typicalVisitMinutes']) assert.deepEqual(row.payload[k], p.payload[k]);
      assert.equal(row.payload.content.intro, '');
      assert.doesNotMatch(JSON.stringify(row.payload), /整座城市|乙动物园/);
      if (p.id === old.id) { assert.equal(row.source, 'goldset'); assert.equal(row.payload.originalSeed, true); }
      const text = placeEmbeddingText(row); assert.ok(text.includes(p.name)); assert.doesNotMatch(text, /整座城市|乙动物园/);
      const hits = await retrieve([p.name], {city, vector: 'off', limit: 8}); assert.equal(hits[0]?.canonicalPlaceId, p.id);
      assert.equal(facts.get(p.name)?.canonicalPlaceId, p.id);
      assert.equal(facts.get(p.name)?.visitMinutes, p.name === '乙野生动物园' ? 75 : undefined);
      probes.push({name: p.name, id: p.id, embeddingText: text, mentionCount: row.payload.mentionCount});
    }
    const evidence = (await db.query('SELECT content FROM research_evidence WHERE city=$1', [city])).rows;
    assert.equal(evidence.length, 1); assert.equal(evidence[0].content, '丙古城砖墙保存完整');
    const snapshot = (await db.query('SELECT manifest FROM place_relation_snapshots WHERE city=$1', [city])).rows[0].manifest;
    assert.equal(snapshot.sourceState.mentions.length, 3);
    assert.ok(snapshot.sourceState.mentions.every((m: {status: string}) => m.status === 'resolved'));
    const stable = await captureIdentityImport(db, city);
    await execute('after', 'places'); await execute('after', 'relations');
    const business = (s: Awaited<ReturnType<typeof captureIdentityImport>>) => ({...s,
      evidence: s.evidence.map(({fetched_at: _time, ...r}) => r),
      imports: s.imports.map(({imported_at: _time, ...r}) => r),
      relationImports: s.relationImports?.map(({imported_at: _time, ...r}) => r)});
    assert.deepEqual(business(await captureIdentityImport(db, city)), business(stable));
    await assert.rejects(execute('before', 'places'), /版本回退|旧|快照/);
    const audits = (await db.query('SELECT id FROM place_identity_imports WHERE city=$1 ORDER BY created_at DESC,id DESC', [city])).rows;
    await db.query('BEGIN');
    for (const a of audits) await rollbackIdentityImport(db, a.id, true);
    assert.deepEqual(await captureIdentityImport(db, city), baseline); await db.query('COMMIT');
    await writeFile(new URL(`downstream-verification-${Date.now()}.json`, folder), JSON.stringify({city, probes,
      evidenceRemoved: true, goldenSetDescriptionCleared: true, independentDurationPreserved: true,
      idempotent: true, reverseRollback: true, failures: []}, null, 2), {flag:'wx'});
  } finally { await db.query('ROLLBACK'); db.release(); }
});
