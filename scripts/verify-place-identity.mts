// 身份/图片链路的专用验证入口：这些测试要求 DATABASE_URL 指向 place_identity_test_<timestamp>，
// 与 verify-sql-first.mts 建出的库名不兼容，所以单列一个 runner。
// node --import tsx scripts/verify-place-identity.mts
// 环境变量 VERIFY_IDENTITY_ADMIN_URL 可覆盖管理连接（默认本地 postgres）。
import { Client } from 'pg';
import { spawn } from 'node:child_process';

const databaseName = `place_identity_test_${Date.now()}`;
const adminUrl = process.env.VERIFY_IDENTITY_ADMIN_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/postgres';
const files = ['apps/server/src/__tests__/independentPhotoIdentity.test.ts'];
const admin = new Client({ connectionString: adminUrl, connectionTimeoutMillis: 5000 });
await admin.connect();
let created = false;
try {
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  created = true;
  const url = new URL(adminUrl);
  url.pathname = `/${databaseName}`;
  // 不加载应用 .env：外部能力一律置空，测试只碰隔离库。
  const env = { ...process.env, DATABASE_URL: url.toString(), MASTER_KEY: 'a'.repeat(64),
    DOTENV_CONFIG_PATH: './data/absent-verification.env',
    SITE_LLM_BASE_URL: '', SITE_LLM_API_KEY: '', SITE_LLM_MODEL: '', EMBEDDING_BASE_URL: '', EMBEDDING_API_KEY: '',
    AMAP_KEY: '', TIANDITU_KEY: '', SEARCH_API_KEY: '', PEXELS_API_KEY: '', PIXABAY_API_KEY: '', UNSPLASH_ACCESS_KEY: '',
    PHOTO_REVIEW_ENABLED: 'false' };
  const code = await new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=1', ...files], { env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (exitCode) => resolve(exitCode ?? 1));
  });
  if (code) process.exitCode = code;
} finally {
  if (created && /^place_identity_test_\d+$/.test(databaseName)) {
    await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
  }
  await admin.end();
}
