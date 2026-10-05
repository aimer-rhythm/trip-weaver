// 合成 PostgreSQL 表验证原值守卫、全事务回滚、独立字段保护和幂等；不连接应用库。
import assert from 'node:assert/strict';
import { Client } from 'pg';
import { createEvaluationDatabase } from '../../../../eval/isolation';
import { patchHours, HoursPatchConflict, type HoursChange, type HoursBackup } from './hoursPatch';

const database = await createEvaluationDatabase(process.env.EVAL_PG_ADMIN_URL);
const client = new Client({ connectionString: database.url });
const changes: HoursChange[] = [
  { id: 'street', name: '街区', city: '成都', source: 'xhs', before: null, after: { version: 2, status: 'unknown' } },
  { id: 'gold', name: '金集地点', city: '成都', source: 'goldset', before: { closedWeekdays: [1] }, after: { version: 2, closedWeekdays: [] } },
  { id: 'explicit-null', name: '空值地点', city: '成都', source: 'xhs', before: null, after: { version: 2, status: 'unknown' } },
];
let checks = 0;
try {
  await client.connect();
  await client.query(`CREATE TABLE canonical_places (id text PRIMARY KEY,name text,city text,source text,payload jsonb,embedding text);
    CREATE TABLE trips (id text PRIMARY KEY,data jsonb);
    INSERT INTO trips VALUES ('history','{"unchanged":true}');
    INSERT INTO canonical_places VALUES
      ('street','街区','成都','xhs','{"coverImage":"existing.webp","privateOther":"keep"}','existing-vector'),
      ('gold','金集地点','成都','goldset','{"openHours":{"closedWeekdays":[1]},"activity":{"name":"原金集"}}','gold-vector'),
      ('explicit-null','空值地点','成都','xhs','{"openHours":null,"coverImage":"keep.webp"}','null-vector')`);
  const original = (await client.query('SELECT * FROM canonical_places ORDER BY id')).rows;
  const unchanged = async () => assert.deepEqual((await client.query('SELECT * FROM canonical_places ORDER BY id')).rows, original);
  const backupFailure = async () => { throw new Error('disk failed'); };
  const dry = await patchHours(client, changes, 'dry-run', backupFailure);
  assert.equal(dry.pending, 3); await unchanged(); checks++;
  for (const change of [
    { ...changes[0]!, id: 'missing' }, { ...changes[0]!, name: '改名' },
    { ...changes[0]!, city: '北京' }, { ...changes[0]!, source: 'goldset' },
    { ...changes[0]!, before: { different: true } },
  ]) {
    await assert.rejects(patchHours(client, [change, changes[1]!], 'apply', async () => {}), HoursPatchConflict);
    await unchanged(); checks++;
  }
  await assert.rejects(patchHours(client, changes, 'apply', backupFailure), /disk failed/); await unchanged(); checks++;
  await client.query(`CREATE FUNCTION reject_patch() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.id='street' THEN RAISE EXCEPTION 'injected'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_hours BEFORE UPDATE ON canonical_places FOR EACH ROW EXECUTE FUNCTION reject_patch()`);
  await assert.rejects(patchHours(client, changes, 'apply', async () => {}), /injected/); await unchanged(); checks++;
  await client.query('DROP TRIGGER reject_hours ON canonical_places');
  await client.query(`CREATE FUNCTION change_photo() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN NEW.payload=NEW.payload || '{"coverImage":"wrong.webp"}'::jsonb; RETURN NEW; END $$;
    CREATE TRIGGER photo_drift BEFORE UPDATE ON canonical_places FOR EACH ROW EXECUTE FUNCTION change_photo()`);
  await assert.rejects(patchHours(client, changes, 'apply', async () => {}), /营业字段以外/); await unchanged(); checks++;
  await client.query('DROP TRIGGER photo_drift ON canonical_places');
  let backup: HoursBackup | undefined;
  const applied = await patchHours(client, changes, 'apply', async (value) => { backup = value; });
  assert.equal(applied.updated, 3);
  assert.equal(backup?.rows.find((r) => r.id === 'street')?.hadHours, false);
  assert.equal(backup?.rows.find((r) => r.id === 'gold')?.hadHours, true);
  assert.equal(backup?.rows.find((r) => r.id === 'explicit-null')?.hadHours, true);
  const rows = (await client.query('SELECT * FROM canonical_places ORDER BY id')).rows;
  for (const row of rows) {
    const expected = structuredClone(original.find((p) => p.id === row.id)!);
    expected.payload.openHours = changes.find((c) => c.id === row.id)!.after;
    assert.deepEqual(row, expected);
  }
  assert.deepEqual((await client.query('SELECT * FROM trips')).rows, [{ id: 'history', data: { unchanged: true } }]); checks++;
  const again = await patchHours(client, changes, 'apply', backupFailure);
  assert.equal(again.updated, 0); assert.equal(again.alreadyApplied, 3); checks++;
  const removals = changes.map((change) => ({ ...change, before: change.after, after: null }));
  assert.equal((await patchHours(client, removals, 'apply', async () => {})).updated, 3);
  for (const row of (await client.query('SELECT * FROM canonical_places ORDER BY id')).rows) {
    const expected = structuredClone(original.find((p) => p.id === row.id)!);
    delete expected.payload.openHours;
    assert.deepEqual(row, expected);
  }
  assert.equal((await patchHours(client, removals, 'apply', backupFailure)).alreadyApplied, 3); checks++;
  console.log(`PASS ${checks} 组 PostgreSQL 守卫/备份/回滚/字段保护/幂等检查`);
} finally { await client.end(); await database.close(); }
