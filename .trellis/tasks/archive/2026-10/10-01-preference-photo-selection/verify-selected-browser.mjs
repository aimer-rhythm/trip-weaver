// 内置浏览器不可用时使用独立测试浏览器；拦截全部API，不写入真实行程。
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const output = path.resolve('.trellis/tasks/archive/2026-10/10-01-preference-photo-selection/research');
const replay = JSON.parse(await fs.readFile(path.join(output, 'selected-replay-result.json'), 'utf8'));
const trip = {
  id: 'selected-photo-verification', title: '北京已选照片验收', destination: '北京', startDate: '2026-10-02',
  partySize: 2, preferences: [], budgetLevel: '舒适', totalBudget: 0, extraNotes: '', createdAt: 0, updatedAt: 0,
  meta: { usedXhs: false, reviewNotes: [] }, overview: replay.rows,
  days: [{ id: 'day-1', dayIndex: 1, title: '核验真实选图和逐图署名', legs: [], activities: replay.rows.map((poi, i) => ({
    id: `activity-${i}`, name: poi.name, poiId: poi.id, category: '文化', description: '已选照片验收预览',
    lat: 0, lng: 0, startTime: '', endTime: '', sourceNotes: [],
  })) }],
};
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const result = { mode: '独立浏览器，真实前端与图片、隔离API行程夹具', decoded: [], galleries: [], writes: 0, pageErrors: [], mobileOverflow: null };
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, reducedMotion: 'reduce' });
  page.on('pageerror', error => result.pageErrors.push(error.message));
  await page.goto(pathToFileURL(path.join(output, 'selected-preview.html')).href);
  result.decoded = await page.locator('img').evaluateAll(async images => Promise.all(images.map(async image => {
    try { await image.decode(); return { name: image.alt, url: image.src, width: image.naturalWidth, height: image.naturalHeight }; }
    catch { return { name: image.alt, url: image.src, width: 0, height: 0 }; }
  })));
  assert.ok(result.decoded.every(image => image.width > 0 && image.height > 0), JSON.stringify(result.decoded.filter(image => !image.width)));
  await page.screenshot({ path: path.join(output, 'selected-preview-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  result.mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert.equal(result.mobileOverflow, false);
  await page.screenshot({ path: path.join(output, 'selected-preview-mobile.png') });

  await page.route(/^http:\/\/127\.0\.0\.1:5173\/api\//, route => {
    const url = new URL(route.request().url());
    if (route.request().method() !== 'GET') result.writes++;
    let data = {};
    if (url.pathname === '/api/auth/me') data = { id: 'fixture', email: 'photo@example.test' };
    else if (url.pathname === '/api/usage') data = { remaining: 2, dailyLimit: 10 };
    else if (url.pathname === '/api/settings/config') data = { amapJsKey: '', amapJsSecurityCode: '' };
    else if (url.pathname.endsWith('/conversation')) data = { conversationId: 'selected-photo-chat' };
    else if (url.pathname === '/api/conversations/selected-photo-chat') data = { messages: [] };
    else if (url.pathname === '/api/trips/selected-photo-verification') data = trip;
    return route.fulfill({ json: data });
  });
  await page.goto('http://127.0.0.1:5173/trips/selected-photo-verification');
  await page.getByRole('group', { name: '行程天数' }).waitFor();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    for (const name of ['故宫博物院', '雍和宫', '圆明园', '天坛公园', '南锣鼓巷']) {
      const poi = replay.rows.find(row => row.name === name);
      const trigger = page.getByRole('button', { name: `查看${name}完整照片`, exact: true });
      await trigger.scrollIntoViewIfNeeded();
      await trigger.locator('img').evaluate(image => image.decode());
      assert.equal(await trigger.locator('img').getAttribute('src'), poi.coverUrl);
      if (name === '故宫博物院') await page.screenshot({ path: path.join(output, `selected-editor-${width}.png`) });
      await trigger.click();
      const dialog = page.getByRole('dialog', { name: `${name} · 完整照片`, exact: true });
      await dialog.waitFor();
      const count = poi.photos.length;
      if (count > 1) assert.equal(await dialog.getByRole('group', { name: '选择照片' }).getByRole('button').count(), count);
      else assert.equal(await dialog.getByRole('group', { name: '选择照片' }).count(), 0);
      for (let i = 0; i < count; i++) {
        if (i > 0) await dialog.getByRole('button', { name: '下一张照片', exact: true }).click();
        const image = dialog.locator('.poi-photo-expanded');
        await image.evaluate(image => image.decode());
        assert.equal(await image.getAttribute('src'), poi.photos[i].url);
        const credit = poi.photos[i].attribution;
        if (credit) {
          assert.ok((await dialog.locator('.photo-credit').textContent()).includes(credit.photographer));
          const links = await dialog.locator('.photo-credit a').evaluateAll(links => links.map(link => link.getAttribute('href')));
          assert.ok(links.includes(credit.sourceUrl));
          assert.ok(links.includes(credit.licenseUrl));
        } else assert.equal(await dialog.locator('.photo-credit').count(), 0);
      }
      const box = await dialog.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width + 1);
      if (name === '故宫博物院') await page.screenshot({ path: path.join(output, `selected-gallery-${width}.png`) });
      await page.keyboard.press('Escape');
      assert.equal(await trigger.locator('img').getAttribute('src'), poi.coverUrl);
      result.galleries.push({ width, name, count, creditsFollowPhoto: true, coverUnchanged: true });
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  }
  assert.equal(result.writes, 0);
  assert.deepEqual(result.pageErrors, []);
  result.passed = true;
  console.log(JSON.stringify({ decoded: result.decoded.length, galleries: result.galleries.length, writes: result.writes, passed: true }));
} finally {
  await fs.writeFile(path.join(output, 'selected-browser-result.json'), JSON.stringify(result, null, 2) + '\n');
  await browser.close();
}
