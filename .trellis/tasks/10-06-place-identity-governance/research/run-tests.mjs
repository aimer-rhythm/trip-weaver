import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { Client } from 'pg';
const adminUrl = process.env.VERIFY_GENERATION_ADMIN_URL ?? 'postgres://postgres@127.0.0.1:18798/postgres';
const database = `place_identity_test_${Date.now()}`;
const url = new URL(adminUrl);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('测试只允许使用本地 PostgreSQL');
url.pathname = `/${database}`;
const admin = new Client({ connectionString: adminUrl, connectionTimeoutMillis: 8000 });
await admin.connect();
await admin.query(`CREATE DATABASE "${database}"`);
let code = 1;
try {
  const paths = process.argv.slice(2);
  const logName=`downstream-${database}.log`;
  const output = fs.createWriteStream(new URL(logName, import.meta.url),{flags:'wx'});
  const child = spawn(process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=1', ...paths], {
    env: { ...process.env, DATABASE_URL: url.toString(), MASTER_KEY: 'a'.repeat(64),
      DOTENV_CONFIG_PATH: './data/place-identity-nonexistent.env', AMAP_KEY: '', TIANDITU_KEY: '',
      SITE_LLM_BASE_URL: '', SITE_LLM_API_KEY: '', SITE_LLM_MODEL: '', SEARCH_API_KEY: '', SEARCH_API_BASE_URL: '',
      PEXELS_API_KEY: '', EMBEDDING_API_KEY: '', EMBEDDING_BASE_URL: '' },
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(output, { end: false }); child.stderr.pipe(output, { end: false });
  child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
  code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  await new Promise(resolve => output.end(resolve));
  console.log(JSON.stringify({log:logName,exitCode:code}));
} finally {
  if (!/^place_identity_test_\d+$/.test(database)) throw new Error('测试库名称校验失败');
  await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
  await admin.end();
}
process.exitCode = code ?? 1;
