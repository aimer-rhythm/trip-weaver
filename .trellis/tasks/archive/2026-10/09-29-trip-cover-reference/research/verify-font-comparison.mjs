import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const out = '.trellis/tasks/09-29-trip-cover-reference/research';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:18799/font-comparison.html');
  await page.evaluate(() => document.fonts.ready);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument');
  const report = [];
  for (let i = 1; i <= 3; i++) {
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: `article:nth-child(${i}) .samples div:first-child` });
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    report.push({ option: i, fonts });
    if (i > 1) { assert.equal(fonts.length, 1); assert.equal(fonts[0].isCustomFont, true); assert.equal(fonts[0].glyphCount, 6); }
  }
  assert.ok(report[0].fonts.some(font => !font.isCustomFont), '当前字体应真实复现苑回退');
  await page.screenshot({ path: `${out}/font-comparison-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: `${out}/font-comparison-mobile.png`, fullPage: true });
  assert.deepEqual(errors, []);
  await fs.writeFile(`${out}/font-comparison-result.json`, JSON.stringify({ passed: true, report, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, report }));
} finally { await browser.close(); }
