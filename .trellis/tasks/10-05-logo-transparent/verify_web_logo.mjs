import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { apiSuccess } from '../../../scripts/lib/api-contract.mjs';

const base = 'http://127.0.0.1:5173';
const output = new URL('./research/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-proxy-server'],
});
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const fixtures = {
    '/api/auth/me': { id: 'logo-preview', email: 'logo@example.test' },
    '/api/auth/config': { registrationMode: 'open', githubEnabled: false },
    '/api/destinations/covered': { cities: ['北京', '杭州'] },
    '/api/settings/travel-preferences': { pace: 'moderate', partySize: 2, preferences: [], transportMode: 'transit', extraNotes: '' },
    '/api/usage': { remaining: 3, dailyLimit: 5 },
    '/api/generations/current': null,
    '/api/notifications': { items: [], hasUnread: false, readThrough: 0, nextCursor: null },
    '/api/trips': { items: [], total: 0, destinations: [] },
  };
  const unexpected = [];
  await context.route(`${base}/api/**`, async route => {
    const key = new URL(route.request().url()).pathname;
    if (!(key in fixtures) || route.request().method() !== 'GET') unexpected.push(key);
    return route.fulfill({ json: apiSuccess(fixtures[key] ?? {}) });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await page.getByRole('link', { name: '我的行程', exact: true }).waitFor();
  await page.locator('.brand-mark').evaluate(image => image.decode());
  await page.evaluate(() => document.fonts.ready);
  const measurements = [];
  for (const [label, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844], ['narrow', 320, 740]]) {
    await page.setViewportSize({ width, height });
    const mark = page.locator('.brand-mark');
    const data = await mark.evaluate(image => {
      const box = image.getBoundingClientRect();
      const target = image.closest('a').getBoundingClientRect();
      return { width: box.width, height: box.height, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, targetWidth: target.width, targetHeight: target.height, objectFit: getComputedStyle(image).objectFit, src: image.getAttribute('src'), viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth };
    });
    assert.equal(data.naturalWidth, 256);
    assert.equal(data.naturalHeight, 256);
    assert.equal(data.objectFit, 'contain');
    assert.equal(data.src, '/brand/logo-bird.png');
    assert.ok(data.targetWidth >= 44 && data.targetHeight >= 44);
    assert.ok(data.scrollWidth <= width, `${label}: page overflows`);
    measurements.push({ label, ...data });
    await page.locator('header').screenshot({ path: new URL(`logo-${label}-header.png`, output).pathname.replace(/^\/(\w:)/, '$1') });
    if (label !== 'narrow') await page.screenshot({ path: new URL(`logo-${label}.png`, output).pathname.replace(/^\/(\w:)/, '$1') });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('link', { name: '我的行程', exact: true }).click();
  await page.waitForURL(`${base}/trips`);
  assert.equal(await page.locator('.brand-mark').getAttribute('src'), '/brand/logo-bird.png');
  await page.getByRole('link', { name: '返回首页', exact: true }).click();
  await page.waitForURL(base + '/');
  await page.getByRole('link', { name: '返回首页', exact: true }).focus();
  assert.equal(await page.getByRole('link', { name: '返回首页', exact: true }).evaluate(el => el === document.activeElement), true);
  for (const size of [16, 32]) {
    const icon = await page.locator(`link[rel="icon"][sizes="${size}x${size}"]`).getAttribute('href');
    assert.equal(icon, `/brand/favicon-${size}.png`);
    const response = await page.request.get(base + icon);
    assert.equal(response.status(), 200);
    assert.match(response.headers()['content-type'], /image\/png/);
    const production = await readFile(`apps/web/dist${icon}`);
    assert.deepEqual(production, await response.body());
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpected, []);
  await writeFile(new URL('web-verification.json', output), JSON.stringify({ measurements, errors, unexpected, checks: ['homepage and collection shared logo', '44px click target and keyboard focus', '16/32px favicon served and included in build', '320/390/1440px layouts'] }, null, 2));
  console.log('PASS: desktop/mobile logo, shared navigation, home link, focus, favicon, production assets');
} finally {
  await browser.close();
}
