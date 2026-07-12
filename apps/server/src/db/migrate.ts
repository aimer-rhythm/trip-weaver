// 幂等建表 —— 启动时执行（KISS：本项目规模不引入 drizzle-kit 迁移链）
import type Database from 'better-sqlite3';

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    github_id TEXT,
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
    amap_api_key_ciphertext TEXT NOT NULL DEFAULT '',
    amap_api_key_last4 TEXT NOT NULL DEFAULT '',
    amap_key_revision INTEGER NOT NULL DEFAULT 0,
    search_api_key_ciphertext TEXT NOT NULL DEFAULT '',
    search_api_key_last4 TEXT NOT NULL DEFAULT '',
    search_api_base_url TEXT NOT NULL DEFAULT '',
    search_credential_revision INTEGER NOT NULL DEFAULT 0,
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
    amap_calls INTEGER NOT NULL DEFAULT 0,
    search_calls INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_generations_user_time ON generations(user_id, created_at DESC)`,
];

// 存量库加列（CREATE IF NOT EXISTS 无法给旧表补列）
function ensureColumn(sqlite: Database.Database, table: string, column: string, ddl: string): void {
  const columns = sqlite.pragma(`table_info(${table})`) as Array<{ name: string }>;
  if (!columns.some((existingColumn) => existingColumn.name === column)) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

export function runMigrations(sqlite: Database.Database): void {
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const run = sqlite.transaction(() => {
    for (const sql of STATEMENTS) sqlite.exec(sql);
    ensureColumn(sqlite, 'users', 'github_id', 'github_id TEXT');
    // SQLite 唯一索引下 NULL 互不冲突，未绑定 GitHub 的用户不受影响
    sqlite.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_github ON users(github_id)');
    // 用户级高德 Key：密文与尾号分列，revision 用于隔离自检缓存并让更新立即生效。
    ensureColumn(sqlite, 'user_settings', 'amap_api_key_ciphertext', "amap_api_key_ciphertext TEXT NOT NULL DEFAULT ''");
    ensureColumn(sqlite, 'user_settings', 'amap_api_key_last4', "amap_api_key_last4 TEXT NOT NULL DEFAULT ''");
    ensureColumn(sqlite, 'user_settings', 'amap_key_revision', 'amap_key_revision INTEGER NOT NULL DEFAULT 0');
    // 用户级 Web 搜索配置：Key 加密保存，Base URL 非敏感，revision 同时跟踪两者变更。
    ensureColumn(sqlite, 'user_settings', 'search_api_key_ciphertext', "search_api_key_ciphertext TEXT NOT NULL DEFAULT ''");
    ensureColumn(sqlite, 'user_settings', 'search_api_key_last4', "search_api_key_last4 TEXT NOT NULL DEFAULT ''");
    ensureColumn(sqlite, 'user_settings', 'search_api_base_url', "search_api_base_url TEXT NOT NULL DEFAULT ''");
    ensureColumn(sqlite, 'user_settings', 'search_credential_revision', 'search_credential_revision INTEGER NOT NULL DEFAULT 0');
    // 旧版 trips 表缺少 used_xhs；生成或导入行程时会写入该摘要列。
    ensureColumn(sqlite, 'trips', 'used_xhs', 'used_xhs INTEGER NOT NULL DEFAULT 0');
    // 旧版 generations 表可能只含任务状态；补齐当前 Drizzle schema 依赖的审计列。
    ensureColumn(sqlite, 'generations', 'used_xhs', 'used_xhs INTEGER NOT NULL DEFAULT 0');
    ensureColumn(sqlite, 'generations', 'used_byok', 'used_byok INTEGER NOT NULL DEFAULT 0');
    ensureColumn(sqlite, 'generations', 'tokens_in', 'tokens_in INTEGER NOT NULL DEFAULT 0');
    ensureColumn(sqlite, 'generations', 'tokens_out', 'tokens_out INTEGER NOT NULL DEFAULT 0');
    ensureColumn(sqlite, 'generations', 'xhs_calls', 'xhs_calls INTEGER NOT NULL DEFAULT 0');
    // 2026-07：调研数据源从小红书切换为高德 + Web 搜索，用量列泛化（xhs_calls 保留旧数据）
    ensureColumn(sqlite, 'generations', 'amap_calls', 'amap_calls INTEGER NOT NULL DEFAULT 0');
    ensureColumn(sqlite, 'generations', 'search_calls', 'search_calls INTEGER NOT NULL DEFAULT 0');
  });
  run();
}
