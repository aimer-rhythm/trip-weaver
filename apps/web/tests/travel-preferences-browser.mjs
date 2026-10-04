import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { apiSuccess, apiFailure } from '../../../scripts/lib/api-contract.mjs';

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--no-proxy-server', '--disable-features=LocalNetworkAccessChecks'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.setDefaultTimeout(15_000);
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const defaults = () => ({ preferences: [], transportMode: 'transit', pace: null, partySize: 2, extraNotes: '' });
const saved = { a: defaults(), b: defaults() };
let account = 'a';
let failSave = false;
let failLoad = false;
let slowSave = false;
let generationOk = false;
let activeWrites = 0;
let maxWrites = 0;
let brief;
let briefUrl = '';
let generation;
const writes = [];
let expireTrips = false;
let saveGate;
let releaseSave;
await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
  const req = route.request();
  const path = new URL(req.url()).pathname;
  const ok = (data) => route.fulfill({ json: apiSuccess(data) });
  if (path === '/api/auth/me') return ok({ id: account, email: `${account}@example.test` });
  if (path === '/api/auth/config') return ok({ registrationMode: 'open', githubEnabled: false });
  if (path === '/api/auth/login') {
    account = req.postDataJSON().email.startsWith('b@') ? 'b' : 'a';
    return ok({ id: account, email: `${account}@example.test` });
  }
  if (path === '/api/auth/logout') return ok({ ok: true });
  if (path === '/api/trips') return expireTrips
    ? route.fulfill({ status: 401, json: apiFailure(401, '请重新登录') })
    : ok({ items: [], total: 0, destinations: [] });
  if (path === '/api/usage') return ok({ remaining: 5, dailyLimit: 5 });
  if (path === '/api/destinations/covered') return ok({ cities: ['北京', '杭州'] });
  if (path === '/api/settings/travel-preferences') {
    const owner = account;
    if (req.method() === 'GET') return failLoad
      ? route.fulfill({ status: 500, json: apiFailure(500, '加载失败') }) : ok(saved[owner]);
    if (failSave) return route.fulfill({ status: 500, json: apiFailure(500, '保存失败') });
    activeWrites++;
    maxWrites = Math.max(maxWrites, activeWrites);
    const body = req.postDataJSON();
    writes.push(body);
    if (saveGate) await saveGate;
    if (slowSave) await new Promise((resolve) => setTimeout(resolve, 1100));
    saved[owner] = body;
    activeWrites--;
    return ok(body);
  }
  if (path === '/api/conversations' && req.method() === 'POST') return ok({ id: 'conversation-test' });
  if (path === '/api/conversations/conversation-test/brief') { brief = req.postDataJSON(); briefUrl = req.url(); return ok({}); }
  if (path === '/api/generations' && req.method() === 'POST') {
    generation = req.postDataJSON();
    return generationOk
      ? ok({ jobId: 'job-success' })
      : route.fulfill({ status: 400, json: apiFailure(400, '测试已捕获生成请求') });
  }
  // SSE：一条 job_done 即生成成功，前端据此把首页草稿写进账号
  if (path === '/api/generations/job-success/events') {
    return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
      body: `id: 1\ndata: ${JSON.stringify({ type: 'job_done', tripId: 'trip-generated' })}\n\n` });
  }
  return ok({});
});
const base = process.env.BASE ?? 'http://127.0.0.1:5173';
// 备注区不再常驻保存提示：等「正在保存…」消失且 mock 服务端已写入，得到与旧提示等价的同步点。
const waitSaved = async (expected) => {
  const matched = () => Object.keys(expected).every((key) => JSON.stringify(saved[account][key]) === JSON.stringify(expected[key]));
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (matched() && activeWrites === 0 && !(await page.getByText('正在保存…', { exact: true }).isVisible())) return;
    await page.waitForTimeout(50);
  }
  assert.fail(`保存未在超时前写入：期望 ${JSON.stringify(expected)}，当前 ${JSON.stringify(saved[account])}`);
};
const openMore = () => page.getByRole('button', { name: /偏好与出行/ }).click();
const pickTrip = async () => {
  await page.getByRole('button', { name: /^目的地/ }).click();
  await page.getByRole('button', { name: '北京', exact: true }).click();
  await page.getByRole('button', { name: /节奏与同行/ }).click();
  await page.getByRole('button', { name: /少走路/ }).click();
};
const checkBounds = async () => {
  const bad = await page.evaluate(() => [...document.querySelectorAll('header a, header button, textarea, dialog[open]')]
    .filter((el) => el.getClientRects().length).map((el) => ({ text: el.textContent, r: el.getBoundingClientRect() }))
    .filter(({ r }) => r.left < -1 || r.right > innerWidth + 1));
  assert.deepEqual(bad, []);
};
try {
  await page.goto(base);
  await openMore();
  assert.equal(writes.length, 0, '加载默认设置不应触发保存');
  await page.getByLabel('备注').fill('带小孩一起，需要午休');
  await page.getByRole('button', { name: '美食', exact: true }).click();
  await page.getByRole('button', { name: /自驾/ }).click();
  await page.waitForTimeout(800);
  assert.equal(writes.length, 0, '生成成功前首页选择不得写账号');
  assert.deepEqual(saved.a, defaults());
  await mkdir('data/travel-preferences-review', { recursive: true });
  await page.screenshot({ path: 'data/travel-preferences-review/home-desktop.png' });
  // 新账号还没选过节奏，也不要有预选的同行人数
  await page.getByRole('button', { name: /节奏与同行/ }).click();
  assert.equal(await page.getByRole('button', { name: /少走路/ }).getAttribute('aria-pressed'), 'false', '新账号不预选节奏');
  await page.getByText('2 人同行', { exact: true }).waitFor();
  await page.reload();
  await openMore();
  assert.equal(await page.getByLabel('备注').inputValue(), '', '未生成过的首页改动不跨会话保留');
  assert.equal(await page.getByRole('button', { name: '美食', exact: true }).getAttribute('aria-pressed'), 'false');

  // 生成失败：首页选择同样不进账号
  await pickTrip();
  await openMore();
  const failedNotes = '生成失败不记忆';
  await page.getByLabel('备注').fill(failedNotes);
  await page.getByRole('button', { name: '开始规划', exact: true }).click();
  await page.getByText('测试已捕获生成请求', { exact: true }).waitFor();
  assert.equal(generation.extraNotes, failedNotes);
  assert.equal(brief.extraNotes, failedNotes);
  await page.waitForTimeout(800);
  assert.equal(writes.length, 0, '生成失败不得写账号');
  assert.deepEqual(saved.a, defaults());

  // 生成成功：首页草稿一次性写进账号
  await page.getByRole('link', { name: '回首页重新选择' }).click();
  await pickTrip();
  await openMore();
  const submittedNotes = '带小孩一起，避开台阶，需要午休';
  await page.getByLabel('备注').fill(submittedNotes);
  await page.getByRole('button', { name: '美食', exact: true }).click();
  // 节奏与同行人数也进账号记忆：节奏已由 pickTrip 选中，这里再加一人
  await page.getByRole('button', { name: /节奏与同行/ }).click();
  await page.getByRole('button', { name: '增加人数' }).click();
  generationOk = true;
  const putAfterGeneration = page.waitForResponse((res) =>
    res.request().method() === 'PUT' && new URL(res.url()).pathname === '/api/settings/travel-preferences');
  await page.getByRole('button', { name: '开始规划', exact: true }).click();
  await putAfterGeneration;
  await page.waitForURL('**/trips/trip-generated');
  assert.equal(generation.extraNotes, submittedNotes);
  assert.equal(brief.extraNotes, submittedNotes);
  assert.ok(briefUrl.includes('snapshot=1'), '首页留档 Brief 走 snapshot，不在对话里产生「已更新…」消息');
  await waitSaved({ extraNotes: submittedNotes, preferences: ['美食'], transportMode: 'transit', pace: 'relaxed', partySize: 3 });
  // 生成成功直接跳详情页，不停留进度面板；回首页继续后面的用例
  await page.goto(base);
  await openMore();
  assert.equal(await page.getByLabel('备注').inputValue(), submittedNotes);
  assert.equal(await page.getByRole('button', { name: '美食', exact: true }).getAttribute('aria-pressed'), 'true');
  // 重开首页：节奏与同行人数直接从账号记忆里带出来，不用重选
  await page.getByRole('button', { name: /节奏与同行/ }).click();
  assert.equal(await page.getByRole('button', { name: /少走路/ }).getAttribute('aria-pressed'), 'true', '节奏应随账号记忆预选');
  await page.getByText('3 人同行', { exact: true }).waitFor();

  // 个人资料：即时保存，且与首页共用同一份值
  await page.getByRole('button', { name: '个人资料', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '个人资料' });
  await dialog.waitFor();
  assert.equal(await dialog.getByLabel('备注').inputValue(), submittedNotes);
  slowSave = true;
  await dialog.getByLabel('备注').fill('第一版');
  await page.waitForFunction(() => document.querySelector('dialog textarea')?.value === '第一版');
  await page.waitForResponse((res) => res.request().method() === 'PUT');
  await dialog.getByLabel('备注').fill('第二版');
  // 等第二次开始写入，再修改，覆盖在途请求场景。
  await page.waitForRequest((req) => req.method() === 'PUT');
  await dialog.getByLabel('备注').fill('最后一版：带小孩一起');
  await waitSaved({ extraNotes: '最后一版：带小孩一起' });
  assert.equal(saved.a.extraNotes, '最后一版：带小孩一起');
  assert.equal(maxWrites, 1);
  slowSave = false;
  failSave = true;
  await dialog.getByLabel('备注').fill('失败后仍保留的备注');
  await page.getByText('保存失败，当前修改尚未记住', { exact: true }).waitFor();
  failSave = false;
  await dialog.getByRole('button', { name: '重试', exact: true }).click();
  await waitSaved({ extraNotes: '失败后仍保留的备注' });
  assert.equal(saved.a.extraNotes, '失败后仍保留的备注');
  await page.screenshot({ path: 'data/travel-preferences-review/profile-desktop.png' });
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('button', { name: '个人资料', exact: true }).evaluate((el) => el === document.activeElement), true);

  // 清空
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole('button', { name: '个人资料', exact: true }).click();
  await dialog.waitFor();
  await checkBounds();
  await page.screenshot({ path: 'data/travel-preferences-review/profile-mobile.png' });
  await dialog.getByRole('button', { name: /清空偏好/ }).click();
  await waitSaved(defaults());
  await page.reload();
  await openMore();
  assert.deepEqual(saved.a, defaults());
  assert.equal(await page.getByLabel('备注').inputValue(), '');
  await checkBounds();
  await page.screenshot({ path: 'data/travel-preferences-review/home-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 960 });
  await checkBounds();

  // 账号隔离
  await page.getByRole('button', { name: '个人资料', exact: true }).click();
  await dialog.getByLabel('备注').fill('账号 A 的个性化要求');
  await waitSaved({ extraNotes: '账号 A 的个性化要求' });
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  account = 'b';
  await page.reload();
  await openMore();
  assert.equal(await page.getByLabel('备注').inputValue(), '');
  assert.equal(saved.b.extraNotes, '');

  failLoad = true;
  await page.reload();
  await openMore();
  await page.getByText('偏好加载失败，请重试', { exact: true }).waitFor();
  failLoad = false;
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await page.getByLabel('备注').waitFor();

  // 正常退出/登录走同一个 SPA，验证缓存清理和重新登录后的服务端恢复。
  await page.getByRole('button', { name: '退出', exact: true }).click();
  await page.getByLabel('邮箱').fill('a@example.test');
  await page.getByLabel('密码', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('link', { name: /织程/ }).click();
  await openMore();
  assert.equal(await page.getByLabel('备注').inputValue(), '账号 A 的个性化要求');

  // 第一笔在途、第二笔排队；另一个请求返回 401 后登录 B，旧队列不得写入 B。
  saveGate = new Promise((resolve) => { releaseSave = resolve; });
  await page.getByRole('button', { name: '个人资料', exact: true }).click();
  await dialog.waitFor();
  const firstWrite = page.waitForRequest((req) => req.method() === 'PUT');
  await dialog.getByLabel('备注').fill('A 已发送的备注');
  await firstWrite;
  await dialog.getByLabel('备注').fill('A 排队中的备注');
  // 等待 500ms 防抖触发排队，第一笔仍由 gate 保持在途。
  await page.waitForTimeout(700);
  assert.equal(await page.getByRole('button', { name: '退出', exact: true }).isDisabled(), true);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  expireTrips = true;
  await page.getByRole('link', { name: '我的行程', exact: true }).click();
  await page.getByLabel('邮箱').fill('b@example.test');
  await page.getByLabel('密码', { exact: true }).fill('fixture-password');
  expireTrips = false;
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('button', { name: '个人资料', exact: true }).click();
  await dialog.getByText('b@example.test', { exact: true }).waitFor();
  const writesBeforeRelease = writes.length;
  const pendingResponse = page.waitForResponse((res) => res.request().method() === 'PUT');
  saveGate = undefined;
  releaseSave();
  await pendingResponse;
  await dialog.getByLabel('备注').fill('B 独立的备注');
  await waitSaved({ extraNotes: 'B 独立的备注' });
  assert.equal(writes.length, writesBeforeRelease + 1, '过期账号排队中的保存必须在发送前取消');
  assert.equal(saved.a.extraNotes, 'A 已发送的备注');
  assert.equal(saved.b.extraNotes, 'B 独立的备注');
  assert.deepEqual(errors, []);
  console.log('PASS 首页选择仅在生成成功后记忆（含节奏与同行人数）、生成失败与刷新不写账号、个人资料即时保存与串行写入、失败重试、清空、账号隔离、会话切换队列隔离、移动端边界与 Escape');
} catch (error) {
  console.error('Page errors:', errors);
  console.error('Visible page:', await page.locator('body').innerText());
  throw error;
} finally { await browser.close(); }
