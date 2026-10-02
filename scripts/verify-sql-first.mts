// 使用全新专用 PostgreSQL 数据库；不加载应用 .env、不访问真实模型。
// node --import tsx scripts/verify-sql-first.mts [--full]
import { Client } from 'pg';
import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';

const databaseName = `tripweaver_verify_retrieval_${Date.now()}`;
const adminUrl = process.env.VERIFY_GENERATION_ADMIN_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/postgres';
const url = new URL(adminUrl);
url.pathname = `/${databaseName}`;
const admin = new Client({ connectionString: adminUrl });
await admin.connect();
let created = false;
try {
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  created = true;
  const folder = 'apps/server/src/__tests__';
  const files = process.argv.includes('--full') ? (await readdir(folder)).filter((name) => name.endsWith('.test.ts')).sort()
    : ['placeRetrieval.test.ts', 'placeImportIdentity.test.ts', 'queryEmbedding.test.ts', 'researchSubmission.test.ts', 'researchQuality.test.ts', 'routeOrder.test.ts', 'routeCoherence.test.ts', 'scheduling.test.ts', 'generationModel.test.ts', 'titleFont.test.ts', 'prompts.test.ts', 'generationPerformance.test.ts'];
  const env = { ...process.env, DATABASE_URL: url.toString(), MASTER_KEY: 'a'.repeat(64),
    DOTENV_CONFIG_PATH: './data/absent-verification.env',
    SITE_LLM_BASE_URL: '', SITE_LLM_API_KEY: '', SITE_LLM_MODEL: '', EMBEDDING_BASE_URL: '', EMBEDDING_API_KEY: '',
    AMAP_KEY: '', TIANDITU_KEY: '', SEARCH_API_KEY: '', PEXELS_API_KEY: '', PIXABAY_API_KEY: '', UNSPLASH_ACCESS_KEY: '',
    PHOTO_REVIEW_ENABLED: 'false', GITHUB_CLIENT_ID: '', GITHUB_CLIENT_SECRET: '', REGISTRATION_MODE: 'open' };
  const code = await new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=1', ...files.map((name) => `${folder}/${name}`)], { env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (exitCode) => resolve(exitCode ?? 1));
  });
  if (code) process.exitCode = code;
} finally {
  if (created && /^tripweaver_verify_retrieval_\d+$/.test(databaseName)) {
    await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
  }
  await admin.end();
}
