// 一次性数据迁移：SQLite（旧库） → PostgreSQL（DATABASE_URL）
// 用法：tsx apps/server/scripts/migrate-sqlite-to-pg.ts
// 幂等：每行按主键查重后插入（并发安全非目标——本脚本设计为停机单跑一次）。
// 转换规则：integer 0/1 → boolean；epoch ms integer → timestamptz；trips.data TEXT → jsonb parse。
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import pg from 'pg';
import { env } from '../src/env';

const dbFile = path.resolve(env.databasePath);
if (!fs.existsSync(dbFile)) {
  console.error(`[migrate] 旧 SQLite 库不存在：${dbFile}`);
  process.exit(1);
}

const sqlite = new Database(dbFile, { readonly: true });
const pool = new pg.Pool({ connectionString: env.databaseUrl });
// 目标库建表（幂等）：复用启动迁移，保证灌库前 schema 就绪
const { runMigrations } = await import('../src/db/migrate');
await runMigrations(pool);

const ms = (v: unknown): Date => new Date(Number(v));
const bool = (v: unknown): boolean => Number(v) === 1;

async function count(client: pg.PoolClient, table: string): Promise<number> {
  const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${table}`);
  return Number(rows[0]?.n ?? 0);
}

async function exists(client: pg.PoolClient, table: string, idColumn: string, id: string): Promise<boolean> {
  const { rows } = await client.query(`SELECT 1 FROM ${table} WHERE ${idColumn} = $1 LIMIT 1`, [id]);
  return rows.length > 0;
}

async function main(): Promise<void> {
  const client = await pool.connect();
  const tally: Record<string, { source: number; inserted: number }> = {};
  try {
    // users
    const users = sqlite.prepare('SELECT * FROM users').all() as Record<string, unknown>[];
    let inserted = 0;
    for (const row of users) {
      if (await exists(client, 'users', 'id', String(row.id))) continue;
      await client.query(
        `INSERT INTO users (id, email, password_hash, github_id, created_at) VALUES ($1,$2,$3,$4,$5)`,
        [row.id, row.email, row.password_hash, row.github_id ?? null, ms(row.created_at)],
      );
      inserted += 1;
    }
    tally.users = { source: users.length, inserted };

    // sessions
    const sessions = sqlite.prepare('SELECT * FROM sessions').all() as Record<string, unknown>[];
    inserted = 0;
    for (const row of sessions) {
      if (await exists(client, 'sessions', 'id', String(row.id))) continue;
      await client.query(
        `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES ($1,$2,$3,$4,$5)`,
        [row.id, row.user_id, row.token_hash, ms(row.expires_at), ms(row.created_at)],
      );
      inserted += 1;
    }
    tally.sessions = { source: sessions.length, inserted };

    // user_settings
    const settings = sqlite.prepare('SELECT * FROM user_settings').all() as Record<string, unknown>[];
    inserted = 0;
    for (const row of settings) {
      if (await exists(client, 'user_settings', 'user_id', String(row.user_id))) continue;
      await client.query(
        `INSERT INTO user_settings (
          user_id, byok_enabled, base_url, api_key_ciphertext, api_key_last4, model,
          amap_api_key_ciphertext, amap_api_key_last4, amap_key_revision,
          search_api_key_ciphertext, search_api_key_last4, search_api_base_url, search_credential_revision,
          updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          row.user_id, bool(row.byok_enabled), row.base_url ?? '', row.api_key_ciphertext ?? '', row.api_key_last4 ?? '',
          row.model ?? '', row.amap_api_key_ciphertext ?? '', row.amap_api_key_last4 ?? '', Number(row.amap_key_revision ?? 0),
          row.search_api_key_ciphertext ?? '', row.search_api_key_last4 ?? '', row.search_api_base_url ?? '',
          Number(row.search_credential_revision ?? 0), ms(row.updated_at),
        ],
      );
      inserted += 1;
    }
    tally.user_settings = { source: settings.length, inserted };

    // trips（data TEXT → jsonb）
    const trips = sqlite.prepare('SELECT * FROM trips').all() as Record<string, unknown>[];
    inserted = 0;
    for (const row of trips) {
      if (await exists(client, 'trips', 'id', String(row.id))) continue;
      await client.query(
        `INSERT INTO trips (id, user_id, title, destination, days_count, activity_count, total_cost, used_xhs, data, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)`,
        [
          row.id, row.user_id, row.title, row.destination, Number(row.days_count), Number(row.activity_count),
          Number(row.total_cost), bool(row.used_xhs), String(row.data), ms(row.created_at), ms(row.updated_at),
        ],
      );
      inserted += 1;
    }
    tally.trips = { source: trips.length, inserted };

    // generations
    const generations = sqlite.prepare('SELECT * FROM generations').all() as Record<string, unknown>[];
    inserted = 0;
    for (const row of generations) {
      if (await exists(client, 'generations', 'id', String(row.id))) continue;
      await client.query(
        `INSERT INTO generations (id, user_id, trip_id, status, used_xhs, used_byok, tokens_in, tokens_out, xhs_calls, amap_calls, search_calls, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          row.id, row.user_id, row.trip_id ?? null, row.status, bool(row.used_xhs), bool(row.used_byok),
          Number(row.tokens_in ?? 0), Number(row.tokens_out ?? 0), Number(row.xhs_calls ?? 0),
          Number(row.amap_calls ?? 0), Number(row.search_calls ?? 0), ms(row.created_at),
        ],
      );
      inserted += 1;
    }
    tally.generations = { source: generations.length, inserted };

    // 行数对账：源 vs 目标（含此前已存在的行）
    console.log('[migrate] 对账（source → 本次插入 / 目标总行数）:');
    for (const [table, stat] of Object.entries(tally)) {
      const target = await count(client, table);
      console.log(`  ${table}: ${stat.source} → +${stat.inserted} / ${target}`);
    }
  } finally {
    client.release();
    await pool.end();
    sqlite.close();
  }
}

main().catch((err) => {
  console.error('[migrate] 失败：', err);
  process.exit(1);
});
