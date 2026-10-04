// 只读真实行程与审核图库，用隔离API回放验证真实前端；不读取/伪造用户登录凭据。
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { config } from 'dotenv';
import { chromium } from 'playwright';
import { enrichTripPhotos } from '../../../../apps/server/src/services/tripPhotoService';
import { createSelectedPhotoLibrary, selectedFirstLookup } from '../../../../apps/server/src/integrations/selectedPhotos';
import { createReviewedCoverLookup } from '../../../../apps/server/src/integrations/reviewedPhotos';
config({ path: 'apps/server/.env', quiet: true });
config({ quiet: true });
const dir = '.trellis/tasks/10-04-photo-backfill/research';
await mkdir(dir, { recursive: true });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const id = '7f08cd83-001e-4ff1-afa1-640e572727e7';
const { rows: [row] } = await pool.query('select data from trips where id=$1', [id]);
await pool.end();
assert.ok(row);
const options = { mediaBase: process.env.MEDIA_BASE_URL ?? '/media', unsplashKey: process.env.UNSPLASH_ACCESS_KEY };
const selected = createSelectedPhotoLibrary(row.data.destination, options);
const misses: string[] = [];
const enriched = await enrichTripPhotos(row.data, selectedFirstLookup(selected,
  createReviewedCoverLookup(row.data.destination, { ...options, acceptPhoto: selected.acceptSupplement }),
  async name => { misses.push(name); }));
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true, args: ['--no-proxy-server'] });
const result = { mode: '真实行程/审核图库/前端与图片，隔离API回放', pictures: [] as object[],
  missing: misses, errors: [] as string[], requests: [] as string[], tripWrites: 0, storedPhotos: row.data.overview.filter(p => p.coverUrl).length };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', e => result.errors.push(e.message));
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const url = new URL(route.request().url());
    if (route.request().method() !== 'GET') {
      result.requests.push(`${route.request().method()} ${url.pathname}`);
      if (['PUT', 'PATCH', 'DELETE'].includes(route.request().method())) result.tripWrites++;
    }
    let data: unknown = {};
    if (url.pathname === '/api/auth/me') data = { id: 'fixture', email: 'photo@example.test' };
    else if (url.pathname === `/api/trips/${id}`) data = enriched;
    else if (url.pathname.endsWith('/versions')) data = { rootId: id, versions: [{ id, version: 1, title: enriched.title, createdAt: enriched.createdAt }] };
    else if (url.pathname.endsWith('/conversation')) data = { conversationId: null };
    else if (url.pathname === '/api/settings/travel-preferences') data = { preferences: [], transportMode: 'transit', extraNotes: '' };
    else if (url.pathname === '/api/usage') data = { remaining: 2, dailyLimit: 10 };
    else if (url.pathname === '/api/settings/config') data = { amapJsKey: '', amapJsSecurityCode: '' };
    await route.fulfill({ json: { code: 0, message: 'ok', data } });
  });
  await page.goto(`http://localhost:5173/trips/${id}`);
  await page.getByRole('group', { name: '行程天数' }).waitFor();
  await page.screenshot({ path: `${dir}/hangzhou-desktop.png` });
  for (const poi of enriched.overview ?? []) {
    if (!poi.coverUrl) continue;
    const day = enriched.days.find(d => d.activities.some(a => a.name === poi.name));
    if (day) await page.getByRole('group', { name: '行程天数' }).getByRole('button', { name: `第${day.dayIndex}天`, exact: true }).click();
    const trigger = page.getByRole('button', { name: `查看${poi.name}完整照片`, exact: true });
    await trigger.scrollIntoViewIfNeeded();
    const width = await trigger.locator('img').evaluate(async image => { await image.decode(); return image.naturalWidth; });
    assert.ok(width > 0);
    result.pictures.push({ name: poi.name, width });
    if (result.pictures.length === 1) {
      await trigger.click();
      const dialog = page.getByRole('dialog', { name: `${poi.name} · 完整照片`, exact: true });
      await dialog.locator('.poi-photo-expanded').evaluate(image => image.decode());
      await page.screenshot({ path: `${dir}/hangzhou-photo-preview.png` });
      await page.keyboard.press('Escape');
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${dir}/hangzhou-mobile.png` });
  assert.deepEqual(result.errors, []);
  assert.equal(result.tripWrites, 0);
  console.log(JSON.stringify({ ...result, requests: [...new Set(result.requests)] }));
} finally {
  await writeFile(`${dir}/browser-result.json`, JSON.stringify(result, null, 2));
  await browser.close();
}
