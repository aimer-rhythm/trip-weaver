// 用户授权的真实北京行程；复用此前北京样片所属账户，短期测试会话在退出时删除。
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { parseArgs } from 'node:util';
import { parse } from 'dotenv';
import pg from 'pg';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const { values, positionals } = parseArgs({ options: { days: { type: 'string', default: '3' } }, allowPositionals: true });
const testDays = Number(values.days);
assert.ok([3, 7].includes(testDays), '本测试仅支持已授权的3日或7日行程');
const out = path.join(here, `verification/beijing-${testDays === 7 ? 'seven' : 'three'}-days`);
await fs.mkdir(out, { recursive: true });
const config = parse(await fs.readFile('apps/server/.env', 'utf8'));
const db = new pg.Client({ connectionString: config.DATABASE_URL });
const api = 'http://127.0.0.1:8787', web = 'http://127.0.0.1:5173';
const sessionId = randomUUID(), token = randomBytes(32).toString('hex');
const headers = { Cookie: `tw_session=${token}` };
const form = { destination: '北京', days: testDays, startDate: '2026-10-02', budgetLevel: '舒适', totalBudget: 0,
  preferences: [], partySize: 2, extraNotes: '第一次来北京，以经典景点为主，节奏适中。', pace: 'moderate', transportMode: 'transit' };
