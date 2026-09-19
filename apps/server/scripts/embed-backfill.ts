// 回填 canonical_places / research_evidence 的 embedding 列（幂等，可重跑）
// 用法：tsx apps/server/scripts/embed-backfill.ts
// EMBEDDING_* 未配置时打印提示并退出 0（降级哲学，不视为错误）
import pg from 'pg';
import { env, hasEmbedding } from '../src/env';
import { embedTexts } from '../src/integrations/embedding';

const BATCH_SIZE = 32;

interface Row {
  id: string;
  text: string;
}

async function backfillTable(
  pool: pg.Pool,
  table: 'canonical_places' | 'research_evidence',
  buildText: (row: { [k: string]: string }) => string,
  selectCols: string,
): Promise<void> {
  let rows: (Row & { [k: string]: string })[];
  try {
    const result = await pool.query<Row & { [k: string]: string }>(
      `SELECT id, ${selectCols} FROM ${table} WHERE embedding IS NULL ORDER BY id`,
    );
    rows = result.rows;
  } catch (err) {
    // 列不存在（本地 PG 无 pgvector 扩展）时优雅跳过，不视为错误
    if (err instanceof Error && err.message.includes('embedding')) {
      console.log(`[backfill] ${table}: embedding 列不存在（pgvector 扩展未安装），跳过`);
      return;
    }
    throw err;
  }
  if (rows.length === 0) {
    console.log(`[backfill] ${table}: 无待回填行`);
    return;
  }
  console.log(`[backfill] ${table}: ${rows.length} 行待回填`);

  let updated = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const texts = batch.map(buildText);
    const vecs = await embedTexts(texts);
    for (let j = 0; j < batch.length; j++) {
      const vec = vecs[j];
      if (!vec) continue;
      await pool.query(`UPDATE ${table} SET embedding = $1 WHERE id = $2`, [
        `[${vec.join(',')}]`,
        batch[j].id,
      ]);
      updated += 1;
    }
    console.log(`[backfill] ${table}: ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}`);
  }
  console.log(`[backfill] ${table}: 完成，写入 ${updated} 行`);
}

async function main(): Promise<void> {
  if (!hasEmbedding()) {
    console.log('[backfill] EMBEDDING_* 未配置（需 baseUrl + apiKey），退出 0');
    return;
  }
  if (env.embedding.dims !== 1024) {
    console.log(`[backfill] EMBEDDING_DIMS=${env.embedding.dims} 与 schema 维度 1024 不符，退出 0`);
    return;
  }

  const pool = new pg.Pool({ connectionString: env.databaseUrl });
  try {
    await backfillTable(
      pool,
      'canonical_places',
      (r) => `${r.city} ${r.name} ${r.category}`.trim(),
      'city, name, category',
    );
    await backfillTable(
      pool,
      'research_evidence',
      (r) => `${r.kind} ${r.content}`.trim(),
      'kind, content',
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[backfill] 异常退出：', err);
  process.exit(1);
});
