// Playwright timing smoke：使用隔离 mock LLM 生成一次当前表单支持的行程，
// 读取页面服务端权威耗时，输出阶段/工具排序报告。
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import crypto from 'node:crypto';
import { startMockLlm } from './lib/mock-llm.mjs';

const MOCK_PORT = 18788;
const API_PORT = 18792;
const BASE = `http://127.0.0.1:${API_PORT}`;
const DB_FILE = `./data/verify-generation-timing-${Date.now()}.db`;

if (!existsSync('apps/web/dist/index.html')) {
  console.error('缺少 apps/web/dist，请先 npm run build');
  process.exit(2);
}

const mock = await startMockLlm(MOCK_PORT, { delayMs: 400, geocodedActivities: true, includeLodging: false });
const server = spawn(process.execPath, ['../../node_modules/tsx/dist/cli.mjs', 'src/index.ts'], {
  cwd: 'apps/server',
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(API_PORT),
    DATABASE_PATH: DB_FILE,
    MASTER_KEY: crypto.randomBytes(32).toString('hex'),
    REGISTRATION_MODE: 'invite',
    INVITE_CODE: 'TIMINGTEST',
    SITE_LLM_BASE_URL: `http://127.0.0.1:${MOCK_PORT}/v1`,
    SITE_LLM_API_KEY: 'site-mock-key',
    SITE_LLM_MODEL: 'mock-chat',
    AMAP_KEY: '',
    SEARCH_API_KEY: '',
    GEN_DAILY_LIMIT: '3',
    SSRF_ALLOWLIST: `127.0.0.1:${MOCK_PORT}`,
    NO_PROXY: 'localhost,127.0.0.1',
  },
});
let serverOutput = '';
server.stdout.on('data', (data) => {
  serverOutput += String(data);
});
server.stderr.on('data', (data) => process.env.VERBOSE && process.stderr.write(data));

const browser = await chromium.launch({ args: ['--no-proxy-server'] });
try {
  for (let i = 0; i < 120; i += 1) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await sleep(250);
    if (i === 119) throw new Error('服务端启动超时');
  }

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/register`, { waitUntil: 'networkidle' });
  await page.getByLabel('邮箱').fill(`timing-${Date.now()}@test.dev`);
  await page.getByLabel('密码（至少 8 位）').fill('password123');
  await page.getByLabel('确认密码').fill('password123');
  await page.getByLabel('邀请码').fill('TIMINGTEST');
  await page.getByRole('button', { name: '注册并登录' }).click();
  await page.waitForURL('**/trips', { timeout: 10_000 });

  await page.goto(`${BASE}/trips/new`, { waitUntil: 'networkidle' });
  await page.getByLabel('目的地 *').fill('东京');
  await page.getByLabel(/天数/).fill('2');
  await page.getByRole('button', { name: /开始生成/ }).click();
  await page.waitForSelector('.gen-phase', { timeout: 15_000 });
  await page.waitForSelector('.gen-result-ok', { timeout: 120_000 });

  const phases = await page.locator('.gen-phase-head').evaluateAll((nodes) => nodes.map((node) => node.textContent?.replace(/\s+/g, ' ').trim() ?? ''));
  const tools = await page.locator('.gen-tool-label').evaluateAll((nodes) => nodes.map((node) => node.textContent?.replace(/\s+/g, ' ').trim() ?? ''));
  const footer = await page.locator('.gen-foot').innerText();
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileLayout = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    timelineWidth: Math.round(document.querySelector('.gen-timeline')?.getBoundingClientRect().width ?? 0),
  }));
  const result = { url: page.url(), phases, tools, footer, mobileLayout };
  console.log(JSON.stringify(result, null, 2));
  const timingLogs = serverOutput.split(/\r?\n/).filter((line) => line.includes('generation timing summary'));
  if (timingLogs.length) console.log(`SERVER_TIMING ${timingLogs.at(-1)}`);

  if (phases.length < 3 || !phases.every((phase) => /\d+(?:\.\d+)? 秒|\d+ 分/.test(phase))) {
    throw new Error(`阶段耗时缺失：${JSON.stringify(phases)}`);
  }
  if (!/总耗时 \d+(?:\.\d+)? 秒|总耗时 \d+ 分/.test(footer)) {
    throw new Error(`总耗时缺失：${footer}`);
  }
  if (!tools.some((tool) => /\d+(?:\.\d+)? 秒|\d+ 分/.test(tool))) {
    throw new Error(`工具耗时缺失：${JSON.stringify(tools)}`);
  }
  if (mobileLayout.documentWidth > mobileLayout.viewportWidth) {
    throw new Error(`移动端发生横向溢出：${JSON.stringify(mobileLayout)}`);
  }
  await context.close();
} finally {
  await browser.close();
  mock.close();
  server.kill();
  try {
    rmSync(DB_FILE, { force: true });
  } catch {}
}
