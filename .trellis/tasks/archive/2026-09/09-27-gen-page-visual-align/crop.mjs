// 设计稿局部放大（09-27 视觉对齐）：裁出标题区域放大 2 倍，用来确认字体是衬线还是无衬线。
// 用法：node .trellis/tasks/09-27-gen-page-visual-align/crop.mjs [x0] [y0] [x1] [y1] [scale] [out]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9230;
const OUT = path.resolve('.trellis/tasks/09-27-gen-page-visual-align');
const [x0 = '470', y0 = '105', x1 = '1280', y1 = '195', scale = '2', out = 'zoom-title.png', input = 'ui-ref.png'] = process.argv.slice(2);
const IMG = `file:///D:/Project/tripweaver/.trellis/tasks/09-27-gen-page-visual-align/${input}`;
const PROFILE = 'C:\\temp\\tw-crop-profile';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitEndpoint() {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) return; } catch { /* wait */ }
    await sleep(500);
  }
  throw new Error('chrome CDP endpoint not ready');
}
async function newTab(url) {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  return r.json();
}
class CDP {
  static connect(wsUrl) { return new Promise((res) => { const ws = new WebSocket(wsUrl); ws.onopen = () => res(new CDP(ws)); }); }
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && this.pending.has(d.id)) { this.pending.get(d.id)(d); this.pending.delete(d.id); } };
  }
  send(method, params = {}) { const id = ++this.id; return new Promise((res) => { this.pending.set(id, res); this.ws.send(JSON.stringify({ id, method, params })); }); }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
    return r.result?.result?.value;
  }
}

const SCRIPT = `(async () => {
  const img = document.querySelector('img');
  const [X0, Y0, X1, Y1, S] = [${x0}, ${y0}, ${x1}, ${y1}, ${scale}];
  const c = document.createElement('canvas');
  c.width = (X1 - X0) * S; c.height = (Y1 - Y0) * S;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, X0, Y0, X1 - X0, Y1 - Y0, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
})()`;

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--allow-file-access-from-files', '--no-first-run', '--no-default-browser-check', IMG], { stdio: 'ignore' });

try {
  await waitEndpoint();
  const tab = await newTab(IMG);
  const cdp = await CDP.connect(tab.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await sleep(1200);
  const dataUrl = await cdp.eval(SCRIPT);
  fs.writeFileSync(path.join(OUT, out), Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log(`written ${out} (${(x1 - x0)}x${(y1 - y0)} @${scale}x)`);
} catch (err) {
  console.error('crop failed:', err.message);
  process.exitCode = 1;
} finally {
  chrome.kill('SIGKILL');
  setTimeout(() => process.exit(process.exitCode ?? 0), 200);
}
