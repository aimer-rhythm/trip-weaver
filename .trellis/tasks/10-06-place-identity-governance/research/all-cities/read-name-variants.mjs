// 只读冻结指定城市原始名称变体；保留分店限定，不覆盖既有证据。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {Client} from 'pg';
import {parse} from 'dotenv';

const base = new URL('./', import.meta.url);
const [filename, city, pattern] = process.argv.slice(2);
assert.match(filename ?? '', /^[a-z0-9-]+\.json$/);
assert.ok(city && pattern, '需要城市及名称正则');
const target = new URL(filename, base);
assert.ok(!fs.existsSync(target), '冻结证据不能覆盖');
const env = parse(fs.readFileSync(new URL('../../../../../../xhs-travel-pipeline/.env', base)));
const db = new Client({connectionString: env.DATABASE_URL.replace('postgresql+asyncpg:', 'postgresql:'), connectionTimeoutMillis: 10000});
await db.connect();
try {
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await db.query("SET LOCAL statement_timeout = '15s'");
  const rows = (await db.query(`SELECT m.id mention_id,m.name,m.normalized_name,m.evidence_text,
    n.id note_id,n.title,n.desc,split_part(n.source_url,'?',1) source_url,n.img_analysis
    FROM place_mention m JOIN raw_note n ON n.id=m.raw_note_id
    WHERE n.city=$1 AND m.name ~* $2 ORDER BY m.id`, [city, pattern])).rows;
  fs.writeFileSync(target, JSON.stringify(rows, null, 2) + '\n', {flag: 'wx'});
  console.log(JSON.stringify({file: filename, city, pattern, mentions: rows.length, notes: new Set(rows.map(r => r.note_id)).size}));
} finally {
  try { await db.query('ROLLBACK'); } finally { await db.end(); }
}
