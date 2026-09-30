// 内置浏览器不可用时的定向验证：API 使用只读行程快照，图片走真实 Vite → Fastify。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'dotenv';
import pg from 'pg';
import { chromium } from 'playwright';

const id = '0552c0b3-6446-48b9-bf4b-9a11699ce669';
const out = path.resolve('.trellis/tasks/09-29-hangzhou-image-diagnosis/research/preview');
fs.mkdirSync(out, { recursive: true });
const client = new pg.Client({ connectionString: parse(fs.readFileSync('apps/server/.env')).DATABASE_URL });
await client.connect();
let trip;
try {
  await client.query('BEGIN READ ONLY');
  trip = (await client.query('SELECT data FROM trips WHERE id=$1', [id])).rows[0].data;
} finally { await client.query('ROLLBACK'); await client.end(); }
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (route.request().method() !== 'GET') {
      // 路线选项是 POST 查询；所有非 GET 都在本地拦截，绝不访问真实 API。
      return route.fulfill({ status: 503, json: { error: '封面验证不调用路线或写接口' } });
    }
    let data = {};
    if (url.pathname === '/api/auth/me') data = { id: 'preview', email: 'preview@example.test' };
    else if (url.pathname === `/api/trips/${id}`) data = trip;
    else if (url.pathname === `/api/trips/${id}/conversation`) data = { conversationId: null };
    else if (url.pathname === '/api/settings/config') data = { amapJsKey: '', amapJsSecurityCode: '' };
    return route.fulfill({ json: data });
  });
  await page.goto(`http://127.0.0.1:5173/trips/${id}`);
  const first = page.getByRole('img', { name: '灵隐寺', exact: true });
  await first.waitFor({ timeout: 20000 });
  await first.evaluate(img => img.decode());
  assert.ok(await first.evaluate(img => img.naturalWidth > 0));
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(out, 'day1.png') });
  await page.getByRole('group', { name: '行程天数' }).getByRole('button', { name: '第2天', exact: true }).click();
  const second = page.getByRole('img', { name: '虎跑公园', exact: true });
  await second.waitFor();
  await second.evaluate(img => img.decode());
  assert.ok(await second.evaluate(img => img.naturalWidth > 0));
  await page.screenshot({ path: path.join(out, 'day2.png') });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ localImagesDecoded: 2, pageErrors: errors, preview: out, api: 'read-only snapshot fixture', media: 'real Vite proxy' }));
} finally { await browser.close(); }
