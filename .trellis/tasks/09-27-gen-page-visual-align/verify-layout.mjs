// Deterministic component screenshots; no backend generation or paid provider calls.
// Usage: node .trellis/tasks/09-27-gen-page-visual-align/verify-layout.mjs before
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const out = path.resolve('.trellis/tasks/09-27-gen-page-visual-align/research', process.argv[2] ?? 'after');
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1672, height: 941 }, reducedMotion: 'reduce' });
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
    window.renderGeneration = (count = 6, city = '北京') => {
      const events = [
        { type: 'job_start', at: Date.now() - 60000, destination: city, days: 4, dataSources: ['amap', 'websearch'] },
        { type: 'phase_start', phase: 'research', round: 1 },
        { type: 'phase_end', phase: 'research', round: 1 },
        { type: 'phase_start', phase: 'plan', round: 1 },
        { type: 'tool_start', phase: 'plan', toolCallId: 'demo', label: '搜罗胡同里的隐藏咖啡馆' },
        ...['故宫 · 角楼黄昏', '南锣鼓巷 · 老北京风情', '天坛 · 祈年殿', '颐和园 · 昆明湖', '簋街 · Citywalk', '景山公园'].slice(0, count).map((name, i) => ({
          type: 'candidate', poi: { id: String(i), name, category: 'attraction', coverUrl: '/home-bg.png' },
        })),
      ];
      root.render(h('div', { className: 'app-layout' },
        h('header', { className: 'topbar' }, h('div', { className: 'topbar-capsule' }, h('span', { className: 'brand' }, '织程 TripWeaver'))),
        h('main', { className: 'app-main' }, h(GenerationRunPanel, { events, city, days: 3, cancelling: false, cancellationError: null, onCancel() {}, onReset() {}, onOpenTrip() {} })),
      ));
    };
    window.renderGeneration();
  });
  const results = [];
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
  await fs.writeFile(path.join(out, 'measurements.json'), JSON.stringify({ results, errors }, null, 2));
  console.log(JSON.stringify({ results, errors }, null, 2));
} finally {
  await browser.close();
}
