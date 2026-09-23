import 'dotenv/config';
import { pool } from './src/db/client';
for (const kw of ['故宫', '天坛']) {
  const r = await pool.query(
    `SELECT id, name, source, (payload ? 'recommendScore') AS has_score
     FROM canonical_places WHERE city='北京' AND name LIKE $1 ORDER BY source, name`, [`%${kw}%`]);
  console.log(`--- 含「${kw}」的行 ---`);
  for (const x of r.rows) console.log(`  ${x.name.padEnd(16)} ${String(x.source).padEnd(8)} hasScore=${x.has_score} id=${String(x.id).slice(0,8)}`);
}
await pool.end();
