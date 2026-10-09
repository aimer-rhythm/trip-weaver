import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { placeEmbeddingText } from '../../../../apps/server/src/lib/placeEmbeddingText';
import { createPlaceIdentityIndex } from '../../../../apps/server/src/lib/placeIdentity';
import { placeCategory, type PlaceRow } from '../../../../apps/server/src/generation/retrievalRanking';
import { createPlaceRetriever } from '../../../../apps/server/src/generation/placeRetrieval';
import { visitWeight } from '../../../../apps/server/src/generation/scheduling/visitWeight';

// 必须在导入会自动迁移的db/client之前确认隔离库。
assert.match(process.env.DATABASE_URL ?? '', /127\.0\.0\.1:18798\/place_identity_test_\d+$/);
const { pool } = await import('../../../../apps/server/src/db/client');
const { loadCityPlaceFacts } = await import('../../../../apps/server/src/generation/scheduling/placeFacts');
after(() => pool.end());

test('第41批真实城市导入后平台按摄影点消费，餐饮筛选排除且茶馆裸名不能绑定旧ID', async () => {
  const folder = new URL('all-cities/batch-41/sync-01/', import.meta.url);
  const read = async (name: string) => JSON.parse(await readFile(new URL(name, folder), 'utf8'));
  const sync = (await read('sync-state.json')).cities['济南'];
  assert.ok(sync.importedAt && sync.relationsImportedAt);
  const state = await read('preview-济南/state.json');
  const libraryBytes = await readFile(new URL('preview-济南/library-before.json', folder));
  assert.equal(createHash('sha256').update(libraryBytes).digest('hex'), state.libraryHash);
  const library = JSON.parse(libraryBytes.toString('utf8'));
  const bytes = await readFile(new URL('xhs-places-济南.json', folder));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), sync.exportHash);
  const exported = JSON.parse(bytes.toString('utf8'));
  const eid = '2c8372d3a47dbcb68abd998af495436d', oldName = '尚泉尚水茶馆', name = '尚泉尚水茶馆前平台', city = '济南';
  for (const table of ['canonical_places', 'research_evidence', 'place_relation', 'data_import', 'independent_photo_assignments', 'place_relation_snapshots']) {
    await pool.query(`INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(NULL::${table},$1::jsonb)`, [JSON.stringify(library.tables[table])]);
  }
  const retrieve = createPlaceRetriever({query: (sql, values) => pool.query(sql, values), embed: async () => null});
  const beforeFacts = (await loadCityPlaceFacts(city)).get(oldName); assert.ok(beforeFacts);
  assert.equal(beforeFacts.placeType, 'cafe'); assert.equal(beforeFacts.category, '美食');
  assert.equal((await retrieve([oldName], {city, category:'food', vector:'off'}))[0]?.canonicalPlaceId, eid);
  const beforeRow = library.tables.canonical_places.find((p: PlaceRow) => p.id === eid); assert.ok(beforeRow);
  for (const kind of ['places', 'relations']) {
    await promisify(execFile)(process.execPath, ['--import', 'tsx',
      fileURLToPath(new URL(`../../../../apps/server/scripts/seed-xhs-${kind}.ts`, import.meta.url)),
      fileURLToPath(new URL(`xhs-${kind === 'places' ? 'places' : 'place-relations'}-济南.json`, folder))],
    {env:process.env, windowsHide:true, timeout:60000});
  }
  const rows = (await pool.query<PlaceRow>('SELECT id,city,name,category,lat,lng,verified,source,payload FROM canonical_places WHERE city=$1', [city])).rows;
  const p = rows.find(p => p.id === eid); assert.ok(p);
  const expected = exported.places.find((p: PlaceRow) => p.id === eid); assert.ok(expected);
  assert.equal(p.name, name); assert.equal(p.category, '自然'); assert.equal(p.payload?.xhsPlaceType, 'photo_spot');
  assert.equal(p.lat, null); assert.equal(p.lng, null);
  assert.deepEqual(p.payload?.identity, {...expected.payload.identity, nameKeys:[name]});
  for (const key of ['mentionSources', 'themes', 'content', 'topReasons', 'imageIdentity']) assert.deepEqual(p.payload?.[key], expected.payload[key]);
  assert.notEqual(placeEmbeddingText(p), placeEmbeddingText(beforeRow));
  const index = createPlaceIdentityIndex(rows.filter(p => p.verified || p.payload?.identityWithdrawal));
  for (const id of [undefined, eid]) {
    const good = index.resolve(city, name, id); assert.equal(good.status, 'resolved');
    if (good.status === 'resolved') assert.equal(good.canonicalPlaceId, eid);
    const bad = index.resolve(city, oldName, id);
    assert.ok(bad.status !== 'resolved' || bad.canonicalPlaceId !== eid);
  }
  const facts = await loadCityPlaceFacts(city), fact = facts.get(name); assert.ok(fact);
  assert.equal(facts.get(oldName), undefined); assert.equal(fact.canonicalPlaceId, eid);
  assert.equal(fact.placeType, 'photo_spot'); assert.equal(fact.category, '自然');
  assert.equal(fact.lat, undefined); assert.equal(fact.lng, undefined);
  assert.equal(visitWeight(fact), 1); assert.equal(placeCategory(p.category), 'attraction');
  assert.equal((await retrieve([name], {city, category:'attraction', vector:'off'}))[0]?.canonicalPlaceId, eid);
  for (const term of [oldName, name]) assert.ok(!(await retrieve([term], {city, category:'food', vector:'off', limit:48})).some(p => p.canonicalPlaceId === eid));
  const evidence = (await pool.query('SELECT content FROM research_evidence WHERE place_id=$1', [eid])).rows;
  assert.ok(evidence.some(e => e.content.includes('前面平台可拍摄湖面与楼阁全景')));
  const report = {batch:41, isolated:true, synthetic:false, fullCityPlaces:exported.places.length, oldFoodHitConfirmed:true,
    afterFoodExcluded:true, actualPlaceFactsType:fact.placeType, visitWeight:visitWeight(fact), poiCategory:placeCategory(p.category),
    exactNameSql:true, bareCafeNameCannotBind:true, stableIdPreserved:true, validDescriptionPreserved:true,
    coordinatesRemainNull:true, automaticGeoSchedulingCovered:false, imageComparison:'deferred_by_user', failures:[]};
  await writeFile(new URL(`platform-consumption-${Date.now()}.json`, folder), JSON.stringify(report,null,2)+'\n', {flag:'wx'});
  console.log(JSON.stringify(report));
});
