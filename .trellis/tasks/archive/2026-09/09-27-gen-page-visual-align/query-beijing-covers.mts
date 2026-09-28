// 北京景点封面覆盖率探测（09-27 视觉对齐任务）：库内 payload.coverImage 命中情况。
// 用法：npx tsx apps/server/query-beijing-covers.mts
import { pool } from './src/db/client';

const CITY = '北京';

const top = await pool.query<{ name: string; cover: string | null; score: string | null; mentions: string | null; source: string; category: string }>(
  `SELECT name, source, category,
          payload->>'coverImage' AS cover,
          payload->>'recommendScore' AS score,
          payload->>'mentionCount' AS mentions
   FROM canonical_places
   WHERE city = $1
   ORDER BY
     CASE WHEN payload->>'recommendScore' ~ '^[0-9]+(\\.[0-9]+)?$' THEN (payload->>'recommendScore')::numeric ELSE 0 END DESC,
     CASE WHEN payload->>'mentionCount' ~ '^[0-9]+$' THEN (payload->>'mentionCount')::int ELSE 0 END DESC
   LIMIT 12`,
  [CITY],
);

console.log(`=== 北京 TOP12（按 recommendScore / mentionCount） ===`);
let withCover = 0;
top.rows.forEach((r, i) => {
  if (r.cover) withCover += 1;
  console.log(
    `${String(i + 1).padStart(2)}. ${r.name}  cover=${r.cover ? '有' : '无'}  score=${r.score ?? '-'}  mentions=${r.mentions ?? '-'}  src=${r.source}/${r.category}`,
  );
});
console.log(`TOP12 有图：${withCover}/${top.rows.length}`);

const stat = await pool.query<{ total: string; with_cover: string }>(
  `SELECT count(*) AS total,
          count(*) FILTER (WHERE COALESCE(payload->>'coverImage', '') <> '') AS with_cover
   FROM canonical_places WHERE city = $1`,
  [CITY],
);
console.log('=== 北京全库 ===', stat.rows[0]);

const byCat = await pool.query(
  `SELECT category, count(*) AS total,
          count(*) FILTER (WHERE COALESCE(payload->>'coverImage', '') <> '') AS with_cover
   FROM canonical_places WHERE city = $1 GROUP BY category ORDER BY total DESC`,
  [CITY],
);
console.table(byCat.rows);

const bySource = await pool.query(
  `SELECT source, count(*) AS total,
          count(*) FILTER (WHERE COALESCE(payload->>'coverImage', '') <> '') AS with_cover
   FROM canonical_places WHERE city = $1 GROUP BY source ORDER BY total DESC`,
  [CITY],
);
console.table(bySource.rows);

const sample = await pool.query<{ name: string; cover: string }>(
  `SELECT name, payload->>'coverImage' AS cover FROM canonical_places
   WHERE city = $1 AND COALESCE(payload->>'coverImage', '') <> '' LIMIT 5`,
  [CITY],
);
console.log('=== 有图样例（相对 key） ===');
console.log(sample.rows);

await pool.end();
