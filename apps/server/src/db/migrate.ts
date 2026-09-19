// 幂等建表 —— 启动时执行（KISS：本项目规模不引入 drizzle-kit 迁移链）
// PG 方言（09-18 迁移）：CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS；
// pgvector 扩展缺失时降级告警，不阻断启动（本地实例未装 pgvector 时仍可开发）。
import type { Pool } from 'pg';

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    github_id TEXT,
    created_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
  `CREATE TABLE IF NOT EXISTS user_settings (
    user_id TEXT PRIMARY KEY,
    byok_enabled BOOLEAN NOT NULL DEFAULT FALSE,
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
    updated_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS trips (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    destination TEXT NOT NULL,
    days_count INTEGER NOT NULL,
    activity_count INTEGER NOT NULL,
    total_cost INTEGER NOT NULL,
    used_xhs BOOLEAN NOT NULL DEFAULT FALSE,
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_trips_user ON trips(user_id, updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS generations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    trip_id TEXT,
    status TEXT NOT NULL,
    used_xhs BOOLEAN NOT NULL DEFAULT FALSE,
    used_byok BOOLEAN NOT NULL DEFAULT FALSE,
    tokens_in INTEGER NOT NULL DEFAULT 0,
    tokens_out INTEGER NOT NULL DEFAULT 0,
    xhs_calls INTEGER NOT NULL DEFAULT 0,
    amap_calls INTEGER NOT NULL DEFAULT 0,
    search_calls INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_generations_user_time ON generations(user_id, created_at DESC)`,
  // ---------- RAG 地基（09-18）：只建表不实现检索 ----------
  `CREATE TABLE IF NOT EXISTS canonical_places (
    id TEXT PRIMARY KEY,
    city TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '',
    lng DOUBLE PRECISION,
    lat DOUBLE PRECISION,
    source TEXT NOT NULL,
    verified BOOLEAN NOT NULL DEFAULT FALSE,
    payload JSONB,
    created_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_canonical_places_city_verified ON canonical_places(city, verified)`,
  `CREATE TABLE IF NOT EXISTS research_evidence (
    id TEXT PRIMARY KEY,
    place_id TEXT,
    city TEXT NOT NULL,
    kind TEXT NOT NULL,
    content TEXT NOT NULL,
    source_url TEXT NOT NULL DEFAULT '',
    fetched_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_research_evidence_city_kind ON research_evidence(city, kind)`,
];

export async function runMigrations(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const sql of STATEMENTS) await client.query(sql);
    // PG 唯一索引下 NULL 互不冲突，未绑定 GitHub 的用户不受影响
    await client.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_github ON users(github_id)');
    // 存量库补列（CREATE IF NOT EXISTS 无法给旧表补列）：PG 支持幂等 ADD COLUMN IF NOT EXISTS
    await client.query(`ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS amap_api_key_ciphertext TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS amap_api_key_last4 TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS amap_key_revision INTEGER NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS search_api_key_ciphertext TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS search_api_key_last4 TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS search_api_base_url TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS search_credential_revision INTEGER NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE trips ADD COLUMN IF NOT EXISTS used_xhs BOOLEAN NOT NULL DEFAULT FALSE`);
    await client.query(`ALTER TABLE generations ADD COLUMN IF NOT EXISTS used_xhs BOOLEAN NOT NULL DEFAULT FALSE`);
    await client.query(`ALTER TABLE generations ADD COLUMN IF NOT EXISTS used_byok BOOLEAN NOT NULL DEFAULT FALSE`);
    await client.query(`ALTER TABLE generations ADD COLUMN IF NOT EXISTS tokens_in INTEGER NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE generations ADD COLUMN IF NOT EXISTS tokens_out INTEGER NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE generations ADD COLUMN IF NOT EXISTS xhs_calls INTEGER NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE generations ADD COLUMN IF NOT EXISTS amap_calls INTEGER NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE generations ADD COLUMN IF NOT EXISTS search_calls INTEGER NOT NULL DEFAULT 0`);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  // pgvector 是 RAG 前置依赖；本地实例未装扩展时按降级告警处理，不阻断启动（检索能力后续任务再启用）
  let vectorAvailable = false;
  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
    vectorAvailable = true;
  } catch (err) {
    console.warn(
      `[db] pgvector 扩展不可用，RAG 向量检索暂不启用：${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // embedding 列依赖 pgvector；扩展可用时幂等补列，不可用时跳过（列保持不存在，读写路径判 null 降级）
  // 数据量 <1000 行时顺序扫描足够快，暂不建 ivfflat/hnsw 向量索引（YAGNI；索引有召回率-性能权衡，行数增长后再加）
  if (vectorAvailable) {
    await pool.query(`ALTER TABLE canonical_places ADD COLUMN IF NOT EXISTS embedding vector(1024)`);
    await pool.query(`ALTER TABLE research_evidence ADD COLUMN IF NOT EXISTS embedding vector(1024)`);
  }
}
