// 读取实库城市身份/绑定，写入仅限runner创建的一次性库；不读取用户行程、不请求外部图源。
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { readFile, writeFile } from 'node:fs/promises';
import { Client } from 'pg';
import { parse } from 'dotenv';
import { pool } from '../../../../apps/server/src/db/client';
import type { RetrievedPlace } from '../../../../apps/server/src/generation/placeRetrieval';
import { createPlaceIdentityIndex } from '../../../../apps/server/src/lib/placeIdentity';
import { loadIndependentPhotoSources } from '../../../../apps/server/src/services/independentPhotoSources';
import { applyIndependentPhotoDecision, rollbackIndependentPhotoDecision, loadIndependentPhotoAssignments,
  type IndependentPhotoDecision } from '../../../../apps/server/src/services/independentPhotoIdentity';
import { createGenerationPhotoLookup } from '../../../../apps/server/src/integrations/photoEnrichment';
import { createSelectedPhotoLibrary } from '../../../../apps/server/src/integrations/selectedPhotos';
import { createBoundPhotoLookup } from '../../../../apps/server/src/integrations/boundPhotoLookup';

after(() => pool.end());
test('北京八张真实选图逐图绑定、正式入口及倒序回滚，保留人工顺序、别名和原目录', async () => {
  assert.match(process.env.DATABASE_URL ?? '', /place_identity_test_\d+/);
  const [decision] = JSON.parse(await readFile(new URL('independent-photo-batch-01/decisions.json', import.meta.url), 'utf8')) as IndependentPhotoDecision[];
  assert.ok(decision);
  const configuration = parse(await readFile('apps/server/.env'));
  const live = new Client({ connectionString: configuration.DATABASE_URL, connectionTimeoutMillis: 10000 });
  const client = await pool.connect();
  try {
    await live.connect();
    await live.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const rows = (await live.query<RetrievedPlace>('SELECT id,city,name,category,source,verified,payload,lat,lng FROM canonical_places WHERE city=$1', ['北京'])).rows;
    const liveAssignments = await loadIndependentPhotoAssignments(live, '北京');
    await live.query('ROLLBACK');
    await client.query('BEGIN');
    for (const row of rows) await client.query(`INSERT INTO canonical_places(id,city,name,category,source,verified,payload,lat,lng,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now())`, [row.id,row.city,row.name,row.category,row.source,row.verified,row.payload,row.lat,row.lng]);
    const index = createPlaceIdentityIndex(rows.filter(row => row.verified || row.payload?.identityWithdrawal));
    const original = await readFile('apps/server/src/data/photography/beijing-selected.json', 'utf8');
    const inputs = await loadIndependentPhotoSources('北京');
    const load = () => loadIndependentPhotoSources('北京');
    const baseline = createSelectedPhotoLibrary('北京', { mediaBase: '/media' });
    await applyIndependentPhotoDecision(client, decision, load);
    const applied = await loadIndependentPhotoAssignments(client, '北京');
    assert.equal(applied.length, 8);
    if (liveAssignments.length) assert.deepEqual(liveAssignments.filter(r => r.change_key === decision.key), applied);
    const enqueued: string[] = [], remote: string[] = [];
    const lookup = createGenerationPhotoLookup('北京', async () => index, { loadSources: load,
      loadAssignments: () => loadIndependentPhotoAssignments(client, '北京'),
      enqueue: async (_city, name) => { enqueued.push(name); },
      adoption: { mediaBase: '/media', adoptUnsplash: async asset => { remote.push(asset.downloadLocation ?? ''); return false; } } });
    const probes = [];
    for (const names of [['北海公园', '北海'], ['八达岭长城', '八达岭']]) {
      const expected = await baseline.coverFor(names[0]!);
      assert.ok(expected);
      for (const name of names) {
        const actual = await lookup(name);
        assert.deepEqual(actual, expected);
        probes.push({ name, photos: actual!.photos!.length, sameAsOriginal: true });
      }
    }
    const bound = createBoundPhotoLookup('北京', inputs, applied, index);
    const otherPlaces = index.groups.flat().filter(p => !Object.hasOwn(decision.expectedEntityRevisions, p.id));
    for (const place of otherPlaces) assert.equal(await bound.forPlace(place), null);
    assert.deepEqual(enqueued, []);
    assert.deepEqual(remote, []);
    await rollbackIndependentPhotoDecision(client, decision.key, load);
    assert.deepEqual(await loadIndependentPhotoAssignments(client, '北京'), []);
    assert.equal(await readFile('apps/server/src/data/photography/beijing-selected.json', 'utf8'), original);
    const report = { liveReadOnly: true, liveAssignments: liveAssignments.length, actualCityRows: rows.length,
      isolatedPhotos: applied.length, otherEntitiesExcluded: otherPlaces.length, probes,
      rollback: true, sourceUnchanged: true, externalRequests: remote.length, enqueued: enqueued.length };
    await writeFile(new URL(`independent-photo-batch-01/verify-${Date.now()}.json`, import.meta.url), JSON.stringify(report, null, 2), { flag: 'wx' });
  } finally { await live.end(); await client.query('ROLLBACK'); client.release(); }
});
