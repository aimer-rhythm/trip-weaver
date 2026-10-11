// 只读检索质量基线：不调用 LLM / embedding / 地图，只连业务库取数并执行真实检索（vector 全程关闭）。
// npm run eval:retrieval [--out <dir>]
// node --import tsx scripts/retrieval-quality-baseline.mts
import { config } from 'dotenv';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool, type QueryResultRow } from 'pg';
import { createPlaceRetriever } from '../apps/server/src/generation/placeRetrieval';
import { canonicalPlaceId } from '../apps/server/src/lib/placeIdentity';
import { realAliases, renderRetrievalQuality, retrievalQualityReport,
  type PlaceCoverageRow, type RecallCase } from '../eval/retrievalQuality';

config({ path: 'apps/server/.env', quiet: true });
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('缺 DATABASE_URL（apps/server/.env）；本探针只接受只读业务库连接。');
  process.exit(2);
}
const depth = 8;
const database = new Pool({ connectionString, max: 2, options: '-c default_transaction_read_only=on',
  connectionTimeoutMillis: 8000, statement_timeout: 60000 });
const retrieve = createPlaceRetriever({ query: (sql, values) => database.query(sql, values), embed: async () => null });

try {
  await database.query('SELECT 1');
  // 只取统计所需字段：payload 不搬运 content 等大字段，与 placeRetrieval 的精简列一致。
  const { rows } = await database.query<PlaceCoverageRow & { has_evidence: boolean } & QueryResultRow>(
    `SELECT c.id, c.city, c.name, c.category, c.source,
       jsonb_build_object('aliases', c.payload->'aliases', 'themes', c.payload->'themes') AS payload,
       EXISTS (SELECT 1 FROM research_evidence e WHERE e.place_id = c.id) AS has_evidence
     FROM canonical_places c
     WHERE c.verified = TRUE AND c.payload->>'canonicalRedirectTo' IS NULL
     ORDER BY c.city, c.name, c.id`);
  const places: PlaceCoverageRow[] = rows.map((row) => ({ id: row.id, city: row.city, name: row.name, category: row.category,
    source: row.source, payload: row.payload, hasEvidence: row.has_evidence }));

  // 全量执行，不抽样：goldset 主名作对照组，真别名测实际可召回的同义写法。
  const queries: Array<{ city: string; query: string; expectId: string; expectName: string }> = [];
  for (const place of places) {
    // 期望值是规范实体 ID：成员行合并后返回的是根行，按行 ID 会漏判。
    const expectId = canonicalPlaceId(place);
    if (place.source === 'goldset') queries.push({ city: place.city, query: place.name, expectId, expectName: place.name });
    const alias = realAliases(place)[0];
    if (alias) queries.push({ city: place.city, query: alias, expectId, expectName: place.name });
  }

  const cases: RecallCase[] = [];
  for (const [index, item] of queries.entries()) {
    const hits = await retrieve([item.query], { city: item.city, vector: 'off', limit: depth });
    cases.push({ city: item.city, query: item.query, expectId: item.expectId, expectName: item.expectName,
      hitGroups: hits.map((hit) => [canonicalPlaceId(hit), hit.id]),
      actualNames: hits.map((hit) => hit.name) });
    if ((index + 1) % 50 === 0) process.stderr.write(`  已检索 ${index + 1}/${queries.length}\n`);
  }

  const report = retrievalQualityReport(places, cases, depth);
  console.log(renderRetrievalQuality(report));

  const outIndex = process.argv.indexOf('--out');
  if (outIndex >= 0) {
    const dir = process.argv[outIndex + 1];
    if (!dir) {
      console.error('--out 需要目录参数。');
      process.exitCode = 2;
    } else {
      // 报告内不含时间戳或耗时，同一知识库两次运行的 report.json 逐字段相等。
      await mkdir(dir, { recursive: true });
      const target = join(dir, 'report.json');
      await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      console.log(`\n报告已写入 ${target}`);
    }
  }
} catch (err) {
  console.error(`检索质量基线失败：${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await database.end();
}
