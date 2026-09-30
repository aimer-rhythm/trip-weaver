// 仅修复本轮验收脚本遗漏的来源会话；保留原行程、原会话及所有行程字段。
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import pg from 'pg';
import { createReplayConversation } from './replay-conversation.mjs';
const id = '5dee10b5-b395-48cd-8fb9-470d4b9e4280';
const originalId = '0552c0b3-6446-48b9-bf4b-9a11699ce669';
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const sessionId = randomUUID();
const token = randomBytes(32).toString('hex');
const headers = { Cookie: `tw_session=${token}`, 'Content-Type': 'application/json' };
let createdConversation;
let linked = false;
try {
  const original = (await client.query('SELECT user_id,data FROM trips WHERE id=$1', [originalId])).rows[0];
  assert.ok(original);
  const current = (await client.query('SELECT t.data,g.id AS generation_id,g.conversation_id FROM trips t JOIN generations g ON g.trip_id=t.id AND g.user_id=t.user_id WHERE t.id=$1 AND t.user_id=$2 AND g.status=$3', [id, original.user_id, 'done'])).rows[0];
  assert.ok(current);
  if (current.conversation_id) {
    console.log(JSON.stringify({ tripId: id, conversationId: current.conversation_id, changed: false }));
  } else {
    await fs.mkdir('data/backups/image-optimization', { recursive: true });
    await fs.writeFile(`data/backups/image-optimization/${id}-conversation-${Date.now()}.json`, JSON.stringify(current, null, 2), { flag: 'wx' });
    await client.query('INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at) VALUES ($1,$2,$3,$4,$5)',
      [sessionId, original.user_id, createHash('sha256').update(token).digest('hex'), new Date(Date.now() + 900000), new Date()]);
    const trip = current.data;
    const form = Object.fromEntries(['destination','startDate','preferences','partySize','transportMode'].filter(k => trip[k] !== undefined).map(k => [k,trip[k]]));
    form.days = trip.days.length;
    createdConversation = await createReplayConversation(headers, form, originalId);
    await client.query('BEGIN');
    const currentTrip = (await client.query('SELECT data FROM trips WHERE id=$1 AND user_id=$2 FOR UPDATE', [id, original.user_id])).rows[0];
    assert.deepEqual(currentTrip.data, current.data, '并发修改后不继续修补');
    const updated = await client.query('UPDATE generations SET conversation_id=$1 WHERE id=$2 AND trip_id=$3 AND user_id=$4 AND conversation_id IS NULL', [createdConversation, current.generation_id, id, original.user_id]);
    assert.equal(updated.rowCount, 1);
    await client.query('COMMIT'); linked = true;
    const association = await (await fetch(`http://127.0.0.1:8787/api/trips/${id}/conversation`, { headers })).json();
    assert.equal(association.conversationId, createdConversation);
    const detail = await (await fetch(`http://127.0.0.1:8787/api/conversations/${createdConversation}`, { headers })).json();
    assert.equal(detail.latestTrip?.id, id);
    const originalAfter = (await client.query('SELECT data FROM trips WHERE id=$1 AND user_id=$2', [originalId, original.user_id])).rows[0];
    assert.deepEqual(originalAfter.data, original.data);
    const report = { tripId: id, conversationId: createdConversation, changed: true, tripDataUnchanged: true, originalTripUnchanged: true, targetTripId: detail.latestTrip.id };
    await fs.writeFile('.trellis/tasks/09-29-hangzhou-image-diagnosis/research/conversation-repair.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  }
} catch (error) {
  await client.query('ROLLBACK');
  if (createdConversation && !linked) await fetch(`http://127.0.0.1:8787/api/conversations/${createdConversation}`, { method: 'DELETE', headers, signal: AbortSignal.timeout(15000) });
  throw error;
} finally {
  await client.query('DELETE FROM sessions WHERE id=$1', [sessionId]);
  await client.end();
}
