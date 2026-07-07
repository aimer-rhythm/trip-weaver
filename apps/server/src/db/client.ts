import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { env } from '../env';
import { runMigrations } from './migrate';
import * as schema from './schema';

const dbFile = path.resolve(env.databasePath);
fs.mkdirSync(path.dirname(dbFile), { recursive: true });

export const sqlite = new Database(dbFile);
runMigrations(sqlite);

export const db = drizzle(sqlite, { schema });
