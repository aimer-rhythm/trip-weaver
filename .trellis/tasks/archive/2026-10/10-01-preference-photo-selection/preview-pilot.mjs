import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
const dir = path.resolve('.trellis/tasks/archive/2026-10/10-01-preference-photo-selection/research');
const result = JSON.parse(await fs.readFile(path.join(dir, 'pilot-result.json'), 'utf8'));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const old = result.rows.find(p => p.sourceUrl?.includes('2584999'));
const images = [{ photo: old, label: '旧规则样本 · 荷花特写', note: '新版拒绝：无法证明圆明园身份，缺少景点代表性。' }, ...result.cover.photos.map((photo, i) => ({ photo, label: i === 0 ? '新版首图 · 遗址主体' : `新版备选 ${i}`, note: photo.attribution.source }))];
await fs.writeFile(path.join(dir, 'preview.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>圆明园选图规则对比</title><style>body{font:16px/1.6 system-ui,sans-serif;background:#f5f2ed;color:#292c28;margin:0;padding:32px}main{max-width:1120px;margin:auto}h1{font-size:30px;margin:0}p{color:#65665e}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}figure{margin:0;background:white;border-radius:16px;overflow:hidden}img{display:block;width:100%;aspect-ratio:16/9;object-fit:cover}figcaption{padding:16px}strong{display:block}small{color:#666}@media(max-width:600px){body{padding:16px}.grid{grid-template-columns:1fr}}</style><main><h1>圆明园 · 新旧选图对比</h1><p>真实后台视觉审核结果。先核对景点身份，再比较代表性、构图与光线。未修改旧行程。</p><div class="grid">${images.map(({ photo, label, note }) => `<figure><img src="${esc(`http://127.0.0.1:8787${photo.url}`)}" alt="${esc(label)}"><figcaption><strong>${esc(label)}</strong><small>${esc(note)}</small></figcaption></figure>`).join('')}</div><p>新版图库跨源包含 Pexels 与 Commons，署名随每张图片保留。审核仍可能出错，本次为单景点试跑。</p></main></html>`);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(path.join(dir, 'preview.html')).href);
  const decoded = await page.locator('img').evaluateAll(async images => Promise.all(images.map(async image => { await image.decode(); return { width: image.naturalWidth, height: image.naturalHeight }; })));
  if (decoded.some(image => !image.width || !image.height)) throw new Error('image decode failed');
  await page.screenshot({ path: path.join(dir, 'preview.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  if (overflow) throw new Error('mobile overflow');
  await fs.writeFile(path.join(dir, 'browser-result.json'), JSON.stringify({ decoded, mobileOverflow: overflow }, null, 2));
  console.log(JSON.stringify({ decoded: decoded.length, mobileOverflow: overflow, screenshot: path.join(dir, 'preview.png') }));
} finally { await browser.close(); }
