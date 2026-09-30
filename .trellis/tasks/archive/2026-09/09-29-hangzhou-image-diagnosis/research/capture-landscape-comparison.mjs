import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const out = '.trellis/tasks/09-29-hangzhou-image-diagnosis/research/photo-verification/landscape';
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const errors = [], writes = [], checks = [];
try {
  const page = await browser.newPage({ viewport: { width: 1760, height: 1100 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method())) writes.push(request.method()); });
  await page.goto('http://127.0.0.1:18799/landscape.html');
  const plan = JSON.parse(await page.locator('#photo-data').textContent());
  const decode = () => page.locator('main img').evaluateAll(async images => Promise.all(images.map(async img => {
    await img.decode();
    return { alt: img.alt, width: img.naturalWidth, height: img.naturalHeight };
  })));
  await decode();
  await page.locator('#layouts').screenshot({ path: `${out}/layout-comparison.png` });
  const selectedImages = await page.locator('#layout-options img').evaluateAll(images => images.map(img => img.src));
  assert.equal(new Set(selectedImages).size, 1, 'Layout comparison must use the same photograph');
  const layoutRatios = await page.locator('#layout-options img').evaluateAll(images => images.map(img => {
    const box = img.getBoundingClientRect();
    return { frame: box.width / box.height, natural: img.naturalWidth / img.naturalHeight, fit: getComputedStyle(img).objectFit };
  }));
  assert.equal(layoutRatios[0].fit, 'cover');
  for (const layout of layoutRatios.slice(1)) assert.ok(Math.abs(layout.frame - layout.natural) < .01);
  for (const width of [1760, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1100 });
    for (const place of plan.places) {
      await page.getByLabel('比较景点').selectOption(place.id);
      const images = await decode();
      assert.equal(await page.locator('.candidate').count(), place.photos.length);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      assert.equal(overflow, false, `${width} ${place.name}: horizontal overflow`);
      if (place.photos.length) {
        const fits = await page.locator('.full-photo img').evaluateAll(images => images.every(img => {
          const box = img.getBoundingClientRect();
          return Math.abs(box.width / box.height - img.naturalWidth / img.naturalHeight) < .01;
        }));
        assert.equal(fits, true, `${place.name}: candidate originals must not be cropped`);
      } else {
        assert.equal(await page.locator('#empty').isVisible(), true);
        assert.equal(await page.locator('#layouts').isVisible(), false);
      }
      checks.push({ place: place.name, width, decoded: images.length, overflow });
      if (width === 1760 && ['leifeng', 'westlake', 'bridge', 'santan', 'xixi'].includes(place.id)) {
        await page.locator('#candidates').screenshot({ path: `${out}/candidates-${place.id}.png` });
      }
      if (width === 390 && place.id === 'leifeng') await page.screenshot({ path: `${out}/mobile.png`, fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1760, height: 1100 });
  await page.getByLabel('比较景点').selectOption('bridge');
  const portrait = page.locator('[data-choose="xhs-68a1e73c000000001c004b24-0"]');
  await portrait.click();
  assert.equal(await portrait.getAttribute('aria-pressed'), 'true');
  assert.ok(page.url().includes('photo=xhs-68a1e73c000000001c004b24-0'));
  const referencePhoto = page.locator('#layouts .landscape img');
  assert.ok(await referencePhoto.evaluate(img => Math.abs(img.width / img.height - img.naturalWidth / img.naturalHeight) < .01));
  await page.reload();
  await decode();
  assert.equal(await page.getByLabel('比较景点').inputValue(), 'bridge');
  assert.equal(await portrait.getAttribute('aria-pressed'), 'true');
  const open = page.locator('#layouts .landscape .preview-open');
  await open.click();
  assert.equal(await page.locator('#photo-dialog').isVisible(), true);
  await page.locator('#dialog-image').evaluate(img => img.decode());
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#photo-dialog').isVisible(), false);
  assert.equal(await open.evaluate(button => button === document.activeElement), true);
  assert.deepEqual(writes, []);
  assert.deepEqual(errors, []);
  await fs.writeFile(`${out}/result.json`, JSON.stringify({ checks, layoutRatios, errors, writes, passed: true }, null, 2));
  console.log(JSON.stringify({ views: checks.length, photos: plan.places.reduce((sum, p) => sum + p.photos.length, 0), errors, writes, passed: true }));
} finally { await browser.close(); }
