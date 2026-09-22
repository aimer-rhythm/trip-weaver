// PG 往返延迟探针：解释 add_candidate / search_verified_places 每次 3 秒级耗时的来源
// 用法（apps/server 目录）：npx tsx test-pg-latency.mts
import 'dotenv/config';
import { pool } from './src/db/client';

const t = async (label: string, sql: string, params: unknown[] = []) => {
  const runs: number[] = [];
  let n = 0;
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    const { rows } = await pool.query(sql, params);
    runs.push(performance.now() - start);
    n = rows.length;
  }
  const avg = runs.reduce((a, b) => a + b, 0) / runs.length;
  console.log(
    `${label.padEnd(34)} avg=${avg.toFixed(0)}ms min=${Math.min(...runs).toFixed(0)}ms max=${Math.max(...runs).toFixed(0)}ms rows=${n}`,
  );
};

await t('SELECT 1', 'SELECT 1');
await t('canonical_places keyword', 'SELECT id FROM canonical_places WHERE verified = TRUE LIMIT 8');
await t('research_evidence by place_id', 'SELECT place_id FROM research_evidence LIMIT 3');
await pool.end();
