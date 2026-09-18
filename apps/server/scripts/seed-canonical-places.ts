// 金集 POI 回填：eval/snapshots/*.json 中已 geocoded 的活动 → canonical_places（verified=true, source='goldset'）
// 用法：tsx apps/server/scripts/seed-canonical-places.ts
// 幂等：id 由 city+name 派生，重复执行按主键查重跳过。
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { env } from '../src/env';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DIR = path.resolve(__dirname, '../../../eval/snapshots');

interface SnapshotActivity {
  name: string;
  category?: string;
  lat?: number;
  lng?: number;
  coordSource?: string;
}
interface Snapshot {
  caseId: string;
  trip?: { destination?: string; days?: { activities?: SnapshotActivity[] }[] };
}

async function main(): Promise<void> {
  const pool = new pg.Pool({ connectionString: env.databaseUrl });
  // 目标表建表（幂等）：复用启动迁移，保证回填前 schema 就绪
  const { runMigrations } = await import('../src/db/migrate');
  await runMigrations(pool);
  const client = await pool.connect();
  let scanned = 0;
  let inserted = 0;
  try {
    const files = fs.readdirSync(SNAPSHOT_DIR).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      const snapshot = JSON.parse(fs.readFileSync(path.join(SNAPSHOT_DIR, file), 'utf8')) as Snapshot;
      const city = snapshot.trip?.destination ?? '';
      if (!city) continue;
      for (const day of snapshot.trip?.days ?? []) {
        for (const activity of day.activities ?? []) {
          // 只采纳真实坐标（geocoded）；降级/缺省坐标不入可信地点池
          if (activity.coordSource !== 'geocoded' || typeof activity.lat !== 'number' || typeof activity.lng !== 'number') continue;
          scanned += 1;
          const id = createHash('sha256').update(`${city}${activity.name}`).digest('hex').slice(0, 32);
          const { rows } = await client.query('SELECT 1 FROM canonical_places WHERE id = $1 LIMIT 1', [id]);
          if (rows.length > 0) continue;
          await client.query(
            `INSERT INTO canonical_places (id, city, name, category, lng, lat, source, verified, payload, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,'goldset',TRUE,$7::jsonb,$8)`,
            [
              id, city, activity.name, activity.category ?? '', activity.lng, activity.lat,
              JSON.stringify({ caseId: snapshot.caseId, activity }),
              new Date(),
            ],
          );
          inserted += 1;
        }
      }
    }
    const { rows } = await client.query('SELECT count(*)::int AS n FROM canonical_places WHERE verified');
    console.log(`[seed] 快照 ${files.length} 份，扫描已定位活动 ${scanned} 条，本次插入 ${inserted} 条，verified 总数 ${rows[0]?.n ?? 0}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[seed] 失败：', err);
  process.exit(1);
});
