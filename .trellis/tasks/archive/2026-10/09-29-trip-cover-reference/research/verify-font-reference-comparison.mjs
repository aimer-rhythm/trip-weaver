import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const out = '.trellis/tasks/09-29-trip-cover-reference/research';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', message => { if (message.type() === 'error') { errors.push(message.text()); console.error(message.text()); } });
  page.on('requestfailed', request => console.error(request.url(), request.failure()));
  await page.goto('http://127.0.0.1:18799/font-reference-comparison.html');
  await page.evaluate(async () => {
    for (const option of ['D', 'E', 'F', 'G', 'H', 'I']) {
      await document.fonts.load(`32px "TW Preview ${option}"`, '沿着中轴线，走进老北京');
    }
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const images = await page.evaluate(async () => Promise.all([...document.images].map(async image => {
    await image.decode();
    return { src: image.getAttribute('src'), width: image.naturalWidth, height: image.naturalHeight };
  })));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument');
  const report = [];
  for (const option of ['D', 'E', 'F', 'G', 'H', 'I']) {
    for (const sample of ['.title', '.extra', 'figcaption', '.probe']) {
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: `#option-${option} ${sample}` });
      const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
      report.push({ option, sample, fonts });
      assert.ok(fonts.some(font => font.isCustomFont), `${option} ${sample} 必须使用实际候选字体`);
      if (sample === '.title' || option === 'E' || option === 'G') {
        assert.ok(fonts.every(font => font.isCustomFont), `${option} ${sample} 不应有字体回退`);
      }
      if (sample === '.probe') {
        assert.equal(fonts.some(font => !font.isCustomFont), option === 'I', `${option} 生僻字回退须符合字体映射实测`);
      }
    }
    await page.locator(`#option-${option}`).screenshot({ path: `${out}/font-reference-${option}.png` });
  }
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: `${out}/font-reference-desktop.png`, fullPage: true });
  await page.locator('.references').screenshot({ path: `${out}/font-reference-originals.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: `${out}/font-reference-mobile.png`, fullPage: true });
  assert.deepEqual(errors, []);
  await fs.writeFile(`${out}/font-reference-result.json`, JSON.stringify({ passed: true, report, images, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, report, images, errors }));
} finally { await browser.close(); }
