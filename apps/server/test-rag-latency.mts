// RAG 检索延迟探针：编排前的那次 retrieveContext 到底花多久（阶段间空白的主嫌疑）
// 用法（apps/server 目录）：npx tsx test-rag-latency.mts
import 'dotenv/config';
import { retrieveContext } from './src/generation/retrieveContext';
import { hasEmbedding, env } from './src/env';

const names = ['故宫博物院', '景山公园', '什刹海', '天坛公园', '颐和园'];
console.log(`hasEmbedding=${hasEmbedding()} dims=${env.embedding.dims}`);

for (let i = 0; i < 3; i++) {
  const start = performance.now();
  const places = await retrieveContext(names, { city: '北京' });
  console.log(`第${i + 1}次 retrieveContext: ${(performance.now() - start).toFixed(0)}ms，命中 ${places.length} 个`);
}

// 拆出向量层本身（embedding HTTP）的耗时，区分「PG 慢」与「embedding 慢」
const { embedTexts } = await import('./src/integrations/embedding');
for (let i = 0; i < 2; i++) {
  const start = performance.now();
  const vecs = await embedTexts([names.join(' ')]);
  console.log(`第${i + 1}次 embedTexts: ${(performance.now() - start).toFixed(0)}ms，维度 ${vecs[0]?.length ?? 'null'}`);
}
process.exit(0);
