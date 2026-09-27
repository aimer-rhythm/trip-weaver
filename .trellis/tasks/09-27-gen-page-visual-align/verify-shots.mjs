// 生成页视觉校验收图（09-27 对齐任务）：无头 Chrome + CDP 走真实流程截图。
// 与 09-27-planning-steps-glass/verify-shots.mjs 同源，只改输出目录与浏览器 profile，避免覆盖上一任务的基准图。
// 用法：node .trellis/tasks/09-27-gen-page-visual-align/verify-shots.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9224;
const BASE = 'http://localhost:5173';
const OUT = path.resolve('.trellis/tasks/09-27-gen-page-visual-align');
const PROFILE = 'C:\\temp\\tw-align-profile';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitEndpoint() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return;
    } catch { /* not ready */ }
    await sleep(500);
  }
  throw new Error('chrome CDP endpoint not ready');
}

async function newTab(url) {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  if (!r.ok) throw new Error(`newTab failed: ${r.status}`);
  return r.json();
}

class CDP {
  static connect(wsUrl) {
    return new Promise((resolve) => {
      const ws = new WebSocket(wsUrl);
      ws.onopen = () => resolve(new CDP(ws));
      ws.onerror = () => resolve(new CDP(ws));
    });
  }
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data);
      if (data.id && this.pending.has(data.id)) {
        this.pending.get(data.id)(data);
        this.pending.delete(data.id);
      }
    };
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
    return r.result?.result?.value;
  }
  async shot(name) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.result.data, 'base64'));
    console.log(`saved ${name}`);
  }
}

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`,
  '--window-size=1672,941',
  '--no-first-run',
  '--no-default-browser-check',
  'about:blank',
], { stdio: 'ignore' });

try {
  await waitEndpoint();
  const tab = await newTab(`${BASE}/`);
  const cdp = await CDP.connect(tab.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  // 视口必须与设计稿（1672×941）一致：headless 的 --window-size 含窗口装饰，innerWidth 会少约 88px
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1672, height: 941, deviceScaleFactor: 1, mobile: false });
  await sleep(3000); // 等 Vite 首屏编译

  // 1. 注册一次性账号（cookie 自动写入浏览器）
  const email = `align-${Date.now()}@t.dev`;
  const reg = await cdp.eval(`fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: '${email}', password: 'verify-pass-123' }) }).then(r => r.status)`);
  console.log('register status:', reg);

  // 2. 首页截图
  await cdp.send('Page.navigate', { url: `${BASE}/` });
  await sleep(3500);
  await cdp.shot('shot-01-home.png');

  // 3. 查已覆盖城市，发起真实生成
  const cities = await cdp.eval(`fetch('/api/destinations/covered').then(r => r.json()).then(d => d.cities)`);
  console.log('covered cities:', JSON.stringify(cities));
  const city = cities?.includes('北京') ? '北京' : cities?.[0];
  const startDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const job = await cdp.eval(`fetch('/api/generations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ destination: '${city}', days: 4, startDate: '${startDate}', budgetLevel: '舒适', totalBudget: 0, partySize: 2, extraNotes: '', pace: 'moderate' }) }).then(async r => ({ status: r.status, body: await r.json() }))`);
  console.log('generation:', JSON.stringify(job));
  if (job.status !== 200 && job.status !== 201 && job.status !== 202) throw new Error('发起生成失败');

  // 4. 标记活动任务 → 打开 /trips/new 走刷新恢复链路（SSE 全量重放）
  await cdp.eval(`sessionStorage.setItem('tw.activeJobId', '${job.body.jobId}')`);
  await cdp.send('Page.navigate', { url: `${BASE}/trips/new?city=${encodeURIComponent(city)}` });
  await sleep(6000);
  await cdp.shot('shot-02-gen-early.png');
  await sleep(54000); // ~60s：调研中段，候选拍立得应陆续落位
  await cdp.shot('shot-03-gen-mid.png');

  // 元素实测：与设计稿（1672×941）逐项对照，避免靠目测调尺寸
  const measured = await cdp.eval(`(() => {
    const rect = (sel) => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
    const badges = [...document.querySelectorAll('.gen-step-badge')].map((el) => { const b = el.getBoundingClientRect(); return { cx: Math.round(b.x + b.width / 2), cy: Math.round(b.y + b.height / 2), d: Math.round(b.width) }; });
    // 拍立得有 rotate，getBoundingClientRect 会返回旋转后的外接矩形（265×233 转 8° ≈ 295）——用 offsetWidth 量真实尺寸
    const polaroidEl = document.querySelector('.gen-polaroid');
    const polaroid = polaroidEl ? { w: polaroidEl.offsetWidth, h: polaroidEl.offsetHeight, x: Math.round(polaroidEl.getBoundingClientRect().x), y: Math.round(polaroidEl.getBoundingClientRect().y) } : null;
    const root = document.querySelector('.gen-page-root');
    return {
      viewport: { w: innerWidth, h: innerHeight },
      ui: root ? getComputedStyle(root).getPropertyValue('--ui').trim() : null,
      title: rect('.gen-title'),
      arc: rect('.gen-title-arc'),
      badges,
      stepTitle: rect('.gen-step-title'),
      fan: rect('.gen-fan'),
      polaroid,
      cancel: rect('.gen-cancel-btn'),
      elapsed: rect('.gen-elapsed'),
    };
  })()`);
  console.log('measure:', JSON.stringify(measured));

  await sleep(40000); // ~100s：候选更多，验证扇形堆叠上限
  await cdp.shot('shot-04-gen-late.png');

  // 5. 取消 → 终态截图
  await cdp.eval(`fetch('/api/generations/${job.body.jobId}/cancel', { method: 'POST' }).then(r => r.status)`);
  await sleep(2500);
  await cdp.shot('shot-05-cancelled.png');
} finally {
  chrome.kill('SIGKILL');
  // Windows 下 kill 只终止父进程，且未关闭的 WebSocket 会挂住事件循环——显式退出
  setTimeout(() => process.exit(0), 300);
}
console.log('done');
