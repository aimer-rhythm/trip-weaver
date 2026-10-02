import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const out = path.resolve('.trellis/tasks/archive/2026-10/09-29-ui-consistency/research/shared-verification');
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let authenticated = false;
  await page.route(/^http:\/\/127\.0\.0\.1:5173\/api\//, route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/auth/me' && !authenticated) return route.fulfill({ status: 401, json: { message: '请登录' } });
    if (pathname === '/api/auth/login') { authenticated = true; return route.fulfill({ json: { id: 'fixture', email: 'fixture@example.test' } }); }
    const fixtures = {
      '/api/auth/config': { registrationMode: 'open', githubEnabled: false },
      '/api/auth/me': { id: 'fixture', email: 'fixture@example.test' },
      '/api/usage': { remaining: 2, dailyLimit: 4 },
      '/api/destinations/covered': { cities: ['北京', '杭州', '成都'] },
      '/api/trips': [],
      '/api/settings': { byokEnabled: false, baseUrl: '', model: '', apiKeyLast4: '', hasSiteKey: true, hasPersonalAmapKey: false, amapApiKeyLast4: '', hasSiteAmapKey: true, hasPersonalSearchKey: false, searchApiKeyLast4: '', searchApiBaseUrl: '', hasSiteSearchKey: true },
    };
    return route.fulfill({ json: fixtures[pathname] ?? {} });
  });
  await page.goto('http://127.0.0.1:5173/login');
  await page.getByLabel('邮箱').fill('fixture@example.test');
  await page.getByLabel('密码', { exact: true }).fill('fixture-password');
  const login = page.getByRole('button', { name: '登录', exact: true });
  const loginStyle = await login.evaluate(el => ({ background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, height: el.getBoundingClientRect().height }));
  assert.equal(loginStyle.color, 'rgb(255, 255, 255)');
  assert.notEqual(loginStyle.background, 'rgba(0, 0, 0, 0)');
  assert.ok(loginStyle.height >= 35);
  await page.screenshot({ path: path.join(out, 'login.png') });
  await page.getByRole('link', { name: '注册', exact: true }).click();
  await page.getByLabel('邮箱').fill('fixture@example.test');
  await page.getByLabel('密码（至少 8 位）', { exact: true }).fill('fixture-password');
  await page.getByLabel('确认密码').fill('different-password');
  await page.getByRole('button', { name: '注册并登录', exact: true }).click();
  await page.getByText('两次输入的密码不一致').waitFor();
  await page.setViewportSize({ width: 375, height: 812 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: path.join(out, 'register-mobile.png') });
  await page.goto('http://127.0.0.1:5173/login');
  await page.getByLabel('邮箱').fill('fixture@example.test');
  await page.getByLabel('密码', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.locator('.trip-collection').waitFor();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  assert.equal(await dialog.getAttribute('aria-labelledby') !== null, true);
  assert.ok(await dialog.evaluate(el => el.getBoundingClientRect().width <= innerWidth));
  await page.screenshot({ path: path.join(out, 'settings-mobile.png') });
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('button', { name: '设置', exact: true }).evaluate(el => el === document.activeElement), true, 'modal restores trigger focus');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('http://127.0.0.1:5173/');
  await page.locator('.home-page-root').waitFor();
  await page.getByRole('button', { name: /出行日期/ }).click();
  await page.locator('.range-calendar').waitFor();
  const days = page.locator('.range-calendar-day:not(:disabled)');
  assert.ok(await days.count() > 10);
  await days.nth(3).click();
  await days.nth(5).click();
  assert.ok(await page.locator('.range-calendar-day.is-start').count() > 0);
  assert.ok(await page.locator('.range-calendar-day.is-end').count() > 0);
  await page.screenshot({ path: path.join(out, 'home-calendar.png') });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://127.0.0.1:5173/');
  await page.locator('.home-page-root').waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: path.join(out, 'home-mobile.png'), fullPage: true });
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(out, 'results.json'), JSON.stringify({ status: 'passed', checks: ['login styling and navigation', 'register validation', 'mobile auth layout', 'settings dialog and Escape', 'calendar range selection', 'mobile home overflow'], errors }, null, 2));
  console.log('Shared UI checks passed:', out);
} finally {
  await browser.close();
}
