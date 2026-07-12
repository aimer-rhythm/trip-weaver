// 设置页浏览器回归：保存、空白保留、更新、显式清除，以及 sources-status 缓存失效。
// 运行前先 npm run build，再执行：node scripts/verify-amap-settings-browser.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const apiPort = 18794;
const baseUrl = `http://127.0.0.1:${apiPort}`;
const databasePath = path.resolve(`apps/server/data/verify-amap-browser-${Date.now()}.db`);
const firstPersonalKey = 'browser-personal-amap-a111';
const secondPersonalKey = 'browser-personal-amap-a222';
const failures = [];

function check(name, condition, detail = '') {
  console.log(`${condition ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures.push(name);
}

const server = spawn(process.execPath, ['../../node_modules/tsx/dist/cli.mjs', 'src/index.ts'], {
  cwd: 'apps/server',
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(apiPort),
    DATABASE_PATH: databasePath,
    MASTER_KEY: crypto.randomBytes(32).toString('hex'),
    REGISTRATION_MODE: 'open',
    AMAP_KEY: 'browser-site-amap-key',
    SEARCH_API_KEY: '',
  },
});

let serverLog = '';
server.stdout.on('data', (chunk) => (serverLog += String(chunk)));
server.stderr.on('data', (chunk) => (serverLog += String(chunk)));

let browser;
try {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) break;
    } catch {}
    await sleep(250);
    if (attempt === 119) throw new Error('服务端启动超时');
  }

  browser = await chromium.launch({ args: ['--no-proxy-server'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  let sourceStatusRequests = 0;
  await page.route('**/api/settings/sources-status', async (route) => {
    sourceStatusRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        amap: { configured: true, checked: true, ok: true, message: '测试高德连接正常' },
        websearch: { configured: false, checked: true, ok: null, message: '测试搜索未配置' },
      }),
    });
  });

  await page.goto(`${baseUrl}/register`, { waitUntil: 'networkidle' });
  await page.getByLabel('邮箱').fill(`amap-browser-${Date.now()}@test.dev`);
  await page.getByLabel('密码（至少 8 位）').fill('password123');
  await page.getByLabel('确认密码').fill('password123');
  await page.getByRole('button', { name: '注册并登录' }).click();
  await page.waitForURL('**/trips', { timeout: 10_000 });

  await page.getByRole('button', { name: '设置' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('summary').click();
  await page.waitForResponse('**/api/settings/sources-status');
  check('展开高级设置后探测数据源', sourceStatusRequests === 1);

  const amapInput = dialog.getByLabel('高德 Web 服务 Key');
  await amapInput.fill(firstPersonalKey);
  await dialog.getByRole('button', { name: '保存' }).click();
  await dialog.getByText('已保存', { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('dialog')?.textContent?.includes('个人 Key（尾号 a111）'));
  check('设置页保存个人 Key 并仅显示尾号', (await dialog.innerText()).includes('个人 Key（尾号 a111）'));
  check('保存后使数据源状态查询失效并重新探测', sourceStatusRequests >= 2, `requests=${sourceStatusRequests}`);

  const savedSettings = await page.evaluate(async () => (await fetch('/api/settings')).json());
  const savedSettingsJson = JSON.stringify(savedSettings);
  check(
    '浏览器 API 响应不含个人 Key 明文或密文',
    savedSettings.hasPersonalAmapKey === true &&
      savedSettings.amapApiKeyLast4 === 'a111' &&
      !savedSettingsJson.includes(firstPersonalKey) &&
      !savedSettingsJson.includes('ciphertext'),
  );

  await dialog.getByRole('button', { name: '保存' }).click();
  await page.waitForTimeout(200);
  const preservedSettings = await page.evaluate(async () => (await fetch('/api/settings')).json());
  check('普通空输入提交保留个人 Key', preservedSettings.hasPersonalAmapKey && preservedSettings.amapApiKeyLast4 === 'a111');

  await amapInput.fill(secondPersonalKey);
  await dialog.getByRole('button', { name: '保存' }).click();
  await page.waitForFunction(() => document.querySelector('dialog')?.textContent?.includes('个人 Key（尾号 a222）'));
  check('设置页支持更新个人 Key', (await dialog.innerText()).includes('个人 Key（尾号 a222）'));

  await dialog.getByLabel(/清除已保存的个人高德 Key/).check();
  await dialog.getByRole('button', { name: '保存' }).click();
  await page.waitForFunction(() => document.querySelector('dialog')?.textContent?.includes('当前高德配置：站点默认 Key'));
  const clearedSettings = await page.evaluate(async () => (await fetch('/api/settings')).json());
  check(
    '显式清除后恢复站点默认 Key',
    clearedSettings.hasPersonalAmapKey === false &&
      clearedSettings.amapApiKeyLast4 === '' &&
      clearedSettings.hasSiteAmapKey === true,
  );
  check('个人高德 Key 不见于服务端日志', !serverLog.includes(firstPersonalKey) && !serverLog.includes(secondPersonalKey));

  console.log(failures.length ? `\nFAIL：${failures.length} 项未过` : '\nPASS —— 设置页高德 Key 浏览器回归全过');
} catch (error) {
  console.error('\n[verify-amap-settings-browser] 异常终止：', error);
  failures.push('脚本异常');
} finally {
  await browser?.close();
  server.kill();
  await sleep(500);
  for (const suffix of ['', '-shm', '-wal']) {
    rmSync(`${databasePath}${suffix}`, { force: true });
  }
}

process.exit(failures.length ? 1 : 0);
