// 实库只读；真实地点与图源在专用PG执行幂等/撤销及生产图片入口。
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
test('济南实图：4绑定/1错误正例撤销、别名消费、同资产防回退、幂等及回滚', async () => {
  assert.match(process.env.DATABASE_URL ?? '', /place_identity_test_\d+/);
  const [decision] = JSON.parse(await readFile(new URL('independent-photo-batch-02/decisions.json', import.meta.url), 'utf8')) as IndependentPhotoDecision[];
  assert.ok(decision); assert.equal(decision.images.length, 5);
  const configuration = parse(await readFile('apps/server/.env'));
  const live = new Client({ connectionString: configuration.DATABASE_URL, connectionTimeoutMillis: 10000 });
  const client = await pool.connect();
  try {
    await live.connect(); await live.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const rows = (await live.query<PlaceRow>('SELECT id,city,name,category,source,verified,payload,lat,lng FROM canonical_places WHERE city=$1', ['济南'])).rows;
    const liveAssignments = await loadIndependentPhotoAssignments(live, '济南');
    await live.query('ROLLBACK');
    await client.query('BEGIN');
    for (const row of rows) await client.query(`INSERT INTO canonical_places(id,city,name,category,source,verified,payload,lat,lng,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now())`, [row.id,row.city,row.name,row.category,row.source,row.verified,row.payload,row.lat,row.lng]);
    const index = createPlaceIdentityIndex(rows.filter(r => r.verified || r.payload?.identityWithdrawal)
      .map(r => ({ ...r, aliases: placeNames(r), evidence: [] })));
    const load = () => loadIndependentPhotoSources('济南');
    const inputs = await load(); const beforeDigest = photoIdentityDigest(inputs);
    for (const image of decision.images) assert.ok(inputs.sources.some(s => s.imageKey === image.imageKey && s.inputHash === image.inputHash));
    const appliedState = await applyIndependentPhotoDecision(client, decision, load);
    assert.deepEqual(await applyIndependentPhotoDecision(client, decision, load), appliedState);
    const applied = await loadIndependentPhotoAssignments(client, '济南');
    assert.equal(applied.length, 5); assert.equal(applied.filter(a => a.entity_id).length, 4);
    assert.equal((await client.query('SELECT count(*)::int count FROM independent_photo_changes WHERE change_key=$1', [decision.key])).rows[0].count, 1);
    if (liveAssignments.length) assert.deepEqual(liveAssignments.filter(r => r.change_key === decision.key), applied);
    const enqueued: string[] = [], external: string[] = [];
    const lookup = createGenerationPhotoLookup('济南', async () => index, { loadSources: load,
      loadAssignments: () => loadIndependentPhotoAssignments(client, '济南'), enqueue: async (_city, name) => { enqueued.push(name); },
      adoption: { mediaBase: '/media', adoptUnsplash: async () => { external.push('unsplash'); return false; } } });
    const probes = [];
    for (const names of [['山东博物馆', '山东省博物馆'], ['洪家楼天主教堂', '洪家楼教堂']]) {
      const place = index.resolve('济南', names[0]!); assert.ok(place.status === 'resolved');
      const allowed = inputs.sources.filter(s => applied.some(a => a.image_key === s.imageKey && a.entity_id === place.canonicalPlaceId));
      assert.equal(allowed.length, names[0] === '山东博物馆' ? 1 : 3);
      for (const name of names) {
        const cover = await lookup(name); assert.ok(cover && cover.photos?.length);
        assert.ok(cover.photos.every(p => allowed.some(s => s.entry.photo.url === p.url)));
        assert.equal(cover.photos.length, names[0] === '山东博物馆' ? 1 : 2); // 现行view去重保留两张，不改原目录排序。
        probes.push({ name, photos: cover.photos.map(p => p.url), approvedOnly: true });
      }
      // 每张绑定均独立可消费，不让画面view去重掩盖第三张来源失效。
      for (const source of allowed) {
        const single = createBoundPhotoLookup('济南', { ...inputs, sources: [source] }, applied, index, { mediaBase: '/media' });
        const photo = await single.forPlace(place.place); assert.equal(photo?.photos?.[0]?.url, source.entry.photo.url);
      }
    }
    const bound = createBoundPhotoLookup('济南', inputs, applied, index);
    const rejected = decision.images.find(i => i.entityId === null)!;
    const rejectedSource = inputs.sources.find(s => s.imageKey === rejected.imageKey)!;
    assert.equal(rejectedSource.eligible, true, '本例须覆盖原模型错误正例');
    assert.equal(bound.allowUnbound(rejectedSource.entry), false);
    for (const source of inputs.sources.filter(s => s.assetKey === rejectedSource.assetKey)) assert.equal(bound.allowUnbound(source.entry), false);
    const otherPlaces = index.groups.flat().filter(p => !Object.hasOwn(decision.expectedEntityRevisions, p.id));
    for (const place of otherPlaces) assert.equal(await bound.forPlace(place), null);
    assert.deepEqual(enqueued, []); assert.deepEqual(external, []);
    await rollbackIndependentPhotoDecision(client, decision.key, load);
    assert.deepEqual(await loadIndependentPhotoAssignments(client, '济南'), []);
    assert.equal(photoIdentityDigest(await load()), beforeDigest);
    const report = { liveReadOnly: true, liveAssignments: liveAssignments.length, actualCityRows: rows.length,
      approvedBindings: 4, wrongPositiveWithdrawn: 1, otherEntitiesExcluded: otherPlaces.length, probes,
      idempotent: true, rollback: true, sourceUnchanged: true, externalRequests: 0, enqueued: 0 };
    await writeFile(new URL(`independent-photo-batch-02/verify-${Date.now()}.json`, import.meta.url), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  } finally { await live.end(); await client.query('ROLLBACK'); client.release(); }
});
