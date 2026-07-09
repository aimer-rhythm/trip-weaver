import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),   // OAuth-only 用户为 ''（空串=禁用密码登录）
  githubId: text('github_id'),                     // GitHub 数字 id（唯一索引在 migrate 中建）
  createdAt: integer('created_at').notNull(),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: integer('expires_at').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const userSettings = sqliteTable('user_settings', {
  userId: text('user_id').primaryKey(),
  byokEnabled: integer('byok_enabled').notNull().default(0),
  baseUrl: text('base_url').notNull().default(''),
  apiKeyCiphertext: text('api_key_ciphertext').notNull().default(''),
  apiKeyLast4: text('api_key_last4').notNull().default(''),
  model: text('model').notNull().default(''),
  updatedAt: integer('updated_at').notNull(),
});

export const trips = sqliteTable('trips', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  title: text('title').notNull(),
  destination: text('destination').notNull(),
  daysCount: integer('days_count').notNull(),
  activityCount: integer('activity_count').notNull(),
  totalCost: integer('total_cost').notNull(),
  usedXhs: integer('used_xhs').notNull().default(0),
  data: text('data').notNull(),                 // Trip 全量 JSON（唯一事实源，冗余列由其重算）
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

// 配额计数与用量核算的事实来源
export const generations = sqliteTable('generations', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  tripId: text('trip_id'),
  status: text('status').notNull(),             // done | error | cancelled
  usedXhs: integer('used_xhs').notNull().default(0),     // 小红书时代旧数据；新生成恒 0
  usedByok: integer('used_byok').notNull().default(0),
  tokensIn: integer('tokens_in').notNull().default(0),
  tokensOut: integer('tokens_out').notNull().default(0),
  xhsCalls: integer('xhs_calls').notNull().default(0),   // 小红书时代旧数据；新生成恒 0
  amapCalls: integer('amap_calls').notNull().default(0),
  searchCalls: integer('search_calls').notNull().default(0),
  createdAt: integer('created_at').notNull(),
});
