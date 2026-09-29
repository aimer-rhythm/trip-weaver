// Deterministic component screenshots; no backend generation or paid provider calls.
// Usage: node apps/web/tests/generation-browser.mjs --motion
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const out = path.resolve('.trellis/tasks/09-29-ui-consistency/research/generation-verification', 'after');
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1672, height: 941 }, reducedMotion: process.argv.includes('--motion') ? 'no-preference' : 'reduce' });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:5173');
  await page.waitForSelector('#root > *');
  await page.evaluate(async () => {
    const { default: React } = await import('/node_modules/.vite/deps/react.js');
    const { default: ReactDOM } = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { GenerationRunPanel } = await import('/src/components/GenerationRunPanel.tsx');
    // Keep the same layout geometry as AppLayout, with a static navigation shell.
    document.querySelector('#root').remove();
    const host = document.createElement('div');
    document.body.append(host);
    const root = ReactDOM.createRoot(host);
    const h = React.createElement;
    window.renderGeneration = (count = 6, city = '北京', status = '搜罗胡同里的隐藏咖啡馆') => {
      const events = [
        { type: 'job_start', at: Date.now() - 60000, destination: city, days: 4, dataSources: ['amap', 'websearch'] },
        { type: 'phase_start', phase: 'research', round: 1 },
        { type: 'phase_end', phase: 'research', round: 1 },
        { type: 'phase_start', phase: 'plan', round: 1 },
        { type: 'tool_start', phase: 'plan', toolCallId: 'demo', label: status },
        ...['故宫 · 角楼黄昏', '南锣鼓巷 · 老北京风情', '天坛 · 祈年殿', '颐和园 · 昆明湖', '簋街 · Citywalk', '景山公园'].slice(0, count).map((name, i) => ({
          type: 'candidate', poi: { id: String(i), name, category: 'attraction', coverUrl: '/home-bg.png' },
        })),
      ];
      root.render(h('div', { className: "app-layout [min-height:100vh] flex flex-col [background:var(--color-canvas)_url('/home-bg.png')_center_/_cover_no-repeat] [&:has(.home-page-root)_.app-main]:p-0 [@media_(max-width:_600px)]:[&:has(.editor-page)_.topbar]:[padding-top:12px] [@media_(max-width:_600px)]:[&:has(.editor-page)_.brand-en]:hidden [@media_(max-width:_600px)]:[&:has(.editor-page)_.quota-chip]:hidden [@media_(max-width:_600px)]:[&:has(.editor-page)_.topbar-capsule]:[padding-left:12px] [@media_(max-width:_600px)]:[&:has(.editor-page)_.topbar-actions]:[gap:0] [@media_(max-width:_600px)]:[&:has(.editor-page)_.topbar-actions_.btn]:[padding:8px] [@media_(max-width:_600px)]:[&:has(.editor-page)_.topbar-actions_.btn]:[font-size:12px] [@media_screen]:[&:has(.editor-page)]:[height:100dvh] [@media_screen]:[&:has(.editor-page)]:min-h-0 [@media_screen]:[&:has(.editor-page)]:overflow-hidden [@media_screen]:[&:has(.editor-page)_.topbar]:shrink-0 [@media_screen]:[&:has(.editor-page)_.app-main]:overflow-hidden [@media_screen]:[&_.editor-page]:flex-1 [@media_screen]:[&_.editor-page]:[height:auto] [@media_screen]:[&_.editor-page]:[max-height:none] [@media_(max-width:_600px)]:[&:has(.trip-collection)_.brand-en]:hidden [@media_(max-width:_600px)]:[&:has(.trip-collection)_.quota-chip]:hidden [@media_(max-width:_600px)]:[&:has(.trip-collection)_.topbar-capsule]:[padding-left:12px] [@media_(max-width:_600px)]:[&:has(.trip-collection)_.topbar-actions]:[gap:0] [@media_(max-width:_600px)]:[&:has(.trip-collection)_.topbar-actions_.btn]:[padding:8px] [@media_(max-width:_600px)]:[&:has(.trip-collection)_.topbar-actions_.btn]:[font-size:12px]" },
        h('header', { className: "topbar flex [padding:20px_2.5%_0] sticky [top:0] [z-index:20] [@media_(max-width:_768px)]:[padding:12px_12px_0]" }, h('div', { className: "topbar-capsule flex-1 [height:56px] flex items-center justify-between [padding:0_10px_0_20px] [background:rgba(255,_255,_255,_0.62)] [backdrop-filter:blur(18px)_saturate(1.6)] [-webkit-backdrop-filter:blur(18px)_saturate(1.6)] [border:1px_solid_rgba(255,_255,_255,_0.75)] rounded-full [box-shadow:0_12px_32px_rgba(31,_64,_124,_0.1)]" }, h('span', { className: "brand flex items-center [gap:8px] font-bold [font-size:1.1rem] [color:var(--color-ink)]" }, '织程 TripWeaver'))),
        h('main', { className: "app-main flex-1 flex flex-col min-h-0 [padding:0_2.5%] [@media_(max-width:_768px)]:[padding:0_12px]" }, h(GenerationRunPanel, { events, city, days: 3, cancelling: false, cancellationError: null, onCancel() {}, onReset() {}, onOpenTrip() {} })),
      ));
    };
    window.renderGeneration();
  });
  const results = [];
  if (process.argv.includes('--motion')) {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => window.renderGeneration(6, '北京', '查看颐和园的开放时间与附近交通信息'));
    await page.waitForTimeout(100);
    const readMotion = () => page.evaluate(() => ({
      cards: document.querySelectorAll('figure.gen-polaroid').length,
      hiddenCharacters: [...document.querySelectorAll('.gen-typewriter-char')].filter(el => Number(getComputedStyle(el).opacity) < .5).length,
      badgeAnimation: getComputedStyle(document.querySelector('.is-active .gen-step-badge')).animationName,
      badgeShadow: getComputedStyle(document.querySelector('.is-active .gen-step-badge')).boxShadow,
      haloTransform: getComputedStyle(document.querySelector('.gen-step-halo')).transform,
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      runningAnimations: document.getAnimations().filter(a => a.playState === 'running').length,
      titleFont: getComputedStyle(document.querySelector('.gen-title')).fontFamily,
    }));
    const initial = await readMotion();
    assert.equal(initial.cards, 0);
    assert.ok(initial.hiddenCharacters > 0);
    assert.equal(initial.badgeAnimation, 'gen-badge-breathe');
    const timeline = [{ ms: 0, ...initial }];
    const start = Date.now();
    for (let count = 1; count <= 5; count++) {
      await page.waitForFunction(count => document.querySelectorAll('figure.gen-polaroid').length === count, count);
      timeline.push({ ms: Date.now() - start, ...await readMotion() });
      await page.screenshot({ path: path.join(out, `entry-${count}.png`) });
    }
    assert.equal(timeline.at(-1).hiddenCharacters, 0);
    assert.ok(new Set(timeline.map(sample => sample.badgeShadow)).size > 1, 'breathing must visibly change shadow values');
    assert.ok(new Set(timeline.map(sample => sample.haloTransform)).size > 1, 'halo must actually scale across frames');
    for (let i = 2; i < timeline.length; i++) assert.ok(timeline[i].ms - timeline[i - 1].ms > 800);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForTimeout(100);
    const reduced = await readMotion();
    assert.equal(reduced.cards, 5);
    assert.equal(reduced.hiddenCharacters, 0);
    assert.equal(reduced.badgeAnimation, 'none');
    await fs.writeFile(path.join(out, 'motion.json'), JSON.stringify({ timeline, reduced }, null, 2));
    console.log('Motion checks passed: staged cards, typewriter, breathing badge, reduced motion');
  }
  for (const [name, width, height, count, city] of [
    ['desktop', 1672, 941, 6, '北京'],
    ['laptop', 1280, 800, 6, '北京'],
    ['mobile', 390, 844, 6, '北京'],
    ['mobile-long-title', 390, 844, 6, '呼和浩特'],
    ['mobile-empty', 390, 844, 0, '北京'],
  ]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(({ count, city }) => window.renderGeneration(count, city), { count, city });
    await page.locator('.gen-title').waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });
    results.push(await page.evaluate(name => {
      const box = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
      return { name, viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth,
        title: document.querySelector('.gen-title').textContent,
        main: box(document.querySelector('.gen-main')),
        fan: box(document.querySelector('.gen-fan')),
        cards: [...document.querySelectorAll('.gen-polaroid')].map(box),
        footer: box(document.querySelector('.gen-footer')),
        liveFont: getComputedStyle(document.querySelector('.gen-step-hint-live')).fontFamily,
        animations: document.getAnimations().filter(a => a.playState === 'running').length,
      };
    }, name));
  }
  assert.deepEqual(errors, []);
  for (const result of results) {
    assert.ok(result.scrollWidth <= result.viewport, `${result.name}: horizontal overflow`);
    for (const card of result.cards) {
      assert.ok(card.x >= -1 && card.right <= result.viewport + 1, `${result.name}: clipped card`);
      assert.ok(card.bottom <= result.footer.y + 1, `${result.name}: card overlaps footer`);
    }
  }
  await fs.writeFile(path.join(out, 'measurements.json'), JSON.stringify({ results, errors }, null, 2));
  console.log('Generation layout checks passed:', results.map(r => r.name).join(', '));
} finally {
  await browser.close();
}
