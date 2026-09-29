import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const port = 18796;
const base = `http://127.0.0.1:${port}`;
const vite = spawn(process.execPath, ['../../node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port)], { cwd: 'apps/web', windowsHide: true, stdio: 'ignore' });
let browser;
try {
  for (let i = 0; i < 50; i++) {
    if (await fetch(base).then(r => r.ok, () => false)) break;
    await new Promise(r => setTimeout(r, 100));
  }
  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const trip = { id: 'share-test', title: '杭州春日漫游', destination: '杭州', startDate: '2026-10-01', partySize: 1, preferences: [], budgetLevel: '舒适', totalBudget: 0, extraNotes: '', createdAt: 0, updatedAt: 0, meta: { usedXhs: false, reviewNotes: [] }, days: [{ id: 'd1', dayIndex: 1, title: '湖畔慢行', activities: [{ id: 'a1', name: '西湖', lat: 30.24, lng: 120.15, coordSource: 'manual', coordSystem: 'gcj02', category: '自然', description: '', startTime: '', endTime: '', sourceNotes: [] }], legs: [] }] };
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 1536;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#eef4ff'; ctx.fillRect(0, 0, 1024, 1536);
    ctx.fillStyle = '#3169ee'; ctx.fillRect(80, 100, 864, 900);
    ctx.fillStyle = '#ffffff'; ctx.font = '64px sans-serif'; ctx.fillText('预览测试图片', 240, 550);
    ctx.fillStyle = '#52647c'; ctx.font = '40px sans-serif'; ctx.fillText('杭州 · 一日行程', 300, 1200);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  let calls = 0;
  let fail = true;
  let release;
  let hold = new Promise(r => { release = r; });
  await page.route(`${base}/api/**`, async route => {
    const pathname = new URL(route.request().url()).pathname;
    let data = {};
    if (pathname === '/api/auth/me') data = { id: 'test', email: 'test@example.test' };
    else if (pathname === '/api/usage') data = { remaining: 5, dailyLimit: 5, usedToday: 0 };
    else if (pathname.endsWith('/conversation')) data = { conversationId: null };
    else if (pathname === '/api/settings/config') data = { amapJsKey: '', amapJsSecurityCode: '' };
    else if (pathname.endsWith('/share-image')) {
      calls++;
      assert.equal(route.request().postDataJSON().trip.title, trip.title);
      if (hold) await hold;
      if (fail) return route.fulfill({ status: 503, json: { error: '生图服务繁忙，请稍后重试' } });
      data = { mimeType: 'image/png', dataUrl: `data:image/png;base64,${png}` };
    } else if (pathname === '/api/trips/share-test') data = trip;
    return route.fulfill({ json: data });
  });
  const open = async () => {
    await page.getByText('导出行程', { exact: true }).click();
    await page.getByRole('button', { name: 'AI 分享图', exact: true }).click();
    await page.getByRole('dialog').waitFor();
  };
  await page.goto(`${base}/trips/share-test`);
  await open();
  assert.equal(calls, 0, 'opening alone never purchases generation');
  await page.getByRole('button', { name: '生成分享图', exact: true }).click();
  await page.getByRole('button', { name: '生成中…' }).waitFor();
  assert.equal(await page.getByRole('button', { name: '生成中…' }).isDisabled(), true);
  await page.getByRole('button', { name: '稍后查看' }).click();
  await open();
  assert.equal(calls, 1);
  release(); hold = null;
  await page.getByRole('alert').waitFor();
  await page.getByRole('button', { name: '重试生成' }).waitFor();
  const screenshots = path.join(os.tmpdir(), 'tripweaver-share-image');
  await fs.mkdir(screenshots, { recursive: true });
  await page.screenshot({ path: path.join(screenshots, 'desktop-error.png') });
  fail = false;
  await page.getByRole('button', { name: '重试生成' }).click();
  await page.getByRole('button', { name: '下载图片' }).waitFor();
  assert.equal(calls, 2);
  assert.equal(await page.getByRole('alert').count(), 0);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载图片' }).click();
  assert.match((await download).suggestedFilename(), /AI分享图\.png$/);
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).last().click();
  await page.setViewportSize({ width: 390, height: 844 });
  await open();
  assert.equal(calls, 2, 'reopening completed result does not regenerate');
  const dialog = await page.getByRole('dialog').boundingBox();
  assert.ok(dialog.x >= 0 && dialog.x + dialog.width <= 390);
  assert.equal(await page.getByRole('dialog').evaluate(el => el.scrollWidth <= el.clientWidth), true);
  await page.screenshot({ path: path.join(screenshots, 'mobile-ready.png') });
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).last().click();
  await page.getByText('导出行程', { exact: true }).click();
  const jsonDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'JSON 备份', exact: true }).click();
  assert.equal(JSON.parse(await fs.readFile(await (await jsonDownload).path(), 'utf8')).trip.id, trip.id);
  await page.evaluate(() => { window.printCount = 0; window.print = () => { window.printCount++; }; });
  await page.getByText('导出行程', { exact: true }).click();
  await page.getByRole('button', { name: '打印 / PDF', exact: true }).click();
  assert.equal(await page.evaluate(() => window.printCount), 1);
  await page.emulateMedia({ media: 'print' });
  assert.equal(await page.locator('.print-host .pv').evaluate(el => getComputedStyle(el).visibility), 'visible');
  assert.deepEqual(errors, []);
  console.log(`PASS AI sharing: explicit start, loading, close/reopen, retry, preview, download, mobile bounds. Screenshots: ${screenshots}`);
} finally { await browser?.close(); vite.kill(); }
