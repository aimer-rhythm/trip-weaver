import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isDeepStrictEqual } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pool } from '../../../../apps/server/src/db/client';
import { loadPlaceRelations } from '../../../../apps/server/src/generation/scheduling/placeRelations';
import { loadPlaceIdentityIndex } from '../../../../apps/server/src/services/placeIdentityService';
import { captureIdentityImport, rollbackIdentityImport } from '../../../../apps/server/src/services/placeIdentityAudit';
import type { ImportPlace } from '../../../../apps/server/src/services/placeImportIdentity';
import type { BoundRelation } from '../../../../apps/server/src/services/placeRelationIdentity';
import { loadCityPlaceFacts } from '../../../../apps/server/src/generation/scheduling/placeFacts';
import { assertOldMediaPreserved } from './all-cities/sync-contract.mjs';

after(() => pool.end());

test('真实城市知识冻结经过正式双导入、ID关系消费和逆序审计预演', async () => {
  assert.match(process.env.DATABASE_URL ?? '', /127\.0\.0\.1:18798\/place_identity_test_\d+$/);
  const folder = new URL(process.env.RELATION_CITY_FIXTURE ?? './relation-sync/run-01/', import.meta.url);
  const state = JSON.parse(await readFile(new URL('state.json', folder), 'utf8'));
  assert.equal(state.phase, 'frozen', '只能预演当前冻结文件，禁止使用已被后续修复取代的批次');
  const city: string = state.city;
  const strictMedia = process.env.RELATION_CITY_PRESERVE_MEDIA === '1';
  const mediaFacts = async () => new Map([...(await loadCityPlaceFacts(city))]
    .filter(([name,f]) => name === f.name && (f.coverImage || f.imageGallery?.length || f.amapPhoto))
    .map(([name,f]) => [name, {coverImage:f.coverImage,imageGallery:f.imageGallery,amapPhoto:f.amapPhoto}]));
  const read = async (file: string, expected: string) => {
    const bytes = await readFile(new URL(file, folder));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected);
    return JSON.parse(bytes.toString('utf8'));
  };
  const library = await read('library-before.json', state.libraryHash);
  assert.equal(library.readOnly, true); assert.equal(library.city, city);
  const places: { places: ImportPlace[]; relationIdentity?: unknown } = await read(`xhs-places-${city}.json`, state.placesHash);
  const graph: { relations: BoundRelation[] } = await read(`xhs-place-relations-${city}.json`, state.relationsHash);
  const names = ['canonical_places', 'research_evidence', 'place_relation', 'data_import', 'independent_photo_assignments', 'place_relation_snapshots'];
  for (const table of names) {
    await pool.query(`INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(NULL::${table},$1::jsonb)`, [JSON.stringify(library.tables[table])]);
  }
  const client = await pool.connect();
  const execute = (kind: string) => promisify(execFile)(process.execPath, ['--import', 'tsx',
    fileURLToPath(new URL(`../../../../apps/server/scripts/seed-xhs-${kind}.ts`, import.meta.url)),
    fileURLToPath(new URL(`xhs-${kind === 'places' ? 'places' : 'place-relations'}-${city}.json`, folder))],
  { env: process.env, windowsHide: true, timeout: 60000 });
  try {
    const before = await captureIdentityImport(client, city);
    const beforeMediaFacts = strictMedia ? await mediaFacts() : null;
    const beforeFacts = await loadCityPlaceFacts(city);
    const beforeRelations = await loadPlaceRelations(city);
    const sameSource = isDeepStrictEqual(library.tables.place_relation_snapshots[0]?.manifest, places.relationIdentity);
    await execute('places');
    if (sameSource) assert.deepEqual(await loadPlaceRelations(city), beforeRelations, '相同来源版本的元数据刷新保持既有关系');
    else assert.equal((await loadPlaceRelations(city)).size, 0, '来源版本变化到匹配关系导入之间不能沿旧图消费');
    await execute('relations');
    const usableIds = new Set(places.places.filter(p => p.verified !== false && !p.payload?.identityWithdrawal).map(p => p.id));
    const expected = graph.relations.filter(r => r.strength === 'direct' && usableIds.has(r.fromEntityId) && usableIds.has(r.toEntityId));
    const relations = await loadPlaceRelations(city);
    assert.equal([...relations.values()].reduce((n, values) => n + values.length, 0), expected.length * 2);
    for (const edge of expected) {
      assert.ok(relations.get(`id:${edge.fromEntityId}`)?.includes(`id:${edge.toEntityId}`));
      assert.ok(relations.get(`id:${edge.toEntityId}`)?.includes(`id:${edge.fromEntityId}`));
    }
    const index = await loadPlaceIdentityIndex(city);
    for (const p of places.places.filter(p => p.verified !== false)) {
      const resolution = index.resolve(city, p.name, p.id);
      assert.equal(resolution.status, 'resolved', p.name);
      if (resolution.status === 'resolved') assert.equal(resolution.canonicalPlaceId, p.id);
    }
    const afterState = await captureIdentityImport(client, city);
    const afterById = new Map(afterState.places.map(p => [p.id, p]));
    const beforeById = new Map(before.places.map(p => [p.id, p]));
    const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable)
      : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value)
        .filter(([key]) => key !== 'compiledAt').map(([key, item]) => [key, stable(item)])) : value;
    let preservedOperations = 0;
    const afterFacts = await loadCityPlaceFacts(city);
    for (const place of places.places) if (place.payload?.operationalIdentity) {
      const stored = afterById.get(place.id)?.payload as Record<string, unknown>;
      const original = beforeById.get(place.id)?.payload as Record<string, unknown>;
      assert.ok(original, '旧运营资料保全不能新增原主体');
      assert.deepEqual(stored.operationalIdentity, place.payload.operationalIdentity, `运营保全声明实际落库：${place.id}`);
      assert.equal(afterFacts.get(place.name)?.openTime, beforeFacts.get(place.name)?.openTime,
        `旧营业资料实际facts消费保持：${place.id}`);
      for (const key of ['price', 'openHours', 'reservation', 'reservationNote', 'reservationEvidence', 'reservationConflict']) {
        assert.ok(isDeepStrictEqual(stored[key], place.payload[key]), `运营字段与导出一致：${place.id}/${key}`);
        assert.ok(isDeepStrictEqual(stable(stored[key]), stable(original[key])), `旧运营字段保全：${place.id}/${key}`);
      }
      preservedOperations++;
    }
    let governedScores = 0;
    for (const place of places.places) if (place.payload?.recommendationIdentity) {
      const stored = afterById.get(place.id)?.payload as Record<string, unknown>;
      for (const key of ['recommendationIdentity', 'recommendScore', 'mentionCount'])
        assert.deepEqual(stored[key], place.payload[key], `推荐分实际落库：${place.name}/${key}`);
      governedScores++;
    }
    for (const beforePlace of before.places) {
      const afterPlace = afterById.get(beforePlace.id)!;
      assert.ok(afterPlace, `旧行不得删除：${beforePlace.id}`);
      const oldPayload = (beforePlace.payload ?? {}) as Record<string, unknown>;
      const newPayload = (afterPlace.payload ?? {}) as Record<string, unknown>;
      if (strictMedia) {
        assertOldMediaPreserved(oldPayload,newPayload,beforePlace.id);
      } else if (!newPayload.canonicalRedirectTo && !newPayload.imageIdentity) {
        for (const key of ['coverImage', 'imageGallery', 'amapPhoto']) assert.deepEqual(newPayload[key], oldPayload[key]);
      }
    }
    if (beforeMediaFacts) {
      const afterMediaFacts = await mediaFacts();
      for (const [name,media] of beforeMediaFacts)
        assert.ok(isDeepStrictEqual(afterMediaFacts.get(name),media), `旧媒体实际facts消费变化：${name}`);
    }
    await execute('places'); await execute('relations');
    const repeated = await captureIdentityImport(client, city);
    assert.deepEqual(repeated.places, afterState.places, '重复导入不能恢复旧分数或改变地点内容');
    assert.deepEqual(await loadPlaceRelations(city), relations);
    const audits = (await client.query('SELECT id FROM place_identity_imports WHERE city=$1 ORDER BY created_at DESC', [city])).rows;
    assert.equal(audits.length, 4);
    await client.query('BEGIN');
    for (const audit of audits) await rollbackIdentityImport(client, audit.id, true);
    assert.deepEqual(await captureIdentityImport(client, city), before);
    await client.query('COMMIT');
    const result = { city, preview: true, sourceRevision: state.sourceRevision,
      sourceHash: state.sourceHash, placesHash: state.placesHash, relationsHash: state.relationsHash, libraryHash: state.libraryHash,
      places: places.places.length, strongExported: graph.relations.filter(r => r.strength === 'direct').length,
      strongUsable: expected.length, libraryBefore: before.places.length, libraryAfter: afterState.places.length,
      oldRowsPreserved: true, photosPreserved: strictMedia ? true : null,
      mediaPreservationPolicy: strictMedia ? 'all_existing_fields_and_facts' : 'uncontrolled_rows_only',
      photoConsumptionPreserved: strictMedia ? true : null,
      reverseRollback: true, repeatedImport: true, sameSource, governedScores, preservedOperations, failures: [] };
    await writeFile(new URL(`preview-${Date.now()}.json`, folder), JSON.stringify(result, null, 2), { flag: 'wx' });
    console.log(JSON.stringify(result));
  } finally { await client.query('ROLLBACK'); client.release(); }
});
