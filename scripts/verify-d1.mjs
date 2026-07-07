// D1 浏览器验收：长图/JSON/打印 + 跨账号导入还原 + 坏文件报错（PRD F5）
// 运行：node scripts/verify-d1.mjs（需先 npm run build）
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import crypto from 'node:crypto';

const API_PORT = 18791;
const BASE = `http://127.0.0.1:${API_PORT}`;
const DB_FILE = `./data/verify-d1-${Date.now()}.db`;
const SHOTS = 'verify-shots';
const TMP = 'verify-shots/tmp-d1';

const results = [];
let failed = 0;
function check(name, ok, detail = '') {
  results.push(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
}

if (!existsSync('apps/web/dist/index.html')) {
  console.error('缺少 apps/web/dist，请先 npm run build');
  process.exit(2);
}
mkdirSync(TMP, { recursive: true });

const server = spawn(process.execPath, ['../../node_modules/tsx/dist/cli.mjs', 'src/index.ts'], {
  cwd: 'apps/server',
  stdio: ['ignore', 'ignore', 'pipe'],
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(API_PORT),
    DATABASE_PATH: DB_FILE,
    MASTER_KEY: crypto.randomBytes(32).toString('hex'),
    INVITE_CODE: 'D1TEST',
    GEN_DAILY_LIMIT: '3',
    XHS_MCP_URL: '',
    NO_PROXY: 'localhost,127.0.0.1',
  },
});
server.stderr.on('data', (d) => process.env.VERBOSE && console.error(String(d)));

async function register(page, email) {
  await page.goto(`${BASE}/register`, { waitUntil: 'networkidle' });
  await page.getByLabel('邮箱').fill(email);
  await page.getByLabel('密码（至少 8 位）').fill('password123');
  await page.getByLabel('确认密码').fill('password123');
  await page.getByLabel('邀请码').fill('D1TEST');
  await page.getByRole('button', { name: '注册并登录' }).click();
  await page.waitForURL('**/trips', { timeout: 10_000 });
}

const browser = await chromium.launch({ args: ['--no-proxy-server'] });
try {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await sleep(500);
    if (i === 119) throw new Error('服务端启动超时');
  }

  // —— 用户 A：示例行程 + 三件套导出 ——
  const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pageA = await ctxA.newPage();
  await register(pageA, `d1a-${Date.now()}@test.dev`);
  await pageA.getByRole('button', { name: '加载示例行程' }).click();
  await pageA.waitForSelector('.day-section', { timeout: 10_000 });

  // 1. JSON 导出（编辑器）
  await pageA.locator('.export-menu summary').click();
  const [jsonDl] = await Promise.all([
    pageA.waitForEvent('download', { timeout: 15_000 }),
    pageA.getByRole('button', { name: /JSON 备份/ }).click(),
  ]);
  const jsonPath = `${TMP}/export.json`;
  await jsonDl.saveAs(jsonPath);
  const exported = JSON.parse(readFileSync(jsonPath, 'utf8'));
  check('JSON 导出：version=2 且 3 天', exported.version === 2 && exported.trip?.days?.length === 3, `version=${exported.version}, days=${exported.trip?.days?.length}`);
  const exportedActivityCount = exported.trip.days.reduce((n, d) => n + d.activities.length, 0);

  // 2. 长图 PNG 导出
  await pageA.locator('.export-menu summary').click();
  const [pngDl] = await Promise.all([
    pageA.waitForEvent('download', { timeout: 30_000 }),
    pageA.getByRole('button', { name: /长图 PNG/ }).click(),
  ]);
  const pngPath = `${TMP}/export.png`;
  await pngDl.saveAs(pngPath);
  const pngSize = statSync(pngPath).size;
  check('长图 PNG 导出（2x）', pngDl.suggestedFilename().endsWith('.png') && pngSize > 50_000, `${pngDl.suggestedFilename()}，${Math.round(pngSize / 1024)}KB`);

  // 3. 打印媒介：只显示 PrintView
  await pageA.emulateMedia({ media: 'print' });
  const pvVisible = await pageA.locator('.pv').first().evaluate((el) => getComputedStyle(el).visibility === 'visible');
  const toolbarHidden = await pageA.locator('.editor-toolbar').evaluate((el) => getComputedStyle(el).visibility === 'hidden');
  check('打印视图：PrintView 可见且应用壳隐藏', pvVisible && toolbarHidden, `pv=${pvVisible}, toolbarHidden=${toolbarHidden}`);
  await pageA.emulateMedia({ media: 'screen' });
  await pageA.screenshot({ path: `${SHOTS}/15-export-menu.png` });

  // 4. 列表页导出按钮
  await pageA.goto(`${BASE}/trips`, { waitUntil: 'networkidle' });
  const [listDl] = await Promise.all([
    pageA.waitForEvent('download', { timeout: 15_000 }),
    pageA.locator('.trip-card').first().getByRole('button', { name: '导出' }).click(),
  ]);
  check('列表卡片可导出 JSON', listDl.suggestedFilename().endsWith('.json'));

  // —— 用户 B：跨账号导入 100% 还原 ——
  const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pageB = await ctxB.newPage();
  await register(pageB, `d1b-${Date.now()}@test.dev`);
  const [chooser] = await Promise.all([
    pageB.waitForEvent('filechooser'),
    pageB.getByRole('button', { name: '导入 JSON' }).click(),
  ]);
  await chooser.setFiles(jsonPath);
  await pageB.waitForURL(/\/trips\/(?!new)[^/]+$/, { timeout: 10_000 });
  await pageB.waitForSelector('.day-section', { timeout: 10_000 });
  const importedDays = await pageB.locator('.day-section').count();
  const importedActs = await pageB.locator('.activity-card').count();
  const importedTitle = await pageB.locator('.editor-title h1').innerText();
  check(
    '跨账号导入还原（天数/活动数/标题）',
    importedDays === 3 && importedActs === exportedActivityCount && importedTitle === exported.trip.title,
    `days=${importedDays}, acts=${importedActs}/${exportedActivityCount}, title=${importedTitle}`,
  );

  // 5. 坏文件导入明确报错
  const badPath = `${TMP}/bad.json`;
  writeFileSync(badPath, '{"version":99,"trip":{"oops":true}}');
  await pageB.goto(`${BASE}/trips`, { waitUntil: 'networkidle' });
  let dialogMsg = '';
  pageB.once('dialog', (d) => {
    dialogMsg = d.message();
    void d.accept();
  });
  const [chooser2] = await Promise.all([
    pageB.waitForEvent('filechooser'),
    pageB.getByRole('button', { name: '导入 JSON' }).click(),
  ]);
  await chooser2.setFiles(badPath);
  await sleep(1500);
  check('坏文件导入明确报错', dialogMsg.includes('导入失败'), dialogMsg.slice(0, 80));

  await ctxA.close();
  await ctxB.close();
} catch (err) {
  check('脚本执行中断', false, String(err).slice(0, 300));
} finally {
  await browser.close();
  server.kill();
  await sleep(800);
  for (const suffix of ['', '-shm', '-wal']) {
    try {
      rmSync(`apps/server/${DB_FILE.replace('./', '')}${suffix}`, { force: true });
    } catch {}
  }
  rmSync(TMP, { recursive: true, force: true });
}

console.log('\n===== D1 浏览器验收结果 =====');
for (const r of results) console.log(r);
console.log(`===== ${results.length - failed}/${results.length} 通过 =====`);
process.exit(failed ? 1 : 0);
