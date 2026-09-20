// 小红书社区地点库导入：import/xhs-places.json → canonical_places + research_evidence
// 数据由 xhs-travel-pipeline 生成：python scripts/export_to_tripweaver.py
//
// 用法：
//   tsx apps/server/scripts/seed-xhs-places.ts            # 幂等导入（UPSERT 地点，重建语料）
//   tsx apps/server/scripts/seed-xhs-places.ts --purge    # 先清除 source='xhs' 的地点与语料再导
//
// 幂等性：
//   地点按主键 UPSERT（id 与金集同算法 sha256(city+name)[:32]，重复执行结果一致）
//   语料先按 place_id 删除旧 xhs_* 记录再插入（避免重复累积）
//
// 性能：逐条 INSERT 在远程库（Neon）上是 5000+ 次往返，耗时数十分钟。
//   这里改为按批 UNNEST 批量写入（每批 200 个地点），往返数降到十几条。
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { env } from '../src/env';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_INPUT = path.resolve(__dirname, '../../../import/xhs-places.json');
const SOURCE = 'xhs';

interface EvidenceItem {
  kind: string;
  content: string;
  sourceUrl?: string;
}

interface XhsPlaceInput {
  id: string;
  name: string;
  category: string;
  lng: number;
  lat: number;
  source?: string;
  verified?: boolean;
  payload?: Record<string, unknown>;
  evidence?: EvidenceItem[];
}

interface XhsPlacesFile {
  city: string;
  generatedAt: string;
  count: number;
  places: XhsPlaceInput[];
}

/** 每批地点数（每批 = 1 次地点 upsert + 1 次语料清理 + N 次语料插入） */
const BATCH_SIZE = 200;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** 语料确定性主键：同一条内容重复导入不产生新行 */
function evidenceId(placeId: string, item: EvidenceItem): string {
  return createHash('sha256').update(`${placeId}|${item.kind}|${item.content}`).digest('hex').slice(0, 32);
}

async function main(): Promise<void> {
  const purged = process.argv.includes('--purge');
  const inputPath = process.argv.find((a) => a.endsWith('.json')) ?? DEFAULT_INPUT;
  if (!fs.existsSync(inputPath)) {
    console.error(`[xhs-seed] 输入文件不存在：${inputPath}\n  先运行：python scripts/export_to_tripweaver.py`);
    process.exit(1);
  }
  const file = JSON.parse(fs.readFileSync(inputPath, 'utf8')) as XhsPlacesFile;
  console.log(`[xhs-seed] 输入 ${inputPath}\n  城市 ${file.city} | ${file.places.length} 个地点 | 生成于 ${file.generatedAt}`);

  const pool = new pg.Pool({ connectionString: env.databaseUrl });
  const { runMigrations } = await import('../src/db/migrate');
  await runMigrations(pool);
  const client = await pool.connect();

  let upserted = 0;
  let evidenceInserted = 0;
  let evidenceSkipped = 0;
  try {
    await client.query('BEGIN');

    if (purged) {
      const del = await client.query(`DELETE FROM canonical_places WHERE source = $1`, [SOURCE]);
      console.log(`[xhs-seed] --purge 清除旧地点 ${del.rowCount ?? 0} 条（语料随之由外键逻辑手动清）`);
      await client.query(
        `DELETE FROM research_evidence WHERE place_id NOT IN (SELECT id FROM canonical_places)`,
      );
    }

    const places = file.places.filter((p) => p.id && p.name);
    const now = new Date().toISOString();
    let processed = 0;
    let evidencePlanned = 0;

    for (const batch of chunk(places, BATCH_SIZE)) {
      // 地点 UPSERT：重复执行结果一致。
      // 关键：撞到其他 source（如金集 goldset）时**不覆盖**，只更新自家 xhs 记录，
      // 否则会把金集的 source/payload 改写掉（同类同名地点 id 相同）。
      const res = await client.query(
        `INSERT INTO canonical_places (id, city, name, category, lng, lat, source, verified, payload, created_at)
         SELECT * FROM UNNEST(
           $1::text[], $2::text[], $3::text[], $4::text[], $5::float8[], $6::float8[],
           $7::text[], $8::boolean[], $9::jsonb[], $10::timestamptz[]
         )
         ON CONFLICT (id) DO UPDATE SET
           city = EXCLUDED.city,
           name = EXCLUDED.name,
           category = EXCLUDED.category,
           lng = EXCLUDED.lng,
           lat = EXCLUDED.lat,
           source = EXCLUDED.source,
           verified = EXCLUDED.verified,
           payload = EXCLUDED.payload
         WHERE canonical_places.source = EXCLUDED.source`,
        [
          batch.map((p) => p.id),
          batch.map(() => file.city),
          batch.map((p) => p.name),
          batch.map((p) => p.category ?? ''),
          batch.map((p) => p.lng),
          batch.map((p) => p.lat),
          batch.map(() => SOURCE),
          batch.map((p) => p.verified ?? true),
          batch.map((p) => JSON.stringify(p.payload ?? {})),
          batch.map(() => now),
        ],
      );
      upserted += res.rowCount ?? 0;

      // 先清该批地点的旧语料（重建式，避免累积）
      await client.query(`DELETE FROM research_evidence WHERE place_id = ANY($1::text[]) AND kind LIKE 'xhs\\_%'`, [
        batch.map((p) => p.id),
      ]);

      const evRows: string[][] = [];
      for (const place of batch) {
        for (const item of place.evidence ?? []) {
          if (!item.content) continue;
          evRows.push([
            evidenceId(place.id, item),
            place.id,
            file.city,
            item.kind,
            item.content,
            item.sourceUrl ?? '',
            now,
          ]);
        }
      }
      evidencePlanned += evRows.length;
      for (const evBatch of chunk(evRows, BATCH_SIZE * 8)) {
        const evRes = await client.query(
          `INSERT INTO research_evidence (id, place_id, city, kind, content, source_url, fetched_at)
           SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::timestamptz[])
           ON CONFLICT (id) DO NOTHING`,
          [0, 1, 2, 3, 4, 5, 6].map((i) => evBatch.map((r) => r[i])),
        );
        evidenceInserted += evRes.rowCount ?? 0;
      }

      processed += batch.length;
      console.log(
        `[xhs-seed] 进度 ${processed}/${places.length}（地点写入 ${upserted}，语料 ${evidenceInserted}）`,
      );
    }
    evidenceSkipped = evidencePlanned - evidenceInserted;

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  const stats = await pool.query(
    `SELECT source, count(*)::int AS n FROM canonical_places GROUP BY source ORDER BY n DESC`,
  );
  const ev = await pool.query(`SELECT count(*)::int AS n FROM research_evidence`);
  console.log(
    `[xhs-seed] 完成：地点 upsert ${upserted} | 语料新增 ${evidenceInserted}（已存在跳过 ${evidenceSkipped}）`,
  );
  console.log(`  canonical_places 分布: ${stats.rows.map((r) => `${r.source}=${r.n}`).join(' | ')}`);
  console.log(`  research_evidence 总数: ${ev.rows[0]?.n ?? 0}`);
  await pool.end();
}

main().catch((err) => {
  console.error('[xhs-seed] 失败：', err);
  process.exit(1);
});
