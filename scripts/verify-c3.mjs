// C3 浏览器自动化验收：生成表单 → SSE 时间线三阶段 → 完成跳编辑器 → 刷新恢复 → 取消 → 配额文案
// 走生产模式静态托管（同源 SSE），mock LLM 驱动。运行：node scripts/verify-c3.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import crypto from 'node:crypto';
import { startMockLlm } from './lib/mock-llm.mjs';

const MOCK_PORT = 18788;
const API_PORT = 18791;
const BASE = `http://127.0.0.1:${API_PORT}`;
const DB_FILE = `./data/verify-c3-${Date.now()}.db`;
const SHOTS = 'verify-shots';

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

const mock = await startMockLlm(MOCK_PORT, { delayMs: 400 });
const server = spawn(process.execPath, ['../../node_modules/tsx/dist/cli.mjs', 'src/index.ts'], {
  cwd: 'apps/server',
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(API_PORT),
    DATABASE_PATH: DB_FILE,
    MASTER_KEY: crypto.randomBytes(32).toString('hex'),
    INVITE_CODE: 'C3TEST',
    SITE_LLM_BASE_URL: `http://127.0.0.1:${MOCK_PORT}/v1`,
    SITE_LLM_API_KEY: 'site-mock-key',
    SITE_LLM_MODEL: 'mock-chat',
    GEN_DAILY_LIMIT: '3',
    XHS_MCP_URL: '',
    SSRF_ALLOWLIST: `127.0.0.1:${MOCK_PORT}`,
    NO_PROXY: 'localhost,127.0.0.1',
  },
});
server.stderr.on('data', (d) => process.env.VERBOSE && console.error(String(d)));

