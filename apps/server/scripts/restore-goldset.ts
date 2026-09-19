// 恢复被 xhs 导入误覆盖的金集记录（source=goldset 曾被改写为 xhs）
// 场景：seed-xhs-places.ts 早期版本 UPSERT 会覆盖同类同名地点（id 相同）；
// 修复后再跑一次导入会跳过 goldset，但已覆盖的记录需要靠本脚本从 eval 快照恢复。
//
// 用法：tsx apps/server/scripts/restore-goldset.ts
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
  const { runMigrations } = await import('../src/db/migrate');
  await runMigrations(pool);
  const client = await pool.connect();
  let restored = 0;
  let checked = 0;
  try {
    await client.query('BEGIN');
    const files = fs.readdirSync(SNAPSHOT_DIR).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      const snapshot = JSON.parse(fs.readFileSync(path.join(SNAPSHOT_DIR, file), 'utf8')) as Snapshot;
      const city = snapshot.trip?.destination ?? '';
      if (!city) continue;
      for (const day of snapshot.trip?.days ?? []) {
        for (const activity of day.activities ?? []) {
          if (activity.coordSource !== 'geocoded') continue;
          if (typeof activity.lat !== 'number' || typeof activity.lng !== 'number') continue;
          const id = createHash('sha256').update(`${city}${activity.name}`).digest('hex').slice(0, 32);
          checked += 1;
          const res = await client.query(
            `UPDATE canonical_places
                SET source = 'goldset', payload = $2::jsonb, category = $3
              WHERE id = $1 AND source <> 'goldset'`,
            [id, JSON.stringify({ caseId: snapshot.caseId, activity }), activity.category ?? ''],
          );
          if ((res.rowCount ?? 0) > 0) {
            restored += 1;
            console.log(`  恢复 ${city} | ${activity.name}`);
          }
        }
      }
    }
    await client.query('COMMIT');
    console.log(`[restore] 扫描快照活动 ${checked} 条，恢复 ${restored} 条为 goldset`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  const stats = await pool.query(
    `SELECT source, count(*)::int AS n FROM canonical_places GROUP BY source ORDER BY source`,
  );
  console.log(`[restore] 分布: ${stats.rows.map((r) => `${r.source}=${r.n}`).join(' | ')}`);
  await pool.end();
}

main().catch((err) => {
  console.error('[restore] 失败：', err);
  process.exit(1);
});
