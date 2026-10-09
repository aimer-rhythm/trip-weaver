// 仅迁移关系来源快照表；默认事务预演，原表只记录数量/摘要、不导出用户内容。
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { open, readFile } from 'node:fs/promises';
import { Client } from 'pg';
import { parse } from 'dotenv';
import { PLACE_RELATION_SNAPSHOT_STATEMENTS } from '../../../../apps/server/src/db/migrate';
import { relationDigest } from '../../../../apps/server/src/services/placeRelationIdentity';

const { values } = parseArgs({ options: { apply: { type: 'boolean' }, out: { type: 'string' } } });
assert.ok(values.out, '须指定不覆盖的--out');
const output = await open(values.out, 'wx');
const configuration = parse(await readFile('apps/server/.env'));
assert.ok(configuration.DATABASE_URL);
const client = new Client({ connectionString: configuration.DATABASE_URL, connectionTimeoutMillis: 10000 });
const oldTables = ['canonical_places', 'research_evidence', 'place_relation', 'data_import', 'place_identity_imports', 'trips', 'independent_photo_assignments', 'independent_photo_changes'];
const newTables = ['place_relation_snapshots'];
const fingerprint = async (tables: string[]) => {
  const result: Record<string, { count: number; digest: string }> = {};
  for (const table of tables) {
    assert.match(table, /^[a-z_]+$/);
    result[table] = (await client.query(`SELECT count(*)::int AS count,
      md5(COALESCE(string_agg(h,'' ORDER BY h),'')) AS digest FROM
      (SELECT md5(to_jsonb(t)::text) h FROM "${table}" t) hashes`)).rows[0];
  }
  return result;
};
try {
  await client.connect();
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout='8s'");
  await client.query("SET LOCAL statement_timeout='45s'");
  // 锁定受保护数据以核实本事务没有改行；超时则整批退出，不停服务。
  for (const table of oldTables) await client.query(`LOCK TABLE "${table}" IN SHARE MODE`);
  const before = await fingerprint(oldTables);
  const existed = (await client.query('SELECT tablename FROM pg_tables WHERE schemaname=current_schema() AND tablename=ANY($1::text[]) ORDER BY tablename', [newTables])).rows.map(r => r.tablename);
  const originalNew = await fingerprint(existed);
  for (const sql of PLACE_RELATION_SNAPSHOT_STATEMENTS) await client.query(sql);
  const first = await fingerprint(newTables);
  for (const sql of PLACE_RELATION_SNAPSHOT_STATEMENTS) await client.query(sql);
  const second = await fingerprint(newTables);
  const after = await fingerprint(oldTables);
  assert.deepEqual(after, before, '原数据发生变化');
  assert.deepEqual(first, second, '二次迁移不幂等');
  for (const table of existed) assert.deepEqual(first[table], originalNew[table], '已有关系快照被改写');
  const columns = (await client.query(`SELECT table_name,column_name,data_type,is_nullable FROM information_schema.columns
    WHERE table_schema=current_schema() AND table_name=ANY($1::text[]) ORDER BY table_name,ordinal_position`, [newTables])).rows;
  const report = { apply: !!values.apply, statementsHash: relationDigest(PLACE_RELATION_SNAPSHOT_STATEMENTS), existed,
    before, after, first, second, columns, unchanged: true, idempotent: true };
  await client.query(values.apply ? 'COMMIT' : 'ROLLBACK');
  await output.writeFile(JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ apply: !!values.apply, unchanged: true, idempotent: true, oldTables: before, relationTables: second, out: values.out }));
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  await output.writeFile(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : '迁移失败' }));
  throw error;
} finally { await client.end(); await output.close(); }
