// 证据强度分级验证（09-21）：迁移回填分布 + renderRagContext 强度标签渲染
// 用法（apps/server 目录）：npx tsx test-rag-strength.mts
import 'dotenv/config';
import { pool } from './src/db/client';
import { retrieveContext } from './src/generation/retrieveContext';
import { renderRagContext } from './src/generation/prompts';

// 1. 回填分布：kind × strength
const dist = await pool.query(
  `SELECT kind, strength, count(*)::int AS n FROM research_evidence GROUP BY kind, strength ORDER BY kind, strength`,
);
console.log('—— research_evidence kind × strength 分布 ——');
console.table(dist.rows);
const empty = await pool.query(`SELECT count(*)::int AS n FROM research_evidence WHERE strength = ''`);
console.log(`strength 未回填行数：${empty.rows[0].n}`);

// 2. renderRagContext 渲染：情报行应带「·实证/·体验/·仅风险」标签，头部含措辞封顶规则
const places = await retrieveContext(['故宫博物院', '景山公园', '什刹海', '天坛公园', '颐和园'], { city: '北京' });
console.log(`\n—— renderRagContext（命中 ${places.length} 个地点）——`);
console.log(renderRagContext(places));
process.exit(0);
