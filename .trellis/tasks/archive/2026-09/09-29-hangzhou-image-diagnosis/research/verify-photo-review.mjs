import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { createCuratedCoverLookup } from '../../../../apps/server/src/integrations/curatedPhotos.ts';
const library = JSON.parse(await fs.readFile('apps/server/src/data/photography/hangzhou-curated.json', 'utf8'));
const lookup = createCuratedCoverLookup('杭州');
const out = '.trellis/tasks/09-29-hangzhou-image-diagnosis/research/photo-verification';
await fs.mkdir(out, { recursive: true });
const photos = [];
for (const place of library.places) {
  const cover = await lookup(place.name);
  assert.equal(Boolean(cover), place.photos.some(p => p.review.status === 'approved'), place.name);
  for (const photo of place.photos) {
    const response = await fetch(`http://127.0.0.1:5173/media/${photo.key}`, { signal: AbortSignal.timeout(10000) });
    const bytes = await response.arrayBuffer();
    photos.push({ id: photo.id, status: response.status, type: response.headers.get('content-type'), bytes: bytes.byteLength });
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-type')?.startsWith('image/webp'));
  }
}
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', err => errors.push(err.message));
  await page.goto('http://127.0.0.1:18799');
  await page.getByRole('heading', { name: '杭州，先选对，再选美。' }).waitFor();
  const decoded = await page.locator('img').evaluateAll(async imgs => Promise.all(imgs.map(async img => {
    await img.decode(); return { alt: img.alt, width: img.naturalWidth, height: img.naturalHeight };
  })));
  assert.ok(decoded.every(img => img.width > 0));
  await page.screenshot({ path: `${out}/review-desktop.png`, fullPage: false });
  await page.getByLabel('浏览景点').selectOption('place-1');
  assert.equal(await page.locator('#place-1 .reference').count(), 2);
  assert.equal(await page.locator('#place-1 .withdrawn').count(), 3);
  const portrait = page.locator('#place-1 .reference img').first();
  for (const [mode, ratio] of [['original', 667/1000], ['square', 1], ['portrait', 4/5], ['landscape', 3/2]]) {
    await page.getByLabel('展示方式').selectOption(mode);
    const actual = await portrait.evaluate(img => { const r = img.getBoundingClientRect(); return r.width/r.height; });
    assert.ok(Math.abs(actual - ratio) < 0.01, `${mode}: unexpected image ratio ${actual}`);
    await page.screenshot({ path: `${out}/review-bridge-${mode}.png`, fullPage: true });
  }
  await page.getByLabel('展示方式').selectOption('original');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${out}/review-bridge-mobile.png`, fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.reload();
  assert.equal(await page.getByLabel('浏览景点').inputValue(), 'place-1');
  assert.equal(await page.locator('section:visible').count(), 1);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel('浏览景点').selectOption('place-8');
  assert.equal(await page.locator('section:visible').count(), 1);
  await page.screenshot({ path: `${out}/review-xixi.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${out}/review-mobile.png`, fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert.equal(overflow, false);
  assert.deepEqual(errors, []);
  await fs.writeFile(`${out}/result.json`, JSON.stringify({ photos, decoded, pageErrors: errors, mobileOverflow: overflow, passed: true }, null, 2));
  console.log(JSON.stringify({ photos: photos.length, decoded: decoded.length, errors, passed: true }));
} finally { await browser.close(); }
