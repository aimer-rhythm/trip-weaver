// 第39批实际消费字段、身份边界及旧scope只读复核，不输出带签名原链接。
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Client } from 'pg';
import { parse } from 'dotenv';
import { createPlaceIdentityIndex } from '../../../../apps/server/src/lib/placeIdentity';
import type { PlaceRow } from '../../../../apps/server/src/generation/retrievalRanking';
const read = async (f: string) => JSON.parse(await readFile(new URL(f, import.meta.url), 'utf8'));
const folder = 'all-cities/batch-39/sync-01/';
const eid = '29f4a4b260878eb8d9143b15b8fca54f';
const output = new URL('priority-cities/济南/lingyan-downstream-check-01.json', import.meta.url);
await readFile(output).then(() => { throw new Error('证据不能覆盖'); }, (e: NodeJS.ErrnoException) => { if (e.code !== 'ENOENT') throw e; });
const sync = (await read(folder + 'sync-state.json')).cities['济南'];
assert.ok(sync.importedAt && sync.relationsImportedAt && sync.embeddingRunAt);
const bytes = await readFile(new URL(folder + 'xhs-places-济南.json', import.meta.url));
assert.equal(createHash('sha256').update(bytes).digest('hex'), sync.exportHash);
const exported = JSON.parse(bytes.toString('utf8')).places as PlaceRow[];
const before = await read(folder + 'preview-济南/library-before.json');
const source = await read('all-cities/batch-39-source.json');
const photos = await read('priority-cities/济南/lingyan-photo-sources-01.json');
assert.deepEqual(photos.warnings, []); assert.equal(photos.entities.length, 1);
assert.equal(photos.entities[0].independentSources.length, 0); assert.equal(photos.entities[0].assignments.length, 0);
const vectors = await read(folder + 'verification-vectors.json'); assert.deepEqual(vectors.failures, []);
assert.equal(vectors.cities[0].vectorProbes[0].id, eid);
assert.equal(vectors.cities[0].vectorProbes[0].diagnostics.vector, 'used');
const config = parse(await readFile('apps/server/.env'));
const upConfig = parse(await readFile('D:/Project/xhs-travel-pipeline/.env'));
assert.ok(upConfig.DATABASE_URL);
const db = new Client({ connectionString: config.DATABASE_URL, connectionTimeoutMillis: 10000 });
const up = new Client({ connectionString: upConfig.DATABASE_URL.replace('postgresql+asyncpg:', 'postgresql:'), connectionTimeoutMillis: 10000 });
try {
  await db.connect(); await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await up.connect(); await up.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const rows = (await db.query<PlaceRow>('SELECT id,city,name,category,lat,lng,verified,source,payload FROM canonical_places WHERE city=$1', ['济南'])).rows;
  const byId = new Map(rows.map(r => [r.id, r]));
  const fields = ['content', 'topReasons', 'openHours', 'reservation', 'reservationNote', 'reservationEvidence', 'typicalVisitMinutes', 'mentionSources', 'themes'];
  for (const expected of exported) {
    const actual = byId.get(expected.id); assert.ok(actual);
    for (const field of fields) assert.deepEqual(actual.payload?.[field] ?? null, expected.payload?.[field] ?? null, `${actual.name}/${field}`);
  }
  const row = byId.get(eid); assert.ok(row);
  assert.equal(row.category, '文化'); assert.equal(row.verified, true);
  assert.equal(row.payload?.typicalVisitMinutes ?? null, null);
  assert.ok(JSON.stringify(row.payload?.content).includes('宋代彩塑'));
  assert.deepEqual(row.payload?.mentionSources, [{ mentionId: 11686, noteId: 2609, inputHash: source.groups[0].mentions[0].inputHash }]);
  const origin = source.groups[0].source;
  const geo = (await read('priority-cities/济南/geo-13.json')).find((g: any) => g.query === '灵岩寺' && g.name === '灵岩寺');
  assert.equal(origin.latitude, geo.gcj02.latitude); assert.equal(origin.longitude, geo.gcj02.longitude);
  assert.equal(row.lat, Number(origin.latitude.toFixed(6))); assert.equal(row.lng, Number(origin.longitude.toFixed(6)));
  assert.equal(row.payload?.address, '万德镇');
  const index = createPlaceIdentityIndex(rows.filter(r => r.verified || r.payload?.identityWithdrawal));
  const negativeNames = ['灵隐寺', '千佛山', '兴国禅寺', '灵岩寺旅游区-售票处', '灵岩寺停车场', '济南市公安局灵岩寺派出所'];
  for (const name of negativeNames) {
    const result = index.resolve('济南', name);
    assert.ok(result.status !== 'resolved' || result.canonicalPlaceId !== eid, name);
  }
  for (const [name, minutes] of [['西更道街', 60], ['起凤桥八号', 30]] as const) {
    const r = rows.find(r => r.name === name); assert.ok(r); assert.equal(r.payload?.typicalVisitMinutes, minutes);
  }
  const oldScopes = await read('all-cities/batch-36-scope-decisions.json');
  const assignments = (await up.query('SELECT mention_id,scope_place_id,entity_id,input_hash,revision,change_key,fact_exclusions FROM place_mention_assignment WHERE mention_id=ANY($1::int[])', [oldScopes.flatMap((s: any) => s.assignments.map((a: any) => a.mentionId))])).rows;
  assert.equal(assignments.length, 11);
  for (const s of oldScopes) for (const expected of s.assignments) {
    const a = assignments.find(a => Number(a.mention_id) === expected.mentionId); assert.ok(a);
    assert.equal(a.entity_id, expected.entityId); assert.equal(a.input_hash, expected.inputHash);
    assert.equal(a.change_key, s.key); assert.equal(a.revision, 1);
    assert.deepEqual(a.fact_exclusions, expected.factExclusions ?? null);
  }
  const graph = (await db.query('SELECT manifest,relations FROM place_relation_snapshots WHERE city=$1', ['济南'])).rows[0];
  assert.equal(graph.manifest.revision, 13); assert.equal(graph.relations.length, 20);
  const previousPending = before.tables.place_relation_snapshots[0].manifest.sourceState.mentions.filter((m: any) => m.status === 'review');
  assert.equal(previousPending.length, 60);
  for (const m of previousPending) assert.deepEqual(graph.manifest.sourceState.mentions.find((n: any) => n.mentionId === m.mentionId), m);
  const cache = (await up.query('SELECT typical_visit_minutes,typical_visit_source FROM canonical_place WHERE id=5475')).rows[0];
  assert.deepEqual(cache, { typical_visit_minutes: 180, typical_visit_source: 'xhs_median' });
  const trips = (await db.query("SELECT count(*)::int count,md5(COALESCE(string_agg(h,'' ORDER BY h),'')) digest FROM (SELECT md5(to_jsonb(t)::text) h FROM trips t) x")).rows[0];
  assert.deepEqual(trips, { count: 201, digest: 'e01d67cbf42a62fc595f4ef052f99e75' });
  const report = { readOnly: true, batch: 39, capturedAt: new Date().toISOString(), entityId: eid, revision: 3,
    consumedFieldsVerified: exported.length, fields, effectiveTypicalVisitMinutes: null, validDescriptionPreserved: true,
    originalDerivedCacheRetained: cache, originalCacheMeaning: '旧canonical保留供追溯，scope使其不再作为有效时长导出；没有宣称物理清空上游字段。',
    reviewedReferencePoint: geo.gcj02, negativeNames, preservedPositiveDurations: { 西更道街: 60, 起凤桥八号: 30 },
    priorAssignments: 11, factExclusions: 4, pendingMentions: 60, trips,
    photoReport: 'priority-cities/济南/lingyan-photo-sources-01.json', vectorReport: folder + 'verification-vectors.json', failures: [] };
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ batch: 39, consumedFieldsVerified: exported.length, effectiveTypicalVisitMinutes: null, boundaries: negativeNames.length, failures: [] }));
} finally {
  await db.query('ROLLBACK').catch(() => {}); await db.end();
  await up.query('ROLLBACK').catch(() => {}); await up.end();
}
