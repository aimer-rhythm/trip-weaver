// 实库只读；在专用PG保留既有分配，验证新增四图、别名消费和倒序回滚。
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { readFile, writeFile } from 'node:fs/promises';
import { Client } from 'pg';
import { parse } from 'dotenv';
import { pool } from '../../../../apps/server/src/db/client';
import type { PlaceRow } from '../../../../apps/server/src/generation/retrievalRanking';
import { createPlaceIdentityIndex, placeNames } from '../../../../apps/server/src/lib/placeIdentity';
import { loadIndependentPhotoSources, photoIdentityDigest } from '../../../../apps/server/src/services/independentPhotoSources';
import { applyIndependentPhotoDecision, rollbackIndependentPhotoDecision, loadIndependentPhotoAssignments,
  type IndependentPhotoDecision } from '../../../../apps/server/src/services/independentPhotoIdentity';
import { createGenerationPhotoLookup } from '../../../../apps/server/src/integrations/photoEnrichment';
import { createBoundPhotoLookup } from '../../../../apps/server/src/integrations/boundPhotoLookup';

after(() => pool.end());
test('超然楼实图：四绑定、两名称、三图展示、旧绑定保留、幂等和回滚', async () => {
  assert.match(process.env.DATABASE_URL ?? '', /place_identity_test_\d+/);
  const [decision] = JSON.parse(await readFile(new URL('independent-photo-batch-03/decisions.json', import.meta.url), 'utf8')) as IndependentPhotoDecision[];
  assert.ok(decision); assert.equal(decision.images.length, 4);
  const live = new Client({ connectionString: parse(await readFile('apps/server/.env')).DATABASE_URL, connectionTimeoutMillis: 10000 });
  const client = await pool.connect();
  try {
    await live.connect(); await live.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const rows = (await live.query<PlaceRow>('SELECT id,city,name,category,source,verified,payload,lat,lng FROM canonical_places WHERE city=$1', ['济南'])).rows;
    const liveAssignments = await loadIndependentPhotoAssignments(live, '济南');
    const liveBatch = liveAssignments.filter(a => a.change_key === decision.key);
    const previous = liveAssignments.filter(a => a.change_key !== decision.key);
    assert.equal(previous.length, 5);
    await live.query('ROLLBACK'); await client.query('BEGIN');
    for (const row of rows) await client.query(`INSERT INTO canonical_places(id,city,name,category,source,verified,payload,lat,lng,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now())`, [row.id,row.city,row.name,row.category,row.source,row.verified,row.payload,row.lat,row.lng]);
    await client.query('INSERT INTO independent_photo_assignments SELECT * FROM jsonb_populate_recordset(NULL::independent_photo_assignments,$1::jsonb)', [JSON.stringify(previous)]);
    const index = createPlaceIdentityIndex(rows.filter(r => r.verified || r.payload?.identityWithdrawal)
      .map(r => ({ ...r, aliases: placeNames(r), evidence: [] })));
    const load = () => loadIndependentPhotoSources('济南');
    const inputs = await load(); const beforeDigest = photoIdentityDigest(inputs);
    assert.deepEqual(inputs.warnings, []);
    const sources = inputs.sources.filter(s => decision.images.some(i => i.imageKey === s.imageKey && i.inputHash === s.inputHash));
    assert.equal(sources.length, 4); assert.ok(sources.every(s => s.eligible));
    const appliedState = await applyIndependentPhotoDecision(client, decision, load);
    assert.deepEqual(await applyIndependentPhotoDecision(client, decision, load), appliedState);
    const applied = await loadIndependentPhotoAssignments(client, '济南');
    const current = applied.filter(a => a.change_key === decision.key);
    assert.equal(current.length, 4); assert.ok(current.every(a => a.entity_id === 'd4a51a5df56f78c9de0713d86ea8c00c'));
    assert.deepEqual(applied.filter(a => a.change_key !== decision.key), previous);
    assert.equal((await client.query('SELECT count(*)::int count FROM independent_photo_changes WHERE change_key=$1', [decision.key])).rows[0].count, 1);
    if (liveBatch.length) assert.deepEqual(liveBatch, current);
    const enqueued: string[] = [], external: string[] = [];
    const lookup = createGenerationPhotoLookup('济南', async () => index, { loadSources: load,
      loadAssignments: () => loadIndependentPhotoAssignments(client, '济南'), enqueue: async (_city, name) => { enqueued.push(name); },
      adoption: { mediaBase: '/media', adoptUnsplash: async () => { external.push('unsplash'); return false; } } });
    const probes = [];
    for (const name of ['超然楼', '大明湖超然楼']) {
      const cover = await lookup(name); assert.equal(cover?.photos?.length, 3);
      assert.ok(cover!.photos!.every(p => sources.some(s => s.entry.photo.url === p.url)));
      probes.push({ name, photos: cover!.photos!.map(p => p.url) });
    }
    assert.deepEqual(probes[0]?.photos, probes[1]?.photos);
    const place = index.resolve('济南', '超然楼'); assert.ok(place.status === 'resolved');
    const individual = [];
    for (const source of sources) {
      const single = createBoundPhotoLookup('济南', { ...inputs, sources: [source] }, applied, index, { mediaBase: '/media' });
      const photo = await single.forPlace(place.place);
      assert.equal(photo?.photos?.[0]?.url, source.entry.photo.url);
      assert.deepEqual(photo?.photos?.[0]?.attribution, source.entry.photo.attribution);
      individual.push(source.imageKey);
    }
    const bound = createBoundPhotoLookup('济南', inputs, applied, index);
    for (const source of sources) {
      for (const same of inputs.sources.filter(s => s.assetKey === source.assetKey)) assert.equal(bound.allowUnbound(same.entry), false);
    }
    // 包含大明湖在内的其他主体不能借用超然楼图；原两馆/教堂绑定仍可正常消费。
    const others = index.groups.flat().filter(p => p.id !== place.canonicalPlaceId);
    for (const other of others) {
      const photos = await bound.forPlace(other);
      assert.ok(!photos?.photos?.some(p => sources.some(s => s.entry.photo.url === p.url)), other.name);
    }
    for (const [name, count] of [['山东博物馆', 1], ['洪家楼天主教堂', 2]] as const) assert.equal((await lookup(name))?.photos?.length, count);
    assert.deepEqual(enqueued, []); assert.deepEqual(external, []);
    await rollbackIndependentPhotoDecision(client, decision.key, load);
    assert.deepEqual(await loadIndependentPhotoAssignments(client, '济南'), previous);
    assert.equal(photoIdentityDigest(await load()), beforeDigest);
    const report = { decisionHash: photoIdentityDigest(decision), liveReadOnly: true, liveBatchAssignments: liveBatch.length,
      actualCityRows: rows.length, previousAssignmentsPreserved: previous.length, approvedBindings: 4,
      individuallyVerified: individual, displayPhotos: 3, probes, otherEntitiesExcluded: others.length,
      idempotent: true, rollback: true, sourceUnchanged: true, externalRequests: 0, enqueued: 0 };
    await writeFile(new URL(`independent-photo-batch-03/verify-${Date.now()}.json`, import.meta.url), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  } finally { await live.end(); await client.query('ROLLBACK'); client.release(); }
});
