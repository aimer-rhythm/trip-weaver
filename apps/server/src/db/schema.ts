import { boolean, doublePrecision, index, integer, jsonb, pgTable, text, timestamp, vector } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),   // OAuth-only 用户为 ''（空串=禁用密码登录）
  githubId: text('github_id'),                     // GitHub 数字 id（唯一索引在 migrate 中建）
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const userSettings = pgTable('user_settings', {
  userId: text('user_id').primaryKey(),
  byokEnabled: boolean('byok_enabled').notNull().default(false),
  baseUrl: text('base_url').notNull().default(''),
  apiKeyCiphertext: text('api_key_ciphertext').notNull().default(''),
  apiKeyLast4: text('api_key_last4').notNull().default(''),
  model: text('model').notNull().default(''),
  amapApiKeyCiphertext: text('amap_api_key_ciphertext').notNull().default(''),
  amapApiKeyLast4: text('amap_api_key_last4').notNull().default(''),
  amapKeyRevision: integer('amap_key_revision').notNull().default(0),
  searchApiKeyCiphertext: text('search_api_key_ciphertext').notNull().default(''),
  searchApiKeyLast4: text('search_api_key_last4').notNull().default(''),
  searchApiBaseUrl: text('search_api_base_url').notNull().default(''),
  searchCredentialRevision: integer('search_credential_revision').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const trips = pgTable('trips', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  title: text('title').notNull(),
  destination: text('destination').notNull(),
  daysCount: integer('days_count').notNull(),
  activityCount: integer('activity_count').notNull(),
  totalCost: integer('total_cost').notNull(),
  usedXhs: boolean('used_xhs').notNull().default(false),
  data: jsonb('data').notNull(),                  // Trip 全量 JSON（唯一事实源，冗余列由其重算）
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

// 配额计数与用量核算的事实来源
export const generations = pgTable('generations', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  tripId: text('trip_id'),
  status: text('status').notNull(),               // done | error | cancelled
  usedXhs: boolean('used_xhs').notNull().default(false),   // 小红书时代旧数据；新生成恒 false
  usedByok: boolean('used_byok').notNull().default(false),
  tokensIn: integer('tokens_in').notNull().default(0),
  tokensOut: integer('tokens_out').notNull().default(0),
  xhsCalls: integer('xhs_calls').notNull().default(0),     // 小红书时代旧数据；新生成恒 0
  amapCalls: integer('amap_calls').notNull().default(0),
  searchCalls: integer('search_calls').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

// ---------- RAG 地基（09-18）：已验证地点池 + 调研语料 ----------
// embedding 列：1024 维（站点网关 cf/bge-m3；更换模型需同步 EMBEDDING_DIMS 与重建列）。
// 维度与 EMBEDDING_DIMS 对齐；变更维度需 DROP COLUMN 重建（ALTER 维度不支持原地修改）。
// 本地 PG 未装 pgvector 时列不存在（migrate 降级跳过），字段始终为 null。

export const canonicalPlaces = pgTable(
  'canonical_places',
  {
    id: text('id').primaryKey(),
    city: text('city').notNull(),
    name: text('name').notNull(),
    category: text('category').notNull().default(''),
    lng: doublePrecision('lng'),
    lat: doublePrecision('lat'),
    source: text('source').notNull(),              // goldset | amap | manual ...
    verified: boolean('verified').notNull().default(false),
    embedding: vector('embedding', { dimensions: 1024 }),
    payload: jsonb('payload'),                     // 原始记录（快照活动对象/高德 POI 等）
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('idx_canonical_places_city_verified').on(table.city, table.verified)],
);

export const researchEvidence = pgTable(
  'research_evidence',
  {
    id: text('id').primaryKey(),
    placeId: text('place_id'),                     // 可空：语料未必能挂到具体地点
    city: text('city').notNull(),
    kind: text('kind').notNull(),                  // 语料类型（攻略/点评/官方说明……）
    content: text('content').notNull(),
    sourceUrl: text('source_url').notNull().default(''),
    embedding: vector('embedding', { dimensions: 1024 }),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('idx_research_evidence_city_kind').on(table.city, table.kind)],
);

// ---------- LLM 请求上下文快照（09-20）：生成流水线每次 API 请求的完整落库 ----------
// 定位「模型不调工具/空响应」类问题的调试事实源；不含 API key（key 走 getApiKey 独立通道）。
export const llmRequestLogs = pgTable(
  'llm_request_logs',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id').notNull(),               // 内存 Job 号（非外键，Job 本身不落库）
    userId: text('user_id').notNull(),
    phase: text('phase').notNull(),                // research | plan | review
    round: integer('round').notNull().default(1),  // 编排-审校轮次（调研恒 1）
    turn: integer('turn').notNull(),               // 阶段内第几次 API 请求（从 1 开始）
    model: text('model').notNull(),
    systemPrompt: text('system_prompt').notNull(),
    messages: jsonb('messages').notNull(),         // 完整消息历史快照
    tools: jsonb('tools').notNull(),               // 完整工具定义快照
    response: jsonb('response'),                   // { stopReason, usage, errorMessage, text }
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('idx_llm_request_logs_job').on(table.jobId),
    index('idx_llm_request_logs_user_time').on(table.userId, table.createdAt),
  ],
);
