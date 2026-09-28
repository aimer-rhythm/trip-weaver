import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 660 } });
  await page.goto('http://127.0.0.1:5173');
  await page.waitForSelector('#root > *');
  await page.evaluate(async () => {
    document.body.innerHTML = `<div style="padding:24px;background:#f1f7ff;color:#1a365d">${['KingHwa OldSong', 'Noto Serif SC Variable', 'SimSun'].map(font => `<div style="margin-bottom:22px"><p style="font:16px sans-serif">${font}</p><div style="font:600 42px '${font}'">正在为你编织 北京 的 4 天旅程…</div><div style="font:600 28px '${font}';margin-top:12px">1. 搜罗全城 · 调研灵感</div></div>`).join('')}</div>`;
    await document.fonts.ready;
  });
  await page.screenshot({ path: '.trellis/tasks/09-27-gen-page-visual-align/research/title-font-comparison.png' });
} finally { await browser.close(); }
