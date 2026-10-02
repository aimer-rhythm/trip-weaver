// 只在随机创建的专用数据库中验证图库导入、读取及生成；不触碰应用数据。
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const require = createRequire(path.join(root, 'apps/server/package.json'));
const { Client } = require('pg');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(root, 'apps/server/.env'), quiet: true });
dotenv.config({ path: path.join(root, '.env'), quiet: true });
const base = new URL(process.env.DATABASE_URL ?? 'postgres://postgres@127.0.0.1:18797/postgres');
base.pathname = '/postgres';
const database = `ranked_photos_test_${Date.now()}`;
const admin = new Client({ connectionString: base.toString() });
await admin.connect();
await admin.query(`CREATE DATABASE "${database}"`);
base.pathname = `/${database}`;
let code = 1;
try {
  const child = spawn(process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=1',
    'apps/server/src/__tests__/imageImport.test.ts', 'apps/server/src/__tests__/storedCover.test.ts',
    'apps/server/src/__tests__/imageGallery.test.ts', 'apps/server/src/__tests__/placeLookup.test.ts',
    'apps/server/src/__tests__/curatedPhotos.test.ts'], {
    cwd: root, stdio: 'inherit', env: { ...process.env, DATABASE_URL: base.toString(), MASTER_KEY: 'a'.repeat(64) },
  });
  [code] = await once(child, 'exit');
} finally {
  await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
  await admin.end();
}
process.exitCode = code ?? 1;
