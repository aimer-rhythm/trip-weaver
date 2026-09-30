import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const out = '.trellis/tasks/09-29-hangzhou-image-diagnosis/research/photo-verification/openverse';
await fs.mkdir(out, { recursive: true });
const before = JSON.parse(await fs.readFile('data/photo-pilot/openverse/candidates.json', 'utf8'));
let fetches = 0;
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async () => { fetches++; throw new Error('缓存复跑不得发请求'); };
  await import('../../../../apps/server/scripts/collect-openverse-pilot.mts');
} finally { globalThis.fetch = originalFetch; }
const after = JSON.parse(await fs.readFile('data/photo-pilot/openverse/candidates.json', 'utf8'));
assert.equal(fetches, 0);
assert.deepEqual(after.candidates, before.candidates);
assert.deepEqual(after.errors, []);
assert.equal(after.candidates.filter(photo => photo.preview).length, 15);

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const errors = [], externalRequests = [], checks = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).hostname !== '127.0.0.1') externalRequests.push(request.url()); });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1050 });
    await page.goto('http://127.0.0.1:18799/openverse.html');
    const photos = await page.locator('article img').evaluateAll(async images => Promise.all(images.map(async image => {
      await image.decode();
      return { width: image.naturalWidth, height: image.naturalHeight, fit: getComputedStyle(image).objectFit };
    })));
    assert.equal(photos.length, 15);
    assert.ok(photos.every(photo => photo.width > 0 && photo.height > 0 && photo.fit === 'contain'));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `${out}/${width}.png` });
    if (width === 1440) await page.locator('section').filter({ has: page.getByRole('heading', { name: '雷峰塔', exact: true }) }).screenshot({ path: `${out}/leifeng-candidates.png` });
    checks.push({ width, decoded: photos.length, overflow: false });
  }
  for (const entry of ['index.html', 'landscape.html']) {
    await page.goto(`http://127.0.0.1:18799/${entry}`);
    await page.locator('a[href="openverse.html"]').click();
    assert.ok(page.url().endsWith('/openverse.html'));
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(externalRequests, []);
  const result = { records: after.candidates.length, previews: 15, cachedReplayFetches: fetches, checks, errors, externalRequests };
  await fs.writeFile(`${out}/result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
