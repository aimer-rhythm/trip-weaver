// 一次性排查：为什么某个点被排到后面 —— 打印候选的排程权重与实际得分
// 用法（apps/server 目录）：npx tsx test-rank-probe.mts
import 'dotenv/config';
import { pool } from './src/db/client';

const NAMES = ['雍和宫', '什刹海', '恭王府博物馆', '北海公园', '景山公园', '故宫博物院', '天坛公园', '奥林匹克森林公园', '慕田峪长城'];

const { rows } = await pool.query<{
  name: string; category: string;
  score: number | null; mention: number | null; ptype: string | null;
}>(
  `SELECT name, category,
          (payload->>'recommendScore')::float8 AS score,
          (payload->>'mentionCount')::float8   AS mention,
          payload->>'xhsPlaceType'             AS ptype
   FROM canonical_places WHERE city = '北京' AND name = ANY($1)`,
  [NAMES],
);

const maxScore = Math.max(1, ...rows.map((r) => r.score ?? 0));
const maxMention = Math.max(1, ...rows.map((r) => r.mention ?? 0));
console.log(`maxScore=${maxScore} maxMention=${maxMention}`);
console.log('名称'.padEnd(12) + 'recommendScore  mention  类型        归一化score  = 质量*0.6 + 热度*0.4');
for (const row of rows.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))) {
  const quality = ((row.score ?? 0) / maxScore) * 60;
  const heat = ((row.mention ?? 0) / maxMention) * 40;
  console.log(
    `${row.name.padEnd(12)}${String(row.score ?? '-').padStart(14)}${String(row.mention ?? '-').padStart(9)}  ` +
      `${String(row.ptype ?? '-').padEnd(12)}${(quality + heat).toFixed(1).padStart(11)}  (${quality.toFixed(1)} + ${heat.toFixed(1)})`,
  );
}
await pool.end();
