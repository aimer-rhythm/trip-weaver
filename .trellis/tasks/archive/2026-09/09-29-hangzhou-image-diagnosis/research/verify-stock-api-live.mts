import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { config } from 'dotenv';
import { createUnsplashCoverLookup } from '../../../../apps/server/src/integrations/unsplash/cover';
import { createPixabayCoverLookup } from '../../../../apps/server/src/integrations/pixabay/cover';
config({ path: 'apps/server/.env', quiet: true });
const { env } = await import('../../../../apps/server/src/env');
const data = JSON.parse(await fs.readFile('data/photo-pilot/stock-api/latest.json', 'utf8'));
const previous = globalThis.fetch; let cacheRequests = 0;
try {
  globalThis.fetch = async () => { cacheRequests++; throw new Error('cache replay requested network'); };
  const unsplash = createUnsplashCoverLookup(env.unsplashAccessKey, 0);
  const pixabay = createPixabayCoverLookup('', 0);
  assert.deepEqual(await unsplash.cachedPhotosFor(data.query), data.results.find(r => r.source === 'unsplash').photos);
  assert.deepEqual(await pixabay.photosFor(data.query), data.results.find(r => r.source === 'pixabay').photos);
  assert.equal(cacheRequests, 0);
} finally { globalThis.fetch = previous; }
const esc = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const html = `<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>故宫 · 新图源实测</title><style>
*{box-sizing:border-box}body{margin:0;background:#f4f2eb;color:#243731;font:16px/1.7 system-ui,sans-serif}main{max-width:1250px;margin:auto;padding:36px 24px}h1{margin:0}h2{margin-bottom:8px}p{color:#53645e}section{margin-top:32px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}figure{margin:0;background:white;padding:12px;border-radius:12px}img{width:100%;height:245px;object-fit:contain;background:#efefea}figcaption{font-size:12px;overflow-wrap:anywhere}a{color:inherit}small{display:block}.note{font-size:13px}@media(max-width:650px){.grid{grid-template-columns:1fr}main{padding:20px}img{height:240px}}
</style><main><h1>故宫 · 新图源实测</h1><p>同一地点，各源取回并入选3张。以下是真实API结果；现有行程封面尚未替换。</p><p class="note">Unsplash：官方外链＋选用上报。Pixabay：已保存本地。按横版、氛围元数据排序，等待画面审美选择。</p>${data.results.map(r => `<section><h2>${r.source === 'unsplash' ? 'Unsplash' : 'Pixabay'}</h2><div class="grid">${r.photos.map((p, i) => `<figure><img src="${esc(p.url.startsWith('/') ? `http://127.0.0.1:5173${p.url}` : p.url)}" alt="${r.source}故宫候选${i + 1}"><figcaption>候选 ${i + 1} · <a href="${esc(p.attribution.photographerUrl ?? p.attribution.sourceUrl)}" target="_blank" rel="noopener">${esc(p.attribution.photographer)}</a> · <a href="${esc(p.attribution.sourceUrl)}" target="_blank" rel="noopener">${r.source === 'unsplash' ? 'Unsplash' : 'Pixabay'}</a><small><a href="${esc(p.attribution.licenseUrl)}" target="_blank" rel="noopener">${esc(p.attribution.license)}</a> · ${esc(p.attribution.changes)}</small></figcaption></figure>`).join('')}</div></section>`).join('')}</main></html>`;
await fs.writeFile('data/photo-pilot/review/stock-api.html', html);
const out = '.trellis/tasks/09-29-hangzhou-image-diagnosis/research/photo-verification/stock-api';
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const apiRequests: string[] = [], errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (new URL(r.url()).hostname === 'api.unsplash.com' || r.url().includes('pixabay.com/api/')) apiRequests.push(r.url()); });
  await page.goto('http://127.0.0.1:18799/stock-api.html');
  const dimensions = await page.locator('img').evaluateAll(async images => Promise.all(images.map(async img => { await img.decode(); return { width: img.naturalWidth, height: img.naturalHeight }; })));
  assert.equal(dimensions.length, 6); assert.ok(dimensions.every(d => d.width > 0));
  await page.screenshot({ path: `${out}/desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: `${out}/mobile.png`, fullPage: true });
  assert.deepEqual(apiRequests, []); assert.deepEqual(errors, []);
  const report = { passed: true, photos: dimensions.length, dimensions, cacheRequests, viewingApiRequests: apiRequests.length, errors };
  await fs.writeFile(`${out}/result.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { await browser.close(); }
