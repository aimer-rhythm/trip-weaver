import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { env } from '../env';
import { runMigrations } from './migrate';
import * as schema from './schema';

export const pool = new Pool({ connectionString: env.databaseUrl });

// 顶层 await：模块导入即完成建库与迁移（ESM + tsx 支持，index.ts 依赖该副作用）
await runMigrations(pool);

export const db = drizzle(pool, { schema });
