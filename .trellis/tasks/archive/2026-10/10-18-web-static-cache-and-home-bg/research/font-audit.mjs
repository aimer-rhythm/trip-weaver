// 字体加载审计：禁用缓存后打开首页，按字体族统计实际下载的分片与字节。
// 用法：node .trellis/tasks/10-18-web-static-cache-and-home-bg/research/font-audit.mjs [URL]
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://127.0.0.1:8799/';
const browser = await chromium.launch();
const page = await browser.newPage();
await page.context().newCDPSession(page).then(s => s.send('Network.setCacheDisabled', { cacheDisabled: true }));

const fonts = [];
page.on('response', async res => {
  const u = res.url();
  if (!u.endsWith('.woff2')) return;
  const buf = await res.body().catch(() => Buffer.alloc(0));
  fonts.push({ file: decodeURIComponent(u.split('/').pop()), bytes: buf.length, status: res.status() });
});

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

const group = f => {
  if (f.startsWith('noto-sans')) return 'Noto Sans SC（正文）';
  if (f.startsWith('noto-serif')) return 'Noto Serif SC（宋体正文）';
  if (f.startsWith('youran')) return 'Youran Handwriting（手写）';
  if (f.startsWith('part-')) return 'KingHwa OldSong（京华老宋）';
  return '其他';
};

const byGroup = {};
for (const f of fonts) {
  const g = group(f.file);
  byGroup[g] ??= { count: 0, bytes: 0 };
  byGroup[g].count++;
  byGroup[g].bytes += f.bytes;
}

console.log(`URL: ${url}`);
console.log(`woff2 请求总数: ${fonts.length}，合计 ${(fonts.reduce((s, f) => s + f.bytes, 0) / 1024).toFixed(0)}KB\n`);
for (const [name, v] of Object.entries(byGroup)) {
  console.log(`${name.padEnd(26)} 分片=${String(v.count).padStart(3)}  合计=${(v.bytes / 1024).toFixed(0)}KB`);
}
console.log('\n明细:');
for (const f of fonts.sort((a, b) => b.bytes - a.bytes)) console.log(`  ${(f.bytes / 1024).toFixed(0).padStart(4)}KB  ${f.file}`);

await browser.close();
