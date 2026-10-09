// 正式同步后的只读核验；只输出身份、计数和摘要，不输出图片或用户行程内容。
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';
import { parse } from 'dotenv';
import { createPlaceIdentityIndex, identityStrings, placeIdentity, placeNames, type IdentityPlace } from '../../../../apps/server/src/lib/placeIdentity';
import { placeEmbeddingText } from '../../../../apps/server/src/lib/placeEmbeddingText';
import { currentBoundRelations, validateBoundRelations, validateRelationManifest } from '../../../../apps/server/src/services/placeRelationIdentity';

type Place = IdentityPlace & { verified: boolean; category: string; embedding: string | null };
const folder = path.resolve(process.argv[2]!);
const state = JSON.parse(await readFile(path.join(folder, 'state.json'), 'utf8'));
assert.equal(state.phase, 'imported');
assert.equal(state.placesImported, true); assert.equal(state.relationsImported, true);
const city: string = state.city;
const read = async (name: string, hash: string) => {
  const bytes = await readFile(path.join(folder, name));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), hash);
  return JSON.parse(bytes.toString('utf8'));
};
const exported = await read(`xhs-places-${city}.json`, state.placesHash);
const graph = await read(`xhs-place-relations-${city}.json`, state.relationsHash);
const library = await read('library-before.json', state.libraryHash);
const config = parse(await readFile('apps/server/.env'));
const client = new Client({ connectionString: config.DATABASE_URL, connectionTimeoutMillis: 10000 });
try {
  await client.connect();
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await client.query("SET LOCAL statement_timeout='45s'");
  const rows = (await client.query<Place>('SELECT * FROM canonical_places WHERE city=$1', [city])).rows;
  const old: Place[] = library.tables.canonical_places;
  const oldById = new Map(old.map(p => [p.id, p]));
  const byId = new Map(rows.map(p => [p.id, p]));
  const visible = (p: Place) => p.verified || p.payload?.identityWithdrawal !== undefined;
  const beforeIndex = createPlaceIdentityIndex(old.filter(visible));
  const index = createPlaceIdentityIndex(rows.filter(visible));
  let photoFields = 0, names = 0, historicalIds = 0, withdrawals = 0;
  for (const p of old) {
    const current = byId.get(p.id);
    assert.ok(current, `旧行丢失：${p.id}`);
    if (!current.payload?.canonicalRedirectTo && !current.payload?.imageIdentity) {
      for (const key of ['coverImage', 'imageGallery', 'amapPhoto']) {
        assert.deepEqual(current.payload?.[key], p.payload?.[key], `图片字段变化：${p.id}/${key}`);
        if (p.payload?.[key] !== undefined) photoFields++;
      }
    }
    if (!visible(p)) continue;
    for (const name of placeNames(p)) {
      const a = beforeIndex.resolve(city, name), b = index.resolve(city, name);
      assert.equal(b.status, a.status, `名称解析状态变化：${name}`);
      if (a.status === 'resolved' && b.status === 'resolved') assert.equal(b.canonicalPlaceId, a.canonicalPlaceId, name);
      if (a.status === 'ambiguous' && b.status === 'ambiguous') assert.deepEqual(b.candidates.map(p => p.id).sort(), a.candidates.map(p => p.id).sort(), name);
      names++;
    }
  }
  for (const p of exported.places as Place[]) {
    const current = byId.get(p.id)!;
    assert.ok(current, `导出地点未导入：${p.id}`);
    // nameKeys 是正式导入器的查询派生字段，不属于上游身份声明。
    const { nameKeys: _derived, ...declaration } = placeIdentity(current);
    assert.deepEqual(declaration, p.payload?.identity);
    if (p.payload?.identityWithdrawal) {
      assert.equal(current.verified, false); assert.equal(current.embedding, null); withdrawals++;
      continue;
    }
    if (p.verified === false) continue;
    for (const id of [p.id, ...identityStrings(placeIdentity(p).memberIds)]) {
      const result = index.resolve(city, p.name, id);
      assert.equal(result.status, 'resolved', `${p.name}/${id}`);
      if (result.status === 'resolved') assert.equal(result.canonicalPlaceId, p.id);
      historicalIds++;
    }
  }
  const snapshot = (await client.query('SELECT manifest,relations,available_ids FROM place_relation_snapshots WHERE city=$1', [city])).rows[0];
  assert.deepEqual(snapshot.manifest, exported.relationIdentity);
  assert.deepEqual(snapshot.relations, graph.relations);
  const manifest = validateRelationManifest(snapshot.manifest, city);
  const available = new Set<string>(snapshot.available_ids);
  const bound = currentBoundRelations(manifest, validateBoundRelations(snapshot.relations, manifest), rows.filter(p => p.verified && available.has(p.id)));
  const expected = graph.relations.filter((r: { strength: string; fromEntityId: string; toEntityId: string }) => r.strength === 'direct' && available.has(r.fromEntityId) && available.has(r.toEntityId));
  assert.equal(bound.length, expected.length);
  const photos = (await client.query('SELECT to_jsonb(t) value FROM independent_photo_assignments t WHERE city=$1 ORDER BY to_jsonb(t)::text', [city])).rows.map(r => r.value);
  assert.deepEqual(photos, library.tables.independent_photo_assignments);
  const trips = (await client.query(`SELECT count(*)::int count, md5(COALESCE(string_agg(h,'' ORDER BY h),'')) digest
    FROM (SELECT md5(to_jsonb(t)::text) h FROM trips t) x`)).rows[0];
  assert.deepEqual(trips, state.afterTrips);
  const eligible = rows.filter(p => p.verified && !p.payload?.canonicalRedirectTo && !p.payload?.identityWithdrawal);
  const pending = eligible.filter(p => !p.embedding || p.payload?.embeddedText !== placeEmbeddingText(p));
  const result = { city, readOnly: true, sourceRevision: manifest.revision, sourceHash: manifest.sourceHash,
    placesHash: state.placesHash, relationsHash: state.relationsHash, rows: rows.length, exported: exported.places.length,
    strongExported: graph.relations.filter((r: { strength: string }) => r.strength === 'direct').length, strongUsable: bound.length,
    checkedNames: names, checkedHistoricalIds: historicalIds, preservedPhotoFields: photoFields,
    independentAssignments: photos.length, withdrawals, trips, eligibleEmbeddings: eligible.length,
    embeddingsCurrent: pending.length === 0,
    pendingEmbeddings: pending.map(p => {
      const before = oldById.get(p.id);
      return { id: p.id, name: p.name, missing: !p.embedding,
        pendingBefore: !!before && (!before.embedding || before.payload?.embeddedText !== placeEmbeddingText(before)),
        declaredText: p.payload?.embeddedText ?? null, expectedText: placeEmbeddingText(p) };
    }), failures: [] };
  await writeFile(path.join(folder, `live-check-${Date.now()}.json`), JSON.stringify(result, null, 2), { flag: 'wx' });
  console.log(JSON.stringify(result));
} finally { await client.query('ROLLBACK').catch(() => {}); await client.end(); }