const events = [], errors = [], writes = [], galleries = [], missingCards = [];
let browser, trip, jobId;
await db.connect();
try {
  const owner = (await db.query('SELECT user_id FROM trips WHERE id=$1', ['5dee10b5-b395-48cd-8fb9-470d4b9e4280'])).rows[0];
  assert.ok(owner, '此前北京样片账户锚点必须存在');
  await db.query('INSERT INTO sessions(id,user_id,token_hash,expires_at,created_at) VALUES($1,$2,$3,$4,$5)',
    [sessionId, owner.user_id, createHash('sha256').update(token).digest('hex'), new Date(Date.now() + 3600000), new Date()]);
  const request = (url, options = {}) => fetch(`${api}${url}`, { ...options, headers: { ...headers, ...options.headers }, signal: AbortSignal.timeout(30000) });
  const resumeTripId = positionals[0];
  if (!resumeTripId) {
    const response = await request('/api/generations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    const started = await response.json();
    assert.equal(response.status, 202, JSON.stringify(started));
    jobId = started.jobId;
    await fs.writeFile(path.join(out, 'run.json'), JSON.stringify({ jobId, form, startedAt: new Date().toISOString() }, null, 2));
    console.log(JSON.stringify({ jobId, stage: '已启动真实生成', form }));
    const stream = await fetch(`${api}/api/generations/${jobId}/events`, { headers, signal: AbortSignal.timeout(960000) });
    assert.equal(stream.status, 200);
    let pending = '';
    const decoder = new StringDecoder('utf8');
    for await (const bytes of stream.body) {
      pending += decoder.write(Buffer.from(bytes));
      let split;
      while ((split = pending.indexOf('\n\n')) >= 0) {
        const block = pending.slice(0, split); pending = pending.slice(split + 2);
        const line = block.split('\n').find(l => l.startsWith('data: '));
        if (!line) continue;
        const event = JSON.parse(line.slice(6)); events.push(event);
        if (['phase_start', 'phase_end', 'tool_start', 'candidate', 'job_done', 'job_error', 'job_cancelled'].includes(event.type)) {
          console.log(JSON.stringify({ type: event.type, phase: event.phase, label: event.label, name: event.poi?.name,
            image: event.poi?.coverUrl, source: event.poi?.coverAttribution?.source, tripId: event.tripId, message: event.message }));
        }
        await fs.writeFile(path.join(out, 'events.json'), JSON.stringify(events, null, 2));
      }
    }
    const state = await (await request(`/api/generations/${jobId}`)).json();
    assert.equal(state.status, 'done', JSON.stringify(state));
    trip = await (await request(`/api/trips/${state.tripId}`)).json();
  } else {
    jobId = JSON.parse(await fs.readFile(path.join(out, 'run.json'), 'utf8')).jobId;
    const response = await request(`/api/trips/${encodeURIComponent(resumeTripId)}`);
    assert.equal(response.status, 200); trip = await response.json();
  }
  assert.equal(trip.days.length, testDays);
  await fs.writeFile(path.join(out, 'trip.json'), JSON.stringify(trip, null, 2));
  const attractions = trip.overview.filter(p => p.category === 'attraction');
  console.log(JSON.stringify({ stage: '生成完成，检查实际图片', tripId: trip.id, title: trip.title,
    attractions: attractions.map(p => ({ name: p.name, cover: p.coverUrl, source: p.coverAttribution?.source, photos: p.photos?.length ?? 0 })) }));
  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await context.addCookies([{ name: 'tw_session', value: token, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' }]);
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', req => { if (['PUT', 'PATCH', 'DELETE'].includes(req.method())) writes.push({ method: req.method(), url: req.url() }); });
  await page.goto(`${web}/trips/${trip.id}`);
  const days = page.getByRole('group', { name: '行程天数' });
  await days.waitFor();
  await page.evaluate(() => document.fonts.ready);
  for (let day = 1; day <= testDays; day++) {
    await days.getByRole('button', { name: `第${day}天`, exact: true }).click();
    for (const [index, poi] of attractions.entries()) {
      const activity = page.getByRole('article', { name: poi.name, exact: true });
      if (!poi.coverUrl && await activity.count()) {
        await activity.scrollIntoViewIfNeeded();
        assert.equal(await activity.locator('.poi-photo-trigger, img').count(), 0);
        await activity.screenshot({ path: path.join(out, `missing-${index}.png`) });
        missingCards.push({ day, name: poi.name, display: 'text-only' });
      }
      const trigger = page.getByRole('button', { name: `查看${poi.name}完整照片`, exact: true });
      if (!await trigger.count()) continue;
      await trigger.scrollIntoViewIfNeeded();
      await trigger.locator('img').evaluate(img => img.decode());
      const images = poi.photos?.length ? poi.photos : [{ url: poi.coverUrl, attribution: poi.coverAttribution }];
      await trigger.screenshot({ path: path.join(out, `card-${index}.png`) });
      await trigger.click();
      const dialog = page.getByRole('dialog', { name: `${poi.name} · 完整照片`, exact: true });
      await dialog.waitFor();
      for (const [n, photo] of images.entries()) {
        if (images.length > 1) await dialog.getByRole('button', { name: `查看第${n + 1}张照片`, exact: true }).click();
        const expanded = dialog.locator('.poi-photo-expanded');
        await expanded.evaluate(img => img.decode());
        assert.equal(await expanded.getAttribute('src'), photo.url);
        if (photo.attribution) assert.ok((await dialog.locator('.photo-credit').textContent()).includes(photo.attribution.photographer));
        if (n === 0) await expanded.screenshot({ path: path.join(out, `photo-${index}.png`) });
      }
      galleries.push({ day, name: poi.name, photos: images.length, source: poi.coverAttribution?.source ?? null });
      await page.screenshot({ path: path.join(out, `gallery-${index}.png`) });
      await page.keyboard.press('Escape');
    }
    await page.evaluate(() => { for (const el of document.querySelectorAll('*')) if (el.scrollHeight > el.clientHeight) el.scrollTop = 0; });
    await page.screenshot({ path: path.join(out, `day-${day}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await days.getByRole('button', { name: '第1天', exact: true }).click();
  await page.screenshot({ path: path.join(out, 'mobile-day-1.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  const mobileTrigger = page.getByRole('button', { name: /完整照片$/ }).first();
  if (await mobileTrigger.count()) {
    await mobileTrigger.scrollIntoViewIfNeeded(); await mobileTrigger.click();
    await page.getByRole('dialog').locator('.poi-photo-expanded').evaluate(img => img.decode());
    await page.screenshot({ path: path.join(out, 'mobile-gallery.png') });
    await page.keyboard.press('Escape');
  }
  const after = await (await request(`/api/trips/${trip.id}`)).json();
  assert.deepEqual(after, trip, '图片查看不得修改行程');
  assert.deepEqual(errors, []); assert.deepEqual(writes, []);
  const plannedNames = new Set(trip.days.flatMap(day => day.activities.map(activity => activity.name)));
  const scheduled = attractions.filter(poi => plannedNames.has(poi.name));
  assert.deepEqual(new Set(galleries.map(g => g.name)), new Set(scheduled.filter(p => p.coverUrl).map(p => p.name)));
  const sourceCounts = {};
  for (const poi of scheduled) for (const photo of poi.photos?.length ? poi.photos : (poi.coverUrl ? [{ attribution: poi.coverAttribution }] : [])) {
    const source = photo.attribution?.source ?? '未标注';
    sourceCounts[source] = (sourceCounts[source] ?? 0) + 1;
  }
  const result = { tripId: trip.id, title: trip.title, url: `${web}/trips/${trip.id}`, jobId,
    attractionCount: attractions.length, covered: attractions.filter(p => p.coverUrl).length,
    galleries, missing: attractions.filter(p => !p.coverUrl).map(p => p.name), missingCards, errors, writes,
    scheduledAttractionCount: scheduled.length, scheduledCovered: scheduled.filter(p => p.coverUrl).length,
    verifiedPhotos: galleries.reduce((n, gallery) => n + gallery.photos, 0), sourceCounts,
    missingAttribution: scheduled.filter(p => p.coverUrl && !p.coverAttribution).map(p => p.name),
    curatedPlaces: scheduled.filter(p => p.coverUrl?.startsWith('/media/photography/')).map(p => p.name),
    pixabayUnsplashSelectionObserved: Boolean(sourceCounts.pixabay || sourceCounts.unsplash) };
  await fs.writeFile(path.join(out, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser?.close();
  await db.query('DELETE FROM sessions WHERE id=$1', [sessionId]);
  await db.end();
}
