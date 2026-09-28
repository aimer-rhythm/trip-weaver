// 叠图对比（09-27 视觉对齐）：把设计稿以 100% 与实现截图以 50% 叠成一张，元素不重合就会看到重影。
// 用法：node .trellis/tasks/09-27-gen-page-visual-align/overlay.mjs [截图文件名]
// 默认用 shot-04-gen-late.png（生成中、候选已落位的一帧）。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9228;
const OUT = path.resolve('.trellis/tasks/09-27-gen-page-visual-align');
const SHOT = process.argv[2] ?? 'shot-04-gen-late.png';
const PROFILE = 'C:\\temp\\tw-overlay-profile';

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
  return r.json();
}

class CDP {
  static connect(wsUrl) {
    return new Promise((resolve) => {
      const ws = new WebSocket(wsUrl);
      ws.onopen = () => resolve(new CDP(ws));
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
}

const load = (name) => `file:///D:/Project/tripweaver/.trellis/tasks/09-27-gen-page-visual-align/${name}`;

const SCRIPT = `(async () => {
  const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  const [ref, shot] = await Promise.all([loadImg(${JSON.stringify(load('ui-ref.png'))}), loadImg(${JSON.stringify(load(SHOT))})]);
  const W = ref.naturalWidth, H = ref.naturalHeight;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  // 左：设计稿原图；右：实现截图缩放到同尺寸；中：50% 叠加
  ctx.drawImage(ref, 0, 0, W, H);
  ctx.globalAlpha = 0.5;
  ctx.drawImage(shot, 0, 0, W, H);
  ctx.globalAlpha = 1;
  return { data: c.toDataURL('image/png'), W, H };
})()`;

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`,
  '--window-size=1672,960',
  '--allow-file-access-from-files',
  '--no-first-run',
  '--no-default-browser-check',
  'about:blank',
], { stdio: 'ignore' });

try {
  await waitEndpoint();
  // 必须从 file:// 页面发起（同源），about:blank 是 opaque origin，canvas 会被污染导致 toDataURL 报错
  const tab = await newTab(load('ui-ref.png'));
  const cdp = await CDP.connect(tab.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await sleep(800);
  const out = await cdp.eval(SCRIPT);
  const base64 = out.data.split(',')[1];
  const file = path.join(OUT, 'overlay.png');
  fs.writeFileSync(file, Buffer.from(base64, 'base64'));
  console.log(`overlay written: ${file} (${out.W}x${out.H}) from ${SHOT}`);
} catch (err) {
  console.error('overlay failed:', err.message);
  process.exitCode = 1;
} finally {
  chrome.kill('SIGKILL');
  setTimeout(() => process.exit(process.exitCode ?? 0), 200);
}
