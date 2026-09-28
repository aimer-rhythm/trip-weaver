// Real backend generation and real GenerationRunPanel, including restoration from job id.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const base = 'http://127.0.0.1:5173';
const out = path.resolve('.trellis/tasks/09-27-gen-page-visual-align/research', process.argv[2] ?? 'live-09-28');
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const records = [];
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1672, height: 941 } });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base);
  const register = await page.request.post(`${base}/api/auth/register`, { data: { email: `visual-${Date.now()}@t.dev`, password: 'visual-check-09-28' } });
  if (!register.ok()) throw new Error(`Registration failed: ${register.status()}`);
  const response = await page.request.post(`${base}/api/generations`, { data: {
    destination: '北京', days: 4, startDate: '2026-09-29', budgetLevel: '舒适', totalBudget: 0, partySize: 2, extraNotes: '', pace: 'moderate',
  } });
  const job = await response.json();
  if (!response.ok()) throw new Error(`Generation failed: ${response.status()} ${JSON.stringify(job)}`);
  console.log(JSON.stringify({ jobId: job.jobId, status: response.status() }));
  await page.evaluate(id => sessionStorage.setItem('tw.activeJobId', id), job.jobId);
  await page.goto(`${base}/trips/new?city=${encodeURIComponent('北京')}`);
  const start = Date.now();
  let previous = '';
  let lastShot = 0;
  for (let i = 0; i < 480; i++) {
    const state = await page.evaluate(() => {
      const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
      return {
        url: location.pathname,
        title: document.querySelector('.gen-title')?.textContent,
        steps: [...document.querySelectorAll('.gen-step')].map(el => ({ state: el.className, text: el.textContent })),
        cards: [...document.querySelectorAll('figure.gen-polaroid')].map(el => ({
          text: el.textContent, box: rect(el), width: el.offsetWidth, height: el.offsetHeight,
          photo: el.querySelector('img') ? { loaded: el.querySelector('img').complete && el.querySelector('img').naturalWidth > 0, url: el.querySelector('img').getAttribute('src') } : null,
        })),
        footer: document.querySelector('.gen-footer') ? rect(document.querySelector('.gen-footer')) : null,
        terminal: document.querySelector('.gen-page-root') && !document.querySelector('.gen-title') ? document.querySelector('.gen-page-root').textContent : null,
      };
    });
    const elapsed = Math.round((Date.now() - start) / 1000);
    const key = JSON.stringify([state.url, state.steps.map(s => s.state), state.cards.map(c => [c.text, c.photo?.loaded]), state.terminal]);
    if (key !== previous || elapsed - lastShot >= 20) {
      const shot = `${String(elapsed).padStart(3, '0')}s.png`;
      await page.screenshot({ path: path.join(out, shot), fullPage: true });
      records.push({ elapsed, shot, ...state });
      await fs.writeFile(path.join(out, 'observations.json'), JSON.stringify({ jobId: job.jobId, records, errors }, null, 2));
      console.log(JSON.stringify({ elapsed, shot, url: state.url, phases: state.steps.map(s => s.state), cards: state.cards.length, loaded: state.cards.filter(c => c.photo?.loaded).length, terminal: state.terminal }));
      previous = key;
      lastShot = elapsed;
    }
    if (state.url !== '/trips/new') break;
    if (state.terminal && !state.terminal.includes('行程已生成')) break;
    await page.waitForTimeout(1000);
  }
  console.log('Live capture finished');
} finally {
  await browser.close();
}