const browser = await chromium.launch({ args: ['--no-proxy-server'] });
try {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) break;
    } catch {}
    await sleep(500);
    if (i === 119) throw new Error('服务端启动超时');
  }
  console.log('[api] 生产模式服务端就绪（静态托管 + SSE 同源）');

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // 注册进入
  await page.goto(`${BASE}/register`, { waitUntil: 'networkidle' });
  await page.getByLabel('邮箱').fill(`c3-${Date.now()}@test.dev`);
  await page.getByLabel('密码（至少 8 位）').fill('password123');
  await page.getByLabel('确认密码').fill('password123');
  await page.getByLabel('邀请码').fill('C3TEST');
  await page.getByRole('button', { name: '注册并登录' }).click();
  await page.waitForURL('**/trips', { timeout: 10_000 });

  // 1. 表单：今日剩余次数
  await page.goto(`${BASE}/trips/new`, { waitUntil: 'networkidle' });
  const quotaText = await page.locator('.quota-inline').innerText();
  check('表单显示今日剩余次数', quotaText.includes('3 / 3'), quotaText.trim());
  await page.screenshot({ path: `${SHOTS}/08-planner-form.png` });

  // 2. 第一次生成：完整流水线
  await page.getByLabel('目的地 *').fill('东京');
  await page.getByLabel(/天数/).fill('2');
  await page.locator('.btn-chip', { hasText: '经济' }).first().click();
  await page.getByRole('button', { name: /开始生成/ }).click();

  await page.waitForSelector('.gen-phase', { timeout: 15_000 });
  check('时间线出现', true);
  const sawBanner = await page.locator('.gen-banner').isVisible();
  check('降级标注可见（未配置小红书）', sawBanner);
  await page.waitForSelector('.gen-phase-head:has-text("编排行程")', { timeout: 20_000 });
  await page.screenshot({ path: `${SHOTS}/09-gen-running.png` });
  await page.waitForSelector('.gen-result-ok', { timeout: 30_000 });
  const phaseTitles = await page.locator('.gen-phase-title').allInnerTexts();
  check(
    '三阶段齐全',
    ['调研灵感', '编排行程', '审校把关'].every((t) => phaseTitles.some((x) => x.includes(t))),
    phaseTitles.join('，'),
  );
  const toolLabels = await page.locator('.gen-tool-label').allInnerTexts();
  check('工具时间线有条目', toolLabels.length >= 3, `tools=${toolLabels.length}`);
  const reviewNote = await page.locator('.gen-review-notes').innerText().catch(() => '');
  check('审校提示展示', reviewNote.includes('留意闭馆时间'), reviewNote.trim());
  const usageFoot = await page.locator('.gen-foot .muted').innerText();
  check('token 用量展示', usageFoot.includes('Token'), usageFoot.trim());
  await page.screenshot({ path: `${SHOTS}/10-gen-done.png` });

  // 3. 完成自动跳编辑器
  await page.waitForURL('**/trips/*', { timeout: 10_000 });
  await page.waitForSelector('.day-section', { timeout: 10_000 });
  const dayCount = await page.locator('.day-section').count();
  check('自动跳转编辑器且天数正确', dayCount === 2, `days=${dayCount}`);
  await page.screenshot({ path: `${SHOTS}/11-generated-trip.png` });

  // 4. 刷新恢复：开第二次生成，中途 reload
  await page.goto(`${BASE}/trips/new`, { waitUntil: 'networkidle' });
  await page.getByLabel('目的地 *').fill('大阪');
  await page.getByRole('button', { name: /开始生成/ }).click();
  await page.waitForSelector('.gen-phase', { timeout: 15_000 });
  await page.reload({ waitUntil: 'domcontentloaded' });   // SSE 长连接会卡 networkidle
  // 恢复有两条正路：任务仍在跑 → 重放时间线后自动跳；快照已 done → 直接跳编辑器
  try {
    await page.waitForURL((url) => /\/trips\/(?!new)[^/]+$/.test(url.pathname ?? String(url)), { timeout: 30_000 });
    await page.waitForSelector('.day-section', { timeout: 10_000 });
    check('刷新恢复（sessionStorage + 快照 + 重放）并最终进入编辑器', true);
  } catch (e) {
    await page.screenshot({ path: `${SHOTS}/98-debug-restore.png` });
    const resultText = await page.locator('.gen-result').innerText().catch(() => '(无结果框)');
    const bodyText = await page.locator('body').innerText().catch(() => '');
    check('刷新恢复（sessionStorage + 快照 + 重放）并最终进入编辑器', false, `url=${page.url()}｜result=${resultText.replace(/\n/g, ' ')}｜body=${bodyText.slice(0, 900).replace(/\n/g, ' ')}`);
  }

  // 5. 取消：开第三次生成后立即取消
  await page.goto(`${BASE}/trips/new`, { waitUntil: 'networkidle' });
  const quotaBefore = await page.locator('.quota-inline').innerText();
  await page.getByLabel('目的地 *').fill('北京');
  await page.getByRole('button', { name: /开始生成/ }).click();
  await page.getByRole('button', { name: '取消生成' }).click({ timeout: 10_000 });
  await page.waitForSelector('.gen-result:has-text("已取消")', { timeout: 15_000 });
  check('取消后展示已取消', true);
  await page.getByRole('button', { name: '返回表单' }).click();
  await page.waitForSelector('.planner-form', { timeout: 5_000 });
  const quotaAfterCancel = await page.locator('.quota-inline').innerText();
  check('取消不消耗次数', quotaAfterCancel.trim() === quotaBefore.trim(), `${quotaBefore.trim()} → ${quotaAfterCancel.trim()}`);

  // 6. 用完配额 → 表单禁用 + 文案
  await page.getByLabel('目的地 *').fill('上海');
  await page.getByRole('button', { name: /开始生成/ }).click();
  await page.waitForSelector('.gen-result-ok', { timeout: 30_000 });
  await page.waitForURL('**/trips/*', { timeout: 10_000 });
  await page.goto(`${BASE}/trips/new`, { waitUntil: 'networkidle' });
  const disabledBtn = await page.getByRole('button', { name: '今日次数已用完' }).isDisabled();
  check('配额用尽按钮禁用 + 文案', disabledBtn);
  await page.screenshot({ path: `${SHOTS}/12-quota-exhausted.png` });

  // 7. 移动端时间线视口（375px）
  const mob = await context.newPage();
  await mob.setViewportSize({ width: 390, height: 844 });
  await mob.goto(`${BASE}/trips/new`, { waitUntil: 'networkidle' });
  const mobBtn = await mob.getByRole('button', { name: '今日次数已用完' }).isVisible();
  check('移动端表单渲染正常', mobBtn);
  await mob.screenshot({ path: `${SHOTS}/13-mobile-planner.png` });
  await mob.close();

  // 8. 无 Key 文案（纯 BYOK 模式站点）：另起无站点 Key 服务
  const server2 = spawn(process.execPath, ['../../node_modules/tsx/dist/cli.mjs', 'src/index.ts'], {
    cwd: 'apps/server',
    stdio: ['ignore', 'ignore', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(API_PORT + 1),
      DATABASE_PATH: `${DB_FILE}.nokey.db`,
      MASTER_KEY: crypto.randomBytes(32).toString('hex'),
      INVITE_CODE: 'C3TEST',
      SITE_LLM_BASE_URL: '',
      SITE_LLM_API_KEY: '',
      SITE_LLM_MODEL: '',
      GEN_DAILY_LIMIT: '3',
      XHS_MCP_URL: '',
      NO_PROXY: 'localhost,127.0.0.1',
    },
  });
  try {
    for (let i = 0; i < 60; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${API_PORT + 1}/api/health`);
        if (r.ok) break;
      } catch {}
      await sleep(500);
    }
    const p2 = await context.newPage();
    await p2.goto(`http://127.0.0.1:${API_PORT + 1}/register`, { waitUntil: 'networkidle' });
    await p2.getByLabel('邮箱').fill(`nk-${Date.now()}@test.dev`);
    await p2.getByLabel('密码（至少 8 位）').fill('password123');
    await p2.getByLabel('确认密码').fill('password123');
    await p2.getByLabel('邀请码').fill('C3TEST');
    await p2.getByRole('button', { name: '注册并登录' }).click();
    await p2.waitForURL('**/trips', { timeout: 10_000 });
    await p2.goto(`http://127.0.0.1:${API_PORT + 1}/trips/new`, { waitUntil: 'networkidle' });
    await p2.getByLabel('目的地 *').fill('东京');
    await p2.getByRole('button', { name: /开始生成/ }).click();
    const errText = await p2.locator('.form-error').innerText({ timeout: 10_000 });
    check('无 Key 双轨文案（联系站长 + 高级选项自填）', errText.includes('联系站长') && errText.includes('高级选项'), errText.trim());
    await p2.screenshot({ path: `${SHOTS}/14-no-llm-copy.png` });
    await p2.close();
  } finally {
    server2.kill();
    await sleep(800);                        // Windows 需等进程释放 SQLite 文件锁
    for (const suffix of ['', '-shm', '-wal']) {
      try {
        rmSync(`apps/server/${DB_FILE.replace('./', '')}.nokey.db${suffix}`, { force: true });
      } catch {}
    }
  }
} catch (err) {
  check('脚本执行中断', false, String(err).slice(0, 300));
} finally {
  await browser.close();
  mock.close();
  server.kill();
  await sleep(800);
  for (const suffix of ['', '-shm', '-wal']) {
    try {
      rmSync(`apps/server/${DB_FILE.replace('./', '')}${suffix}`, { force: true });
    } catch {}
  }
}

console.log('\n===== C3 浏览器验收结果 =====');
for (const r of results) console.log(r);
console.log(`===== ${results.length - failed}/${results.length} 通过 =====`);
process.exit(failed ? 1 : 0);
