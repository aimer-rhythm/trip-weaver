// 仅访问本任务的只读隔离预览，更新用户验收截图。
import { chromium } from 'playwright';
import { copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const output = new URL('./after/', import.meta.url);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-proxy-server'] });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await page.goto('http://127.0.0.1:5175/');
  await page.getByRole('button', { name: '选择杭州', exact: true }).click();
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map(img => img.decode().catch(() => {})));
    await Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})));
  });
  await page.mouse.click(10, 150);
  await page.screenshot({ path: fileURLToPath(new URL('home-ready.png', output)) });
  await page.getByRole('button', { name: /^目的地/ }).click();
  await page.getByRole('dialog', { name: '选择目的地' }).waitFor();
  await page.evaluate(async () => {
    await Promise.all([...document.images].map(img => img.decode().catch(() => {})));
  });
  await page.screenshot({ path: fileURLToPath(new URL('destination.png', output)) });
  for (const [source, target] of Object.entries({ 'home-390.png': 'home.png', 'date-390.png': 'date.png', 'preferences-390.png': 'preferences.png', 'home-1440.png': 'desktop.png', 'results.json': 'results.json' })) {
    await copyFile(new URL(`../../../../data/home-mobile-verification/${source}`, import.meta.url), new URL(target, output));
  }
} finally {
  await browser.close();
}
