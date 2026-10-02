// 当前应用构建 + 真实导出/导入生成的只读行程，验证全部精选的切换和署名。
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const here = path.dirname(fileURLToPath(import.meta.url));
const trip = JSON.parse(await readFile(path.join(here, 'preview/trip.json'), 'utf8'));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const errors = []; const writes = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) writes.push(request.url()); });
  await page.goto('http://127.0.0.1:18841/trips/ranked-photos-preview');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    for (const poi of trip.overview) {
      const trigger = page.getByRole('button', { name: `查看${poi.name}完整照片`, exact: true });
      await trigger.waitFor();
      await trigger.locator('img').evaluate(image => image.decode());
      await trigger.click();
      const dialog = page.getByRole('dialog', { name: `${poi.name} · 完整照片`, exact: true });
      for (let index = 0; index < poi.photos.length; index++) {
        if (poi.photos.length > 1) await dialog.getByRole('button', { name: `查看第${index + 1}张照片`, exact: true }).click();
        await dialog.locator('.poi-photo-expanded').evaluate(image => image.decode());
        assert.equal(await dialog.locator('.poi-photo-expanded').getAttribute('src'), poi.photos[index].url);
        assert.ok((await dialog.locator('.photo-credit').textContent()).includes(poi.photos[index].attribution.photographer));
        assert.ok((await dialog.locator('.photo-credit').textContent()).includes('未确认授权'));
      }
      if (poi.name === '天坛') await page.screenshot({ path: path.join(here, `verification/app-gallery-${width}.png`) });
      await page.keyboard.press('Escape');
      assert.equal(await dialog.count(), 0);
      assert.equal(await trigger.locator('img').getAttribute('src'), poi.coverUrl);
    }
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(writes, []);
  await writeFile(path.join(here, 'verification/app-browser.json'), JSON.stringify({ galleries: trip.overview.length, images: 8, widths: [1440, 390], errors, writes }, null, 2));
  console.log('应用浏览器通过：4 个图库、8 张图片，桌面/手机切换和署名正常，零写请求');
} finally { await browser.close(); }
