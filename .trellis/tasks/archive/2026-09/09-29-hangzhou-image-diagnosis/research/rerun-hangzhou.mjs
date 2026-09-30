// 用原行程参数调用真实生成 API；临时会话仅用于本次授权验收，不输出令牌。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import pg from 'pg';
import { chromium } from 'playwright';
import { createReplayConversation } from './replay-conversation.mjs';

const out = path.resolve(process.argv[2] || '.trellis/tasks/09-29-hangzhou-image-diagnosis/research/live-hangzhou');
fs.mkdirSync(out, { recursive: true });
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const sessionId = randomUUID();
const token = randomBytes(32).toString('hex');
const headers = { Cookie: `tw_session=${token}`, 'Content-Type': 'application/json' };
let browser;
try {
  const original = (await client.query('SELECT user_id,data FROM trips WHERE id=$1', ['0552c0b3-6446-48b9-bf4b-9a11699ce669'])).rows[0];
  assert.ok(original);
  const trip = original.data;
  const form = Object.fromEntries(['destination', 'startDate', 'budgetLevel', 'totalBudget', 'preferences', 'partySize', 'extraNotes', 'transportMode'].filter(k => trip[k] !== undefined).map(k => [k, trip[k]]));
  form.days = trip.days.length;
  await client.query('INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at) VALUES ($1,$2,$3,$4,$5)',
    [sessionId, original.user_id, createHash('sha256').update(token).digest('hex'), new Date(Date.now() + 3600000), new Date()]);
  let job;
  const report = { originalTripId: trip.id, form, startedAt: new Date().toISOString() };
  if (process.argv[3]) {
    job = { status: 'done', tripId: process.argv[3] };
    report.mode = 'verify-existing';
  } else {
  report.conversationId = await createReplayConversation(headers, form, trip.id);
  const start = await fetch('http://127.0.0.1:8787/api/generations', { method: 'POST', headers, body: JSON.stringify({ ...form, conversationId: report.conversationId }) });
  const started = await start.json();
  assert.equal(start.status, 202, JSON.stringify(started));
  report.jobId = started.jobId;
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ jobId: started.jobId, status: 'running' }));
  for (let count = 0; count < 120; count++) {
    const response = await fetch(`http://127.0.0.1:8787/api/generations/${started.jobId}`, { headers });
    assert.equal(response.status, 200);
    job = await response.json();
    report.job = job;
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ jobId: started.jobId, status: job.status, phase: job.phase }));
    if (job.status !== 'running') break;
    await new Promise(resolve => setTimeout(resolve, 10000));
  }
  }
  assert.equal(job.status, 'done', JSON.stringify(job));
  assert.ok(job.tripId, '生成成功必须返回 tripId');
  const dataResponse = await fetch(`http://127.0.0.1:8787/api/trips/${job.tripId}`, { headers });
  assert.equal(dataResponse.status, 200);
  const generated = await dataResponse.json();
  const conversationResponse = await fetch(`http://127.0.0.1:8787/api/trips/${job.tripId}/conversation`, { headers });
  assert.equal(conversationResponse.status, 200);
  const association = await conversationResponse.json();
  assert.ok(association.conversationId, '验收行程必须保留详情页对话入口');
  report.conversationId ??= association.conversationId;
  assert.equal(association.conversationId, report.conversationId);
  const conversationDetail = await (await fetch(`http://127.0.0.1:8787/api/conversations/${association.conversationId}`, { headers })).json();
  assert.equal(conversationDetail.latestTrip?.id, job.tripId, '对话修订必须指向这份新行程');
  fs.writeFileSync(path.join(out, 'trip.json'), JSON.stringify(generated, null, 2));
  report.covers = await Promise.all(generated.overview.filter(p => p.coverUrl).map(async poi => {
    try {
      const r = await fetch(new URL(poi.coverUrl, 'http://127.0.0.1:5173'), { signal: AbortSignal.timeout(20000) });
      return { name: poi.name, url: poi.coverUrl, status: r.status, type: r.headers.get('content-type'), bytes: (await r.arrayBuffer()).byteLength };
    } catch (e) { return { name: poi.name, url: poi.coverUrl, error: e.message }; }
  }));
  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await context.addCookies([{ name: 'tw_session', value: token, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' }]);
  const page = await context.newPage();
  const pageErrors = [];
  const photoRequests = [];
  page.on('request', request => {
    if (request.resourceType() === 'image' && /pexels\.com|wikimedia\.org|staticflickr\.com|xhscdn\.com/.test(new URL(request.url()).hostname)) photoRequests.push(request.url());
  });
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.goto(`http://127.0.0.1:5173/trips/${job.tripId}`);
  await page.getByRole('group', { name: '行程天数' }).waitFor({ timeout: 30000 });
  await page.getByRole('complementary', { name: '旅行助手' }).getByRole('textbox', { name: '输入你的行程想法' }).waitFor();
  report.browserDays = [];
  report.galleries = [];
  for (let day = 1; day <= generated.days.length; day++) {
    await page.getByRole('group', { name: '行程天数' }).getByRole('button', { name: `第${day}天`, exact: true }).click();
    await page.waitForTimeout(1500);
    const pictures = await page.locator('img').evaluateAll(async images => Promise.all(images.map(async img => {
      try { await img.decode(); } catch {}
      return { alt: img.alt, src: img.currentSrc || img.src, width: img.naturalWidth, height: img.naturalHeight };
    })));
    report.browserDays.push({ day, pictures });
    await page.screenshot({ path: path.join(out, `day-${day}.png`), fullPage: true });
    for (const poi of generated.overview.filter(p => p.photos?.length > 1)) {
      const trigger = page.getByRole('button', { name: `查看${poi.name}完整照片`, exact: true });
      if (!await trigger.count()) continue;
      await trigger.click();
      const gallery = page.getByRole('dialog', { name: `${poi.name} · 完整照片`, exact: true });
      assert.equal(await gallery.getByRole('group', { name: '选择照片' }).getByRole('button').count(), poi.photos.length);
      for (const [index, photo] of poi.photos.entries()) {
        await gallery.getByRole('button', { name: `查看第${index + 1}张照片`, exact: true }).click();
        const image = gallery.locator('.poi-photo-expanded');
        await image.evaluate(img => img.decode());
        assert.equal(await image.getAttribute('src'), photo.url);
        if (photo.attribution) assert.ok((await gallery.locator('.photo-credit').textContent()).includes(photo.attribution.photographer));
        if (poi.name === '雷峰塔') await page.screenshot({ path: path.join(out, `gallery-leifeng-${index + 1}.png`) });
      }
      report.galleries.push({ name: poi.name, photos: poi.photos.length });
      await page.keyboard.press('Escape');
      assert.equal(await trigger.locator('img').getAttribute('src'), poi.coverUrl);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('group', { name: '行程天数' }).getByRole('button', { name: '第1天', exact: true }).click();
  await page.waitForTimeout(600);
  report.mobile = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > innerWidth,
    credits: [...document.querySelectorAll('.photo-credit')].map(p => p.textContent),
  }));
  await page.screenshot({ path: path.join(out, 'mobile-day-1.png'), fullPage: true });
  const mobilePhoto = page.getByRole('button', { name: '查看雷峰塔完整照片', exact: true });
  if (await mobilePhoto.count()) {
    await mobilePhoto.click();
    const gallery = page.getByRole('dialog', { name: '雷峰塔 · 完整照片', exact: true });
    await gallery.getByRole('button', { name: '下一张照片', exact: true }).click();
    await gallery.locator('.poi-photo-expanded').evaluate(img => img.decode());
    await page.screenshot({ path: path.join(out, 'mobile-gallery.png') });
    await page.keyboard.press('Escape');
  }
  assert.equal(report.mobile.overflow, false);
  await page.getByRole('button', { name: '对话', exact: true }).click();
  const chatInput = page.getByRole('textbox', { name: '输入你的行程想法' });
  await chatInput.waitFor();
  assert.equal(await chatInput.isEnabled(), true);
  await page.screenshot({ path: path.join(out, 'mobile-chat.png'), fullPage: true });
  report.chat = { desktopVisible: true, mobileVisible: true, targetTripId: conversationDetail.latestTrip.id };
  report.pageErrors = pageErrors;
  report.externalPhotoRequests = photoRequests;
  if (generated.overview.every(p => !p.coverUrl || p.coverUrl.startsWith('/media/'))) assert.deepEqual(photoRequests, [], '本地照片浏览不访问原图源');
  report.finishedAt = new Date().toISOString();
  const failedResponses = report.covers.filter(x => x.status !== 200 || !x.type?.startsWith('image/'));
  const failedDecodes = report.browserDays.flatMap(day => day.pictures.filter(img => img.width === 0 && generated.overview.some(p => p.name === img.alt)));
  report.validation = { passed: failedResponses.length === 0 && failedDecodes.length === 0 && pageErrors.length === 0,
    failedResponses, failedDecodes };
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(report, null, 2));
  assert.equal(report.validation.passed, true, '图片 HTTP 或浏览器解码未通过；详见 result.json');
  console.log(JSON.stringify({ tripId: job.tripId, covers: report.covers.length, localCovers: report.covers.filter(x => x.url.startsWith('/media/')).length, pageErrors }));
} finally {
  await browser?.close();
  await client.query('DELETE FROM sessions WHERE id=$1', [sessionId]);
  await client.end();
}
