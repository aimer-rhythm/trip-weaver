import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';

const port = 18796;
const base = `http://127.0.0.1:${port}`;
const vite = spawn(process.execPath, ['../../node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port)], { cwd: 'apps/web', windowsHide: true, stdio: 'ignore' });
let browser;
let page;
try {
  for (let i = 0; i < 50; i++) {
    if (await fetch(base).then((r) => r.ok, () => false)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  let trip = { id: 'route-test', title: '北京路线验证', destination: '北京', startDate: '2026-10-01', partySize: 1, preferences: [], budgetLevel: '舒适', totalBudget: 0, extraNotes: '', createdAt: 0, updatedAt: 0, meta: { usedXhs: false, reviewNotes: [] }, days: [{ id: 'd1', dayIndex: 1, title: '第一天', activities: ['故宫', '景山', '北海'].map((name, i) => ({ id: `a${i}`, name, lat: 39.91 + i * .01, lng: 116.39, coordSource: 'manual', coordSystem: 'gcj02', category: '文化', description: '', startTime: '', endTime: '', sourceNotes: [] })), legs: [] }] };
  let calls = 0; let fail = false; let hold; let release;
  const saved = [];
  await page.route(`${base}/api/**`, async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    let data = {};
    if (pathname === '/api/auth/me') data = { id: 'test', email: 'test@example.test' };
    else if (pathname === '/api/usage') data = { remaining: 5, dailyLimit: 5, usedToday: 0 };
    else if (pathname.endsWith('/conversation')) data = { conversationId: null };
    else if (pathname === '/api/settings/config') data = { amapJsKey: '', amapJsSecurityCode: '' };
    else if (pathname.endsWith('/route-options')) {
      calls++;
      if (hold) await hold;
      if (fail) return route.fulfill({ status: 429, json: { error: '今日路线查询额度不足，请稍后再试' } });
      const input = route.request().postDataJSON();
      data = { options: ['walk', 'cycle', 'transit', 'drive'].map((mode, i) => mode === 'cycle' ? { status: 'unavailable', mode, reason: '暂无可用路线' } : { status: 'available', leg: { fromActivityId: input.from.id, toActivityId: input.to.id, mode, source: 'amap', durationMin: 20 - i * 4, distanceM: 1000 + i * 100, polyline: `116.39,39.91;116.4,${39.93 + i * .01}` } }) };
    } else if (pathname === '/api/trips/route-test') {
      if (route.request().method() === 'PUT') {
        const next = route.request().postDataJSON();
        if (saved.length === 0) await new Promise((r) => setTimeout(r, 1200));
        trip = next; saved.push(structuredClone(trip));
      }
      data = trip;
    }
    return route.fulfill({ json: data });
  });
  await page.goto(`${base}/trips/route-test`);
  const summary = page.getByLabel('切换交通方式').first();
  await summary.click();
  await page.getByRole('button', { name: /驾车.*高德/ }).click();
  await page.waitForFunction(() => document.body.textContent.includes('驾车约8 分钟'));
  // Let the first autosave start, then select again; serialized saves must preserve the latest route.
  await page.waitForTimeout(900);
  await summary.click();
  assert.equal(await page.getByRole('button', { name: /骑行/ }).isDisabled(), true);
  await page.getByRole('button', { name: /步行.*高德/ }).click();
  await page.waitForTimeout(2200);
  assert.equal(trip.days[0].legs[0].mode, 'walk');
  assert.equal(calls, 1, 'reopening successful options should not refetch');
  assert.equal(saved.length, 2);
  assert.ok(await page.locator('.leaflet-overlay-pane path').count() >= 2, 'selected polyline rendered');
  await page.reload();
  await page.getByText('步行约20 分钟', { exact: false }).waitFor();
  fail = true;
  await page.getByLabel('切换交通方式').first().click();
  await page.getByRole('alert').filter({ hasText: '额度不足' }).waitFor();
  fail = false;
  await page.getByRole('button', { name: '重新查询' }).click();
  await page.getByRole('button', { name: /驾车.*高德/ }).waitFor();
  // A response arriving after reorder must not become selectable on the changed pair.
  hold = new Promise((r) => { release = r; });
  await page.getByRole('button', { name: '重新查询' }).click();
  await page.getByLabel('故宫更多操作').click();
  await page.getByRole('button', { name: '下移', exact: true }).first().click();
  release(); hold = null;
  await page.waitForTimeout(100);
  assert.equal(await page.getByRole('button', { name: /驾车.*高德/ }).count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel('切换交通方式').first().click();
  await page.getByRole('button', { name: /驾车.*高德/ }).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await fs.mkdir('.trellis/tasks/09-28-route-transport-switch/research', { recursive: true });
  await page.screenshot({ path: '.trellis/tasks/09-28-route-transport-switch/research/mobile-options.png' });
  assert.deepEqual(errors, []);
  console.log('PASS route options: selection, partial failure, save ordering, reload, map, quota retry, stale response, mobile');
} catch (error) {
  console.error(await page?.locator('body').innerText());
  throw error;
} finally {
  await browser?.close();
  vite.kill();
}
