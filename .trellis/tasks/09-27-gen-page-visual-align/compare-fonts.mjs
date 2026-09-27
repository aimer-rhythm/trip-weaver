// 手写体候选比对（09-27 视觉对齐任务）：把设计稿的卡片说明裁图与三款候选字体的渲染结果放进同一张图。
// 用法：node .trellis/tasks/09-27-gen-page-visual-align/compare-fonts.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9232;
const ROOT = 'D:/Project/tripweaver';
const OUT = path.resolve('.trellis/tasks/09-27-gen-page-visual-align');
const PROFILE = 'C:\\temp\\tw-fontcmp-profile';

const REF = `file:///${ROOT}/.trellis/tasks/09-27-gen-page-visual-align/ui-ref.png`;
const CANDIDATES = [
  { family: 'QianTuBiFeng', label: '千图笔锋手写体', file: `${ROOT}/node_modules/@fontpkg/qiantubifengshouxieti/千图笔锋手写体.ttf` },
  { family: 'JiangXiZhuoKai', label: '江西拙楷 2.0', file: `${ROOT}/node_modules/@fontpkg/jiangxizhuokai/江西拙楷2.0.ttf` },
  { family: 'LXGWWenKai', label: '霞鹜文楷 Regular', file: `${ROOT}/node_modules/@fontpkg/lxgw-wen-kai/LXGWWenKai-Regular.ttf` },
];
const TEXT = '故宫 · 角楼黄昏  南锣鼓巷 · 老北京风情  颐和园 · 昆明湖';

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
  const REF = ${JSON.stringify(REF)};
  const CANDS = ${JSON.stringify(CANDIDATES)};
  const TEXT = ${JSON.stringify(TEXT)};
  const W = 1100, rowH = 64, refH = 110;
  const H = refH + CANDS.length * rowH + 30;

  const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  const ref = await loadImg(REF);

  for (const c of CANDS) {
    const face = new FontFace(c.family, \`url(file:///\${c.file.replace(/\\\\/g, '/')})\`);
    await face.load();
    document.fonts.add(face);
  }

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f4f7fb';
  ctx.fillRect(0, 0, W, H);

  // 第 1 行：设计稿的卡片说明裁图（x 830-1020, y 470-535）
  ctx.drawImage(ref, 830, 470, 190, 65, 16, 12, 190 * 1.6, 65 * 1.6);
  ctx.fillStyle = '#8a99ad';
  ctx.font = '13px sans-serif';
  ctx.fillText('设计稿（放大 1.6×）', 340, 40);

  let y = refH;
  for (const c of CANDS) {
    ctx.fillStyle = '#1a365d';
    ctx.font = \`28px '\${c.family}'\`;
    ctx.fillText(TEXT, 16, y + 40);
    ctx.fillStyle = '#8a99ad';
    ctx.font = '12px sans-serif';
    ctx.fillText(c.label, W - 150, y + 40);
    y += rowH;
  }
  return canvas.toDataURL('image/png');
})()`;

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--allow-file-access-from-files', '--no-first-run', '--no-default-browser-check', REF], { stdio: 'ignore' });

try {
  await waitEndpoint();
  const tab = await newTab(REF);
  const cdp = await CDP.connect(tab.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await sleep(1200);
  const dataUrl = await cdp.eval(SCRIPT);
  const file = path.join(OUT, 'fonts-compare.png');
  fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log(`written ${file}`);
} catch (err) {
  console.error('compare failed:', err.message);
  process.exitCode = 1;
} finally {
  chrome.kill('SIGKILL');
  setTimeout(() => process.exit(process.exitCode ?? 0), 200);
}
