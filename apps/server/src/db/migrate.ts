// 幂等建表 —— 启动时执行（KISS：本项目规模不引入 drizzle-kit 迁移链）
import type Database from 'better-sqlite3';

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
  `CREATE TABLE IF NOT EXISTS user_settings (
    user_id TEXT PRIMARY KEY,
    byok_enabled INTEGER NOT NULL DEFAULT 0,
    base_url TEXT NOT NULL DEFAULT '',
    api_key_ciphertext TEXT NOT NULL DEFAULT '',
    api_key_last4 TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS trips (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    destination TEXT NOT NULL,
    days_count INTEGER NOT NULL,
    activity_count INTEGER NOT NULL,
    total_cost INTEGER NOT NULL,
    used_xhs INTEGER NOT NULL DEFAULT 0,
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_trips_user ON trips(user_id, updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS generations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    trip_id TEXT,
    status TEXT NOT NULL,
    used_xhs INTEGER NOT NULL DEFAULT 0,
    used_byok INTEGER NOT NULL DEFAULT 0,
    tokens_in INTEGER NOT NULL DEFAULT 0,
    tokens_out INTEGER NOT NULL DEFAULT 0,
    xhs_calls INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_generations_user_time ON generations(user_id, created_at DESC)`,
];

export function runMigrations(sqlite: Database.Database): void {
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const run = sqlite.transaction(() => {
    for (const sql of STATEMENTS) sqlite.exec(sql);
  });
  run();
}
