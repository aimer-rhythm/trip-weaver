import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const library = JSON.parse(await fs.readFile('apps/server/src/data/photography/hangzhou-curated.json', 'utf8'));
const pois = library.places.filter(p => p.photos.length).slice(0, 5).map((p, i) => ({ id: String(i), name: p.name,
  category: 'attraction', intro: '', reservation: 'unknown', sourceLinks: [], coverUrl: '/media/' + p.photos[0].key,
  coverAttribution: p.photos[0].attribution }));
const out = '.trellis/tasks/09-29-hangzhou-image-diagnosis/research/photo-verification';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  const errors = []; page.on('pageerror', e => { errors.push(e.message); console.error(e.message); });
  page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
  await page.goto('http://127.0.0.1:5173');
  await page.waitForSelector('#root > *');
  await page.evaluate(async pois => {
    const { default: React } = await import('/node_modules/.vite/deps/react.js');
    const { default: ReactDOM } = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { GenerationRunPanel } = await import('/src/components/GenerationRunPanel.tsx');
    document.querySelector('#root').remove();
    const host = document.createElement('div'); document.body.append(host);
    const h = React.createElement;
    ReactDOM.createRoot(host).render(h('div', { style: { minHeight: '100vh', display: 'flex', flexDirection: 'column', background: "var(--color-canvas) url('/home-bg.png') center / cover" } },
      h('header', { style: { height: 76, flexShrink: 0, padding: '20px 2.5% 0' } }, '织程 TripWeaver'),
      h('main', { style: { display: 'flex', flex: 1, flexDirection: 'column', minHeight: 0, padding: '0 2.5%' } }, h(GenerationRunPanel, {
        events: [{ type: 'job_start', at: Date.now(), destination: '杭州', days: 3, dataSources: ['amap', 'websearch'] }, { type: 'phase_start', phase: 'research', round: 1 },
          ...pois.map(poi => ({ type: 'candidate', poi }))], city: '杭州', days: 3, cancelling: false,
        onCancel() {}, onReset() {}, onOpenTrip() {},
      }))));
  }, pois);
  await page.locator('.gen-title').waitFor();
  const measurements = [];
  for (const [name, width, height] of [['desktop',1672,941], ['laptop',1280,800], ['mobile',390,844]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => document.fonts.ready);
    await page.locator('img.poi-cover').evaluateAll(imgs => Promise.all(imgs.map(img => img.decode())));
    assert.equal(await page.locator('.photo-credit').count(), 5);
    const m = await page.evaluate(() => {
      const footer = document.querySelector('.gen-footer').getBoundingClientRect();
      return { overflow: document.documentElement.scrollWidth > innerWidth,
        cards: [...document.querySelectorAll('figure')].map(el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, bottom: r.bottom }; }),
        footer: footer.top, width: innerWidth };
    });
    console.log(JSON.stringify({ name, ...m }));
    await page.screenshot({ path: `${out}/generation-${name}.png`, fullPage: true });
    assert.equal(m.overflow, false, name);
    for (const r of m.cards) {
      assert.ok(r.left >= -1 && r.right <= m.width + 1, `${name}: clipped photo`);
      assert.ok(r.bottom <= m.footer + 1, `${name}: footer overlap`);
    }
    measurements.push({ name, ...m });
    await page.screenshot({ path: `${out}/generation-${name}.png`, fullPage: true });
  }
  assert.deepEqual(errors, []);
  await fs.writeFile(`${out}/generation.json`, JSON.stringify({ measurements, errors }, null, 2));
  console.log(JSON.stringify({ views: measurements.length, credits: 5, errors }));
} finally { await browser.close(); }
