// 内置浏览器不可用时的项目 Playwright 验证，只打开本任务的本地审核产物。
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const here = path.dirname(fileURLToPath(import.meta.url));
const report = path.join(here, 'preview/index.html');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(pathToFileURL(report).href);
  // 验证所有延迟加载图片时，显式等待解码，避免把未滚动到的缩略图误判为坏图。
  const images = await page.locator('img').evaluateAll(async nodes => {
    return Promise.all(nodes.map(async image => {
      image.loading = 'eager';
      await image.decode();
      return { width: image.naturalWidth, height: image.naturalHeight };
    }));
  });
  assert.equal(await page.locator('section').count(), 5);
  assert.ok(images.length >= 8 && images.every(image => image.width > 0));
  assert.equal(await page.locator('a[href*="xsec_token"]').count(), 0);
  assert.equal(await page.locator('article strong').filter({ hasText: /^封面$/ }).count(), 4);
  await mkdir(path.join(here, 'verification'), { recursive: true });
  await page.screenshot({ path: path.join(here, 'verification/preview-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: path.join(here, 'verification/preview-mobile.png') });
  await writeFile(path.join(here, 'verification/browser.json'), JSON.stringify({ sections: 5, decoded: images.length, desktop: true, mobile: true, secretsAbsent: true }, null, 2));
  console.log(`摄影预览通过：5 个景点，${images.length} 张候选解码；桌面/手机布局正常`);
} finally {
  await browser.close();
}
