import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { makeSampleTrip } from '@tripweaver/shared';
import { pool } from '../../../../apps/server/src/db/client';
import { loadPlaceIdentityIndex } from '../../../../apps/server/src/services/placeIdentityService';
import { createPlaceRetriever } from '../../../../apps/server/src/generation/placeRetrieval';
import { loadCityPlaceFacts } from '../../../../apps/server/src/generation/scheduling/placeFacts';
import { bindEditPlaceIdentities } from '../../../../apps/server/src/chat/placeIdentity';
import { normalizeEditOps, editActivityDrafts, applyItineraryEdits } from '../../../../apps/server/src/chat/editOps';
import { createTrip, getTrip } from '../../../../apps/server/src/services/tripService';
import { createGenerationPhotoLookup, photoReviewQueue } from '../../../../apps/server/src/integrations/photoEnrichment';

after(() => pool.end());

test('459实际上游导出经真实下游导入，旧ID不恢复公交站别名且历史行程保存不变', async () => {
  const file = new URL('./all-cities/batch-24/scope-preview/xhs-places-重庆.json', import.meta.url);
  const data = JSON.parse(await readFile(file, 'utf8'));
  const primary = '2f6c627fdf341bf54b049f3c0ae84d74', old = '79afbf6edf8899c29d2eb71edf8c3c81';
  const city = data.city, user = randomUUID();
  assert.equal(city, '重庆'); assert.equal(data.places[0].id, primary);
  assert.match(process.env.DATABASE_URL ?? '', /127\.0\.0\.1:18798\/place_identity_test_\d+$/);
  const execute = (script: string, args: string[]) => promisify(execFile)(process.execPath,
    ['--import', 'tsx', fileURLToPath(new URL(`../../../../apps/server/scripts/${script}`, import.meta.url)), ...args],
    { env: process.env, windowsHide: true, timeout: 30000 });
  try {
    await pool.query(`INSERT INTO canonical_places(id,city,name,category,source,verified,payload,created_at)
      VALUES($1,$2,'呼归石公交站对面','文化','xhs',true,$3,now()),($4,$2,'呼归石公交站','文化','xhs',true,$3,now())`,
      [primary, city, { content: { intro: '公交站旧事实' }, coverImage: 'xhs/old/00.webp', typicalVisitMinutes: 99 }, old]);
    await pool.query("INSERT INTO users(id,email,password_hash,created_at) VALUES($1,$2,'',now())", [user, `${user}@example.test`]);
    const trip = makeSampleTrip(); trip.destination = city;
    Object.assign(trip.days[0]!.activities[0]!, { name: '呼归石公交站对面', canonicalPlaceId: old });
    const saved = await createTrip(user, trip);
    await execute('seed-xhs-places.ts', [fileURLToPath(file)]);
    const identities = await loadPlaceIdentityIndex(city);
    assert.equal(identities.groups.length, 1);
    assert.equal(identities.resolve(city, '呼归石公交站对面', old).status, 'resolved');
    assert.equal(identities.resolve(city, '呼归石公交站', old).status, 'unresolved');
    assert.equal(identities.resolve(city, '呼归石公交站').status, 'unresolved');
    assert.ok(identities.isScopedReference(city, '呼归石公交站'), '原错误名也不能通过独立图库补图');
    const photoLookup = createGenerationPhotoLookup(city, async () => identities);
    const originalEnqueue = photoReviewQueue.enqueue;
    let queued = 0;
    photoReviewQueue.enqueue = async (...args) => { queued++; return originalEnqueue(...args); };
    try {
      assert.equal(await photoLookup('呼归石公交站'), null);
      assert.equal(await photoLookup('呼归石公交站对面'), null);
      assert.equal(queued, 0);
    } finally { photoReviewQueue.enqueue = originalEnqueue; }
    const retrieve = createPlaceRetriever({ query: (sql, values) => pool.query(sql, values), embed: async () => null });
    const rows = await retrieve(['呼归石公交站对面'], { city, vector: 'off' });
    assert.equal(rows.length, 1); assert.equal(rows[0]!.canonicalPlaceId, primary);
    assert.equal(rows[0]!.payload?.mentionCount, 3);
    assert.equal(rows[0]!.evidence.length, 3);
    const facts = await loadCityPlaceFacts(city);
    assert.equal(facts.has('呼归石公交站'), false);
    const fact = facts.get('呼归石公交站对面'); assert.ok(fact);
    assert.equal(fact.coverImage, undefined); assert.equal(fact.visitMinutes, undefined);
    const ops = normalizeEditOps([{ kind: 'add_activity', dayIndex: 1, activity: { name: '呼归石公交站对面' } }]);
    const current = bindEditPlaceIdentities(saved, editActivityDrafts(ops), identities, '加入机位');
    assert.equal(current.days[0]!.activities[0]!.canonicalPlaceId, primary);
    assert.equal(applyItineraryEdits(current, ops).changed, false);
    const next = await createTrip(user, current, saved.id);
    assert.equal((await getTrip(user, next.id))!.days[0]!.activities[0]!.canonicalPlaceId, primary);
    assert.deepEqual(await getTrip(user, saved.id), saved);
    await assert.rejects(execute('seed-xhs-places.ts', [fileURLToPath(file), '--purge']), /不能通过 --purge/);
    assert.deepEqual(await getTrip(user, saved.id), saved);
  } finally {
    await pool.query('DELETE FROM trips WHERE user_id=$1', [user]);
    await pool.query('DELETE FROM users WHERE id=$1', [user]);
  }
});
