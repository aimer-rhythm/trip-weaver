import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

process.env.NO_PROXY = 'localhost,127.0.0.1,::1';
const connected = await chromium.connectOverCDP('http://127.0.0.1:9223');
const userContext = connected.contexts()[0];
const target = userContext.pages().find((page) => page.url().includes('/trips/88855596-0d2e-4e89-8251-6a4906df066c'));
assert.ok(target, '需要现有的本地详情页');
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ storageState: await userContext.storageState(), viewport: { width: 1665, height: 944 } });
const page = await context.newPage();
const errors = [];
const writes = [];
const routeLookups = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('request', (request) => {
  if (request.method() === 'POST' && request.url().endsWith('/route-options')) routeLookups.push(request.url());
  else if (request.url().includes('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(`${request.method()} ${request.url()}`);
});
const output = 'data/detail-chat-qa-history';
await mkdir(output, { recursive: true });
try {
  await page.goto(target.url(), { waitUntil: 'domcontentloaded' });
  await page.locator('.chat-welcome').waitFor();
  const latest = page.getByRole('button', { name: '返回最新版本', exact: true });
  if (await latest.count()) {
    await latest.click();
    await latest.waitFor({ state: 'hidden' });
  }
  await page.locator('.chat-stream').evaluate((node) => { node.scrollTop = 0; });
  await page.screenshot({ path: `${output}/desktop-initial.png` });
  await page.getByRole('button', { name: /历史版本/ }).click();
  const history = page.getByRole('dialog', { name: '历史版本' });
  await history.locator('article').first().waitFor();
  await page.screenshot({ path: `${output}/desktop-history.png` });
  const bounds = await history.boundingBox();
  assert.ok(bounds.width < 350);
  await history.getByRole('button', { name: '关闭', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: /历史版本/ }).evaluate((node) => document.activeElement === node), true);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole('button', { name: '对话', exact: true }).click();
  await page.screenshot({ path: `${output}/mobile-chat.png` });
  await page.getByRole('button', { name: /历史版本/ }).click();
  await history.waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await history.evaluate((node) => node.scrollWidth <= node.clientWidth), true);
  await page.screenshot({ path: `${output}/mobile-history.png` });
  await page.keyboard.press('Escape');
  await history.waitFor({ state: 'hidden' });
  assert.deepEqual(errors, []);
  assert.deepEqual(writes, []);
  await writeFile(`${output}/review.json`, JSON.stringify({ url: page.url(), bounds, errors, writes, routeLookups, passed: true }, null, 2));
  console.log('PASS 真实详情页桌面与手机、历史时间轴、关闭焦点、Escape、零行程写入');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
  // 只断开 CDP，不关闭用户现有浏览器。
  process.exit(process.exitCode ?? 0);
}
