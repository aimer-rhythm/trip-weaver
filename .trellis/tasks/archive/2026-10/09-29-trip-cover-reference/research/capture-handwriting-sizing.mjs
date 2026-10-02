import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const stage = process.argv[2] ?? 'before';
const out = path.resolve(`.trellis/tasks/09-29-trip-cover-reference/research/font-sizing/${stage}`);
await fs.mkdir(out, { recursive: true });
const trip = JSON.parse(await fs.readFile('.trellis/tasks/09-29-trip-cover-reference/research/youran-verification/beijing-current.json', 'utf8'));
trip.days[0].title = '沿着中轴线，走进老北京';
let empty = false;
const rows = ['北京', '杭州', '成都', '上海', '北京', '大理'].map((destination, i) => ({ id: `sizing-${i}`, destination, title: '城市漫游手记', daysCount: i + 2, activityCount: 12, version: 1, totalCost: 0, usedXhs: false, createdAt: 0, updatedAt: 0 }));
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1672, height: 941 }, reducedMotion: 'reduce' });
  const metrics = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400 && /\/src\//.test(response.url())) console.error(response.status(), response.url()); });
  await page.route('http://127.0.0.1:5173/api/**', async route => {
    const p = new URL(route.request().url()).pathname;
    if (p.endsWith('/route-options')) return route.fulfill({ status: 503, json: { error: 'Sizing fixture' } });
    let data = {};
    if (p === '/api/auth/me') data = { id: 'sizing', email: 'sizing@example.test' };
    else if (p === '/api/usage') data = { remaining: 2, dailyLimit: 4 };
    else if (p === '/api/settings/config') data = { amapJsKey: '', amapJsSecurityCode: '' };
    else if (p === '/api/destinations/covered') data = [];
    else if (p === '/api/trips') data = empty ? [] : rows;
    else if (p === `/api/trips/${trip.id}`) data = trip;
    else if (p.endsWith('/conversation')) data = { conversationId: 'sizing-chat' };
    else if (p === '/api/conversations/sizing-chat') data = { messages: [] };
    return route.fulfill({ json: data });
  });
  const ready = async () => page.evaluate(async () => { await document.fonts.ready; await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); });
  async function capture(name, selector) {
    const node = page.locator(selector).first();
    await node.waitFor().catch(async error => {
      console.log(JSON.stringify({ errors, body: await page.locator('body').innerText() }));
      await page.screenshot({ path: path.join(out, 'failure.png') }); throw error;
    }); await ready();
    metrics.push(await node.evaluate((el, name) => {
      const style = getComputedStyle(el), b = el.getBoundingClientRect();
      const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
      ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const copy = el.cloneNode(true);
      copy.querySelector('.collection-count')?.remove();
      const text = name.startsWith('subtitle') ? copy.textContent.trim() : el.childNodes[0]?.nodeType === Node.TEXT_NODE ? el.childNodes[0].textContent.trim() : el.textContent.trim();
      const m = ctx.measureText(text);
      return { name, text, fontSize: style.fontSize, fontFamily: style.fontFamily, lineHeight: style.lineHeight, letterSpacing: style.letterSpacing,
        inkHeight: m.actualBoundingBoxAscent + m.actualBoundingBoxDescent, advance: m.width, bounds: { width: b.width, height: b.height }, viewport: innerWidth };
    }, name));
    await node.screenshot({ path: path.join(out, `${name}.png`) });
  }
  await page.goto(`http://127.0.0.1:5173/trips/${trip.id}`);
  await capture('heading', '.day-head h2');
  await page.screenshot({ path: path.join(out, 'editor-desktop.png') });
  await page.getByRole('group', { name: '行程天数' }).getByRole('button', { name: '总览', exact: true }).click();
  await capture('overview-heading', '.editor-overview h2');
  await capture('overview-day', '.editor-overview-day strong');
  await page.getByRole('group', { name: '行程天数' }).getByRole('button', { name: '第1天', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await capture('heading-mobile', '.day-head h2');
  await page.screenshot({ path: path.join(out, 'editor-mobile.png') });
  await page.setViewportSize({ width: 1672, height: 941 });
  await page.goto('http://127.0.0.1:5173/trips');
  await capture('subtitle', '.collection-heading p');
  await page.waitForFunction(() => document.querySelector('.collection-cover')?.dataset.illustrated === 'true');
  await capture('cover-city', '.collection-destination');
  await capture('cover-plain', '.collection-card:nth-child(6) .collection-destination');
  await capture('cover', '.collection-cover');
  await page.screenshot({ path: path.join(out, 'collection-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await capture('subtitle-mobile', '.collection-heading p');
  await capture('cover-mobile', '.collection-destination');
  await page.screenshot({ path: path.join(out, 'collection-mobile.png'), fullPage: true });
  empty = true; await page.reload();
  await capture('empty-mark', '.collection-empty-mark');
  await page.screenshot({ path: path.join(out, 'empty-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1672, height: 941 });
  await page.goto('http://127.0.0.1:5173');
  await page.waitForSelector('#root > *');
  await page.evaluate(async () => {
    const { default: React } = await import('/node_modules/.vite/deps/react.js');
    const { default: ReactDOM } = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { GenerationRunPanel } = await import('/src/components/GenerationRunPanel.tsx');
    document.querySelector('#root').remove(); const host = document.createElement('div'); document.body.append(host);
    const root = ReactDOM.createRoot(host), h = React.createElement;
    window.renderFontSizingGeneration = (count = 5) => root.render(h('div', { className: 'min-h-screen flex flex-col' },
      h('header', { className: 'h-[76px] shrink-0' }),
      h('main', { className: 'px-[2.5%] max-[768px]:px-3 flex-1' }, h(GenerationRunPanel, { city: '北京', days: 4, cancelling: false, cancellationError: null,
        onCancel() {}, onReset() {}, onOpenTrip() {}, events: [
          { type: 'job_start', at: Date.now(), destination: '北京', days: 4, dataSources: [] },
          { type: 'phase_start', phase: 'research', round: 1 }, { type: 'phase_end', phase: 'research', round: 1 },
          { type: 'phase_start', phase: 'plan', round: 1 }, { type: 'tool_start', phase: 'plan', toolCallId: 'sizing-hint', label: '搜罗胡同里的隐藏咖啡馆' },
          ...['故宫 · 角楼黄昏', '南锣鼓巷 · 老北京风情', '天坛 · 祈年殿', '颐和园 · 昆明湖', '簋街 · Citywalk'].slice(0, count).map((name, i) => ({ type: 'candidate', poi: { id: String(i), name, category: 'attraction', intro: '', coverUrl: '/home-bg.png' } })),
        ],
      }))));
    window.renderFontSizingGeneration();
  });
  await page.waitForFunction(() => document.querySelectorAll('figcaption').length === 5);
  await capture('hint', '.gen-step-hint-live');
  await capture('caption', 'figcaption');
  await capture('caption-long', 'figure:nth-child(2) figcaption');
  await capture('new-mark', '.gen-polaroid-new');
  await page.screenshot({ path: path.join(out, 'generation-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await capture('hint-mobile', '.gen-step-hint-live');
  await capture('caption-mobile', 'figcaption');
  await page.screenshot({ path: path.join(out, 'generation-mobile.png'), fullPage: true });
  await page.evaluate(() => window.renderFontSizingGeneration(0));
  await capture('placeholder-caption', '.gen-polaroid-caption');
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(out, 'metrics.json'), JSON.stringify(metrics, null, 2));
  console.log(JSON.stringify(metrics.map(({ name, fontSize, inkHeight }) => ({ name, fontSize, inkHeight }))));
} finally { await browser.close(); }
