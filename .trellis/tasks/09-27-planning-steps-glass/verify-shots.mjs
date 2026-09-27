// 生成页视觉校对（09-27）：无头 Chrome + CDP 走真实流程截图。
// 流程：注册一次性账号 → 首页截图 → API 发起生成 → sessionStorage 标记 → 打开 /trips/new 走恢复链路 → 分阶段截图 → 取消 → 终态截图。
// 用法：node .trellis/tasks/09-27-planning-steps-glass/verify-shots.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9223;
const BASE = 'http://localhost:5173';
const OUT = path.resolve('.trellis/tasks/09-27-planning-steps-glass');
const PROFILE = 'C:\\temp\\tw-verify-profile';

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
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      ws.onopen = () => resolve(new CDP(ws));
      ws.onerror = (e) => reject(new Error('ws error'));
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
  '--window-size=1600,900',
  '--no-first-run',
  '--no-default-browser-check',
  'about:blank',
], { stdio: 'ignore' });

try {
  await waitEndpoint();
  const tab = await newTab(`${BASE}/`);
  const cdp = await CDP.connect(tab.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await sleep(3000); // 等 Vite 首屏编译

  // 1. 注册一次性账号（cookie 自动写入浏览器）
  const email = `verify-${Date.now()}@t.dev`;
  const reg = await cdp.eval(`fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: '${email}', password: 'verify-pass-123' }) }).then(r => r.status)`);
  console.log('register status:', reg);

  // 2. 首页截图
  await cdp.send('Page.navigate', { url: `${BASE}/` });
  await sleep(3500);
  await cdp.shot('shot-01-home.png');

  // 3. 查已覆盖城市，发起真实生成
  const cities = await cdp.eval(`fetch('/api/destinations/covered').then(r => r.json()).then(d => d.cities)`);
  console.log('covered cities:', JSON.stringify(cities));
  const city = cities?.[0] ?? '北京';
  const startDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const job = await cdp.eval(`fetch('/api/generations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ destination: '${city}', days: 3, startDate: '${startDate}', budgetLevel: '舒适', totalBudget: 0, partySize: 2, extraNotes: '', pace: 'moderate' }) }).then(async r => ({ status: r.status, body: await r.json() }))`);
  console.log('generation:', JSON.stringify(job));
  if (job.status !== 200 && job.status !== 201 && job.status !== 202) throw new Error('发起生成失败');

  // 4. 标记活动任务 → 打开 /trips/new 走刷新恢复链路（SSE 全量重放）
  await cdp.eval(`sessionStorage.setItem('tw.activeJobId', '${job.body.jobId}')`);
  await cdp.send('Page.navigate', { url: `${BASE}/trips/new?city=${encodeURIComponent(city)}` });
  await sleep(6000);
  await cdp.shot('shot-02-gen-early.png');
  await sleep(54000); // ~60s：调研中段，候选拍立得应陆续落位
  await cdp.shot('shot-03-gen-mid.png');
  await sleep(40000); // ~100s：候选更多，验证扇形堆叠上限
  await cdp.shot('shot-04-gen-late.png');

  // 5. 取消 → 终态截图
  await cdp.eval(`fetch('/api/generations/${job.body.jobId}/cancel', { method: 'POST' }).then(r => r.status)`);
  await sleep(2500);
  await cdp.shot('shot-05-cancelled.png');
} finally {
  chrome.kill('SIGKILL');
}
console.log('done');
