import 'dotenv/config';
import { pool } from './src/db/client';
const r = await pool.query(`SELECT source, city, (payload ? 'recommendScore') AS has_score, count(*)::int AS n
  FROM canonical_places WHERE city IN ('北京','成都') GROUP BY 1,2,3 ORDER BY 2,1,3`);
for (const x of r.rows) console.log(`${x.city}  ${String(x.source).padEnd(8)} hasScore=${String(x.has_score).padEnd(6)} ${x.n}`);
await pool.end();
