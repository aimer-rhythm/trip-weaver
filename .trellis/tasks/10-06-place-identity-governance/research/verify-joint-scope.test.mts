import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash, randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {makeSampleTrip, placeNameKey} from '@tripweaver/shared';
import {asRecord} from '../../../../apps/server/src/chat/models';
import {pool} from '../../../../apps/server/src/db/client';
import {loadPlaceIdentityIndex} from '../../../../apps/server/src/services/placeIdentityService';
import {captureIdentityImport, rollbackIdentityImport} from '../../../../apps/server/src/services/placeIdentityAudit';
import type {ImportPlace} from '../../../../apps/server/src/services/placeImportIdentity';
import {createPlaceRetriever} from '../../../../apps/server/src/generation/placeRetrieval';
import {loadCityPlaceFacts} from '../../../../apps/server/src/generation/scheduling/placeFacts';
import {bindEditPlaceIdentities} from '../../../../apps/server/src/chat/placeIdentity';
import {normalizeEditOps, editActivityDrafts, applyItineraryEdits} from '../../../../apps/server/src/chat/editOps';
import {createTrip, getTrip} from '../../../../apps/server/src/services/tripService';

after(() => pool.end());

test('受控范围真实导出贯通下游：旧ID撤回、两分店、全空及恢复、持久化和倒序审计', async () => {
  assert.match(process.env.DATABASE_URL ?? '', /127\.0\.0\.1:18798\/place_identity_test_\d+$/);
  const folder = new URL(process.env.IDENTITY_FLOW_FIXTURE ?? './all-cities/joint-scope/run-1791338090345872300/', import.meta.url);
  const report = JSON.parse(await readFile(new URL('report.json', folder), 'utf8'));
  assert.equal(report.synthetic, true); assert.equal(report.reverseRollback, true);
  const city: string = report.city, oldIds: string[] = report.oldIds, targets: string[] = report.targetIds;
  const data: Record<string, {places: ImportPlace[]}> = {};
  for (const label of ['before', 'assigned', 'empty', 'restored']) {
    const bytes = await readFile(new URL(report.files[label].file, folder));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), report.files[label].sha256);
    data[label] = JSON.parse(bytes.toString('utf8'));
  }
  if (report.createdEntities) {
    assert.deepEqual(new Set(data.before!.places.map(p => p.id)), new Set(oldIds));
    for (const id of targets) {
      const p = data.assigned!.places.find(p => p.id === id)!;
      assert.equal(p.lat, null); assert.equal(p.lng, null);
      assert.deepEqual(asRecord(p.payload?.identity)?.memberIds, [id]);
    }
  }
  const execute = (label: string) => promisify(execFile)(process.execPath,
    ['--import', 'tsx', fileURLToPath(new URL('../../../../apps/server/scripts/seed-xhs-places.ts', import.meta.url)),
      fileURLToPath(new URL(report.files[label].file, folder))],
    {env: process.env, windowsHide: true, timeout: 30000});
  const client = await pool.connect(), user = randomUUID();
  try {
    await execute('before');
    // 两个已存在旧源都带有旧图库、事实和向量；其中一个是金集覆盖。
    await client.query(`UPDATE canonical_places SET payload=payload || $2::jsonb, embedding=$3::vector
      WHERE id=ANY($1::text[])`, [oldIds, JSON.stringify({content: {intro: '混合旧事实'}, typicalVisitMinutes: 180,
      coverImage: 'xhs/old/00.webp', imageGallery: [{key: 'xhs/old/00.webp'}], amapPhoto: 'https://example.test/old.jpg'}),
      JSON.stringify(Array(1024).fill(0.01))]);
    await client.query("UPDATE canonical_places SET source='goldset' WHERE id=$1", [oldIds[0]]);
    const before = await captureIdentityImport(client, city);
    const initialAuditIds = new Set((await client.query('SELECT id FROM place_identity_imports WHERE city=$1', [city])).rows.map(r => r.id));
    await client.query("INSERT INTO users(id,email,password_hash,created_at) VALUES($1,$2,'',now())", [user, `${user}@example.test`]);
    const trip = makeSampleTrip(); trip.destination = city;
    for (const [i, id] of oldIds.entries()) Object.assign(trip.days[0]!.activities[i]!, {
      name: data.before!.places.find(p => p.id === id)!.name, canonicalPlaceId: id,
    });
    const saved = await createTrip(user, trip);
    await execute('assigned');
    let index = await loadPlaceIdentityIndex(city);
    assert.deepEqual(new Set(index.groups.flatMap(group => group.map(p => p.id))), new Set(targets));
    for (const id of oldIds) {
      const old = data.before!.places.find(p => p.id === id)!;
      assert.equal(index.resolve(city, old.name, id).status, 'ambiguous');
      const row = (await client.query('SELECT verified,lat,lng,payload,embedding FROM canonical_places WHERE id=$1', [id])).rows[0];
      assert.equal(row.verified, false); assert.equal(row.lat, null); assert.equal(row.lng, null); assert.equal(row.embedding, null);
      assert.equal(row.payload.content, undefined); assert.equal(row.payload.typicalVisitMinutes, undefined);
      assert.equal(row.payload.coverImage, null); assert.deepEqual(row.payload.imageGallery, []); assert.equal(row.payload.amapPhoto, null);
    }
    assert.equal((await client.query('SELECT source FROM canonical_places WHERE id=$1', [oldIds[0]])).rows[0].source, 'goldset');
    const retrieve = createPlaceRetriever({query: (sql, values) => client.query(sql, values), embed: async () => null});
    const recalled = await retrieve([], {city, browse: true, vector: 'off'});
    assert.deepEqual(new Set(recalled.map(p => p.canonicalPlaceId)), new Set(targets));
    const facts = await loadCityPlaceFacts(city);
    for (const id of oldIds) assert.equal(facts.has(placeNameKey(data.before!.places.find(p => p.id === id)!.name)), false);
    const branches = targets.map(id => data.assigned!.places.find(p => p.id === id)!);
    for (const [i, branch] of branches.entries()) {
      assert.equal(index.resolve(city, branch.name).status, 'resolved');
      assert.equal(facts.get(placeNameKey(branch.name))?.visitMinutes, [30, 60][i]);
    }
    const ops = normalizeEditOps(branches.map(branch => ({kind: 'add_activity', dayIndex: 1,
      activity: {name: branch.name, category: '美食'}})));
    const bound = bindEditPlaceIdentities(saved, editActivityDrafts(ops), index, '添加两家明确分店');
    for (const [i, id] of oldIds.entries()) assert.equal(bound.days[0]!.activities[i]!.canonicalPlaceId, id);
    const edited = applyItineraryEdits(bound, ops); assert.equal(edited.changed, true);
    const next = await createTrip(user, edited.trip, saved.id);
    const reread = await getTrip(user, next.id);
    for (const id of [...oldIds, ...targets]) assert.equal(reread!.days.flatMap(day => day.activities).filter(a => a.canonicalPlaceId === id).length, 1);
    assert.deepEqual(await getTrip(user, saved.id), saved);
    await execute('empty');
    index = await loadPlaceIdentityIndex(city);
    assert.equal(index.groups.length, 0);
    for (const p of data.empty!.places) assert.equal(index.resolve(city, p.name, p.id).status, 'unresolved');
    await execute('restored');
    index = await loadPlaceIdentityIndex(city);
    for (const branch of branches) assert.equal(index.resolve(city, branch.name, branch.id).status, 'resolved');
    await assert.rejects(execute('assigned'), /版本/);
    await execute('restored');
    assert.deepEqual(await getTrip(user, saved.id), saved);
    assert.deepEqual(await getTrip(user, next.id), reread);
    const audits = (await client.query('SELECT id FROM place_identity_imports WHERE city=$1 ORDER BY created_at DESC', [city]))
      .rows.filter(r => !initialAuditIds.has(r.id));
    assert.ok(audits.length >= 3);
    await client.query('BEGIN');
    for (const audit of audits) await rollbackIdentityImport(client, audit.id, true);
    assert.deepEqual(await captureIdentityImport(client, city), before);
    await client.query('COMMIT');
    assert.deepEqual(await getTrip(user, saved.id), saved);
  } finally { await client.query('ROLLBACK'); client.release(); }
});
