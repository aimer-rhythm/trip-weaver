// UI 稿像素测量（09-27 视觉对齐）：无头 Chrome 打开设计稿，用 canvas 扫描出关键元素边界。
// 用途：把设计稿当标尺，得出「设计像素」尺寸后再写进 CSS 的 --ui 缩放体系。
// 用法：node .trellis/tasks/09-27-gen-page-visual-align/measure-ui.mjs
import { spawn } from 'node:child_process';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9226;
const IMG = 'file:///D:/Project/tripweaver/.trellis/tasks/09-27-gen-page-visual-align/ui-ref.png';
const PROFILE = 'C:\\temp\\tw-measure-profile';

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

const SCRIPT = String.raw`(() => {
  const img = document.querySelector('img');
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const { width: W, height: H } = c;
  const d = ctx.getImageData(0, 0, W, H).data;
  const i4 = (x, y) => (y * W + x) * 4;
  const lum = (x, y) => { const i = i4(x, y); return 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2]; };
  const sat = (x, y) => { const i = i4(x, y); const r = d[i], g = d[i+1], b = d[i+2]; return Math.max(r,g,b) - Math.min(r,g,b); };
  const darkAt = (x, y) => lum(x, y) < 130;
  const whiteAt = (x, y) => lum(x, y) > 246 && sat(x, y) < 20;

  // 1) 左侧文本逐行深色计数（x<700），用于定位里程碑各行的 y 区间
  const darkProfile = [];
  for (let y = 230; y < 820; y++) {
    let n = 0;
    for (let x = 0; x < 700; x++) if (darkAt(x, y)) n++;
    if (n > 2) darkProfile.push([y, n]);
  }
  // 合并成带
  const bands = [];
  for (const [y, n] of darkProfile) {
    const last = bands[bands.length - 1];
    if (last && y - last.y1 <= 2) { last.y1 = y; last.max = Math.max(last.max, n); }
    else bands.push({ y0: y, y1: y, max: n });
  }

  // 2) 状态标：1 号绿环 badge / 2 号蓝环 badge（颜色特征比纯白可靠 —— 背景是浅色渐变）
  function colorBbox(pred) {
    let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1, n = 0;
    for (let y = 240; y < 800; y++) for (let x = 100; x < 620; x++) {
      if (pred(x, y)) { n++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
    return n ? { x0: minX, y0: minY, x1: maxX, y1: maxY, w: maxX - minX + 1, h: maxY - minY + 1, n } : null;
  }
  const green = (x, y) => { const i = i4(x, y); const r = d[i], g = d[i+1], b = d[i+2]; const l = 0.299*r + 0.587*g + 0.114*b; return g > r + 10 && g > b + 6 && l > 170; };
  const blue = (x, y) => { const i = i4(x, y); const r = d[i], g = d[i+1], b = d[i+2]; const l = 0.299*r + 0.587*g + 0.114*b; return b > r + 18 && b > g + 10 && l > 150; };

  // 3) 照片区：彩色大块（卡内照片），用于定位卡片边界
  const photoRows = [];
  for (let y = 200; y < 760; y += 6) {
    let best = 0, bestX = -1, run = 0, runX = -1;
    for (let x = 620; x < W; x++) {
      const i = i4(x, y); const l = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
      const s = Math.max(d[i], d[i+1], d[i+2]) - Math.min(d[i], d[i+1], d[i+2]);
      const isPhoto = s > 22 && l > 60 && l < 240;
      if (isPhoto) { if (run === 0) runX = x; run++; if (run > best) { best = run; bestX = runX; } }
      else run = 0;
    }
    if (best > 60) photoRows.push({ y, x0: bestX, x1: bestX + best - 1, len: best });
  }

  // 4) 左列文本的 x 范围（里程碑标题行）
  const textCols = (() => {
    let minX = 1e9, maxX = -1;
    for (let y = 280; y < 700; y++) for (let x = 200; x < 700; x++) {
      if (darkAt(x, y)) { if (x < minX) minX = x; if (x > maxX) maxX = x; }
    }
    return minX === 1e9 ? null : { minX, maxX };
  })();

  return { size: { W, H }, bands, greenBadge: colorBbox(green), blueBadge: colorBbox(blue), photoRows, textCols };
})()`;

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`,
  '--allow-file-access-from-files',
  '--no-first-run',
  '--no-default-browser-check',
  IMG,
], { stdio: 'ignore' });

try {
  await waitEndpoint();
  const tab = await newTab(IMG);
  const cdp = await CDP.connect(tab.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await sleep(1500);
  const out = await cdp.eval(SCRIPT);
  console.log(JSON.stringify({
    size: out.size,
    bands: out.bands,
    greenBadge: out.greenBadge,
    blueBadge: out.blueBadge,
    textCols: out.textCols,
    photoRowsHead: out.photoRows.slice(0, 5),
    photoRowsTail: out.photoRows.slice(-5),
    photoRowCount: out.photoRows.length,
  }, null, 1));
} catch (err) {
  console.error('measure failed:', err.message);
  process.exitCode = 1;
} finally {
  chrome.kill('SIGKILL');
  setTimeout(() => process.exit(process.exitCode ?? 0), 200);
}
