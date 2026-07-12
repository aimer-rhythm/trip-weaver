// 设置页 Web 搜索回归：默认 URL、空白保留、更新、显式清除及状态刷新。
// 运行前先 npm run build，再执行：node scripts/verify-websearch-settings-browser.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const apiPort = 18795;
const baseUrl = `http://127.0.0.1:${apiPort}`;
const databasePath = path.resolve(`apps/server/data/verify-websearch-browser-${Date.now()}.db`);
const firstPersonalKey = 'browser-personal-search-a111';
const secondPersonalKey = 'browser-personal-search-a222';
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
    AMAP_KEY: '',
    SEARCH_API_KEY: 'browser-site-search-key',
    SEARCH_API_BASE_URL: 'https://site-search.test',
    SSRF_ALLOWLIST: 'api.langsearch.com',
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
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  let sourceStatusRequests = 0;
  await page.route('**/api/settings/sources-status', async (route) => {
    sourceStatusRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        amap: { configured: false, checked: true, ok: null, message: '测试高德未配置' },
        websearch: { configured: true, checked: true, ok: true, message: '测试搜索连接正常' },
      }),
    });
  });

  await page.goto(`${baseUrl}/register`, { waitUntil: 'networkidle' });
  await page.getByLabel('邮箱').fill(`websearch-browser-${Date.now()}@test.dev`);
  await page.getByLabel('密码（至少 8 位）').fill('password123');
  await page.getByLabel('确认密码').fill('password123');
  await page.getByRole('button', { name: '注册并登录' }).click();
  await page.waitForURL('**/trips', { timeout: 10_000 });

  await page.getByRole('button', { name: '设置' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('summary').click();
  await page.waitForResponse('**/api/settings/sources-status');
  check('展开高级设置后探测数据源', sourceStatusRequests === 1);

  const searchKeyInput = dialog.getByLabel('Web 搜索 API Key');
  const searchBaseUrlInput = dialog.getByLabel('Web 搜索 Base URL');
  await searchKeyInput.fill(firstPersonalKey);
  await dialog.getByRole('button', { name: '保存' }).click();
  await dialog.getByText('已保存', { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('dialog')?.textContent?.includes('Key 尾号 a111'));
  check('新个人搜索配置空 URL 使用默认值并仅显示尾号', (await dialog.innerText()).includes('https://api.langsearch.com'));
  check('保存后使数据源状态查询失效并重新探测', sourceStatusRequests >= 2, `requests=${sourceStatusRequests}`);

  const savedSettings = await page.evaluate(async () => (await fetch('/api/settings')).json());
  const savedSettingsJson = JSON.stringify(savedSettings);
  check(
    '浏览器 API 响应不含搜索 Key 明文或密文',
    savedSettings.hasPersonalSearchKey === true &&
      savedSettings.searchApiKeyLast4 === 'a111' &&
      savedSettings.searchApiBaseUrl === 'https://api.langsearch.com' &&
      !savedSettingsJson.includes(firstPersonalKey) &&
      !savedSettingsJson.includes('ciphertext'),
  );

  await dialog.getByRole('button', { name: '保存' }).click();
  await page.waitForTimeout(200);
  const preservedSettings = await page.evaluate(async () => (await fetch('/api/settings')).json());
  check('普通空 Key 提交保留个人搜索配置', preservedSettings.searchApiKeyLast4 === 'a111');

  await searchBaseUrlInput.fill('https://api.langsearch.com/compatible');
  await dialog.getByRole('button', { name: '保存' }).click();
  await page.waitForFunction(() => document.querySelector('dialog')?.textContent?.includes('api.langsearch.com/compatible'));
  check('设置页支持仅更新个人搜索 Base URL', (await dialog.innerText()).includes('api.langsearch.com/compatible'));

  await searchKeyInput.fill(secondPersonalKey);
  await dialog.getByRole('button', { name: '保存' }).click();
  await page.waitForFunction(() => document.querySelector('dialog')?.textContent?.includes('Key 尾号 a222'));
  check('设置页支持更新个人搜索 Key', (await dialog.innerText()).includes('Key 尾号 a222'));

  await dialog.getByLabel(/清除已保存的个人 Web 搜索 Key 与 Base URL/).check();
  await dialog.getByRole('button', { name: '保存' }).click();
  await page.waitForFunction(() => document.querySelector('dialog')?.textContent?.includes('当前 Web 搜索配置：站点默认配置'));
  const clearedSettings = await page.evaluate(async () => (await fetch('/api/settings')).json());
  check(
    '显式清除同时删除个人 Key 与 Base URL并恢复站点配置',
    clearedSettings.hasPersonalSearchKey === false &&
      clearedSettings.searchApiKeyLast4 === '' &&
      clearedSettings.searchApiBaseUrl === '' &&
      clearedSettings.hasSiteSearchKey === true,
  );
  check('个人搜索 Key 不见于服务端日志', !serverLog.includes(firstPersonalKey) && !serverLog.includes(secondPersonalKey));

  console.log(failures.length ? `\nFAIL：${failures.length} 项未过` : '\nPASS —— 设置页 Web 搜索配置浏览器回归全过');
} catch (error) {
  console.error('\n[verify-websearch-settings-browser] 异常终止：', error);
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
