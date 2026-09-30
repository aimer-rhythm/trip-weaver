// 离线摄影候选采集：有限请求、可断点重跑；不把搜索结果自动批准为景点封面。
import '../src/lib/proxy.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const out = path.join(root, 'data/photo-pilot');
const targets = JSON.parse(await fs.readFile(new URL('../src/data/photography/hangzhou-targets.json', import.meta.url), 'utf8'));
const focused = process.argv.includes('--focused');
const focusedQueries: Record<number, string> = {
  1: 'intitle:"Broken Bridge" Hangzhou',
  2: 'incategory:"Su Causeway"',
  3: 'incategory:"Three Pools Mirroring the Moon"',
  6: 'incategory:"Feilaifeng"',
  7: '(intitle:"九溪" OR intitle:"Jiuxi" OR intitle:"Nine Creeks") -intitle:"图卷"',
  8: 'incategory:"Xixi National Wetland Park"',
};
await fs.mkdir(path.join(out, 'previews'), { recursive: true });
const strip = (s: unknown) => typeof s === 'string' ? s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : '';
const wait = () => new Promise(resolve => setTimeout(resolve, 1100));
async function json(url: string, headers = {}) {
  const response = await fetch(url, { headers: { 'User-Agent': 'TripweaverPhotoPilot/1.0 (local research)', ...headers }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`source HTTP ${response.status}`);
  return response.json();
}
async function cached(name: string, fetcher: () => Promise<unknown>) {
  const file = path.join(out, name + '.json');
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (err: any) { if (err.code !== 'ENOENT') throw err; }
  await wait();
  const value = await fetcher();
  await fs.writeFile(file, JSON.stringify(value, null, 2));
  return value;
}
const candidates: any[] = focused ? JSON.parse(await fs.readFile(path.join(out, 'candidates.json'), 'utf8')) : [];
for (const [index, target] of targets.entries()) {
  if (focused && !focusedQueries[index]) continue;
  if (!focused && process.env.PEXELS_API_KEY) {
    try {
      // 横竖图同等参选；新缓存键避免沿用过去仅横图的检索结果。
      const data = await cached(`pexels-${index}-all-orientations`, () => json('https://api.pexels.com/v1/search?' + new URLSearchParams({ query: target.pexels, size: 'large', per_page: '12' }), { Authorization: process.env.PEXELS_API_KEY! }));
      for (const photo of data.photos ?? []) candidates.push({
        id: `pexels-${photo.id}`, place: target.name, source: 'pexels', title: photo.alt,
        sourceUrl: photo.url, photographer: photo.photographer, photographerUrl: photo.photographer_url,
        license: 'Pexels License', licenseUrl: 'https://www.pexels.com/license/',
        width: photo.width, height: photo.height, imageUrl: photo.src?.large2x,
        previewUrl: photo.src?.medium, evidence: photo.alt, review: 'pending',
      });
    } catch (err) { console.error(JSON.stringify({ place: target.name, source: 'pexels', error: String(err) })); }
  }
  try {
    const data = await cached(`commons-${index}${focused ? '-focused' : ''}`, () => json('https://commons.wikimedia.org/w/api.php?' + new URLSearchParams({ action: 'query', format: 'json', generator: 'search', gsrsearch: (focused ? focusedQueries[index] : target.commons) + ' filetype:bitmap', gsrnamespace: '6', gsrlimit: focused ? '30' : '16', prop: 'imageinfo', iiprop: 'url|size|extmetadata', iiurlwidth: '1400' })));
    if (data.error) throw new Error(data.error.code);
    for (const page of Object.values(data.query?.pages ?? {}) as any[]) {
      const info = page.imageinfo?.[0]; if (!info) continue;
      if (candidates.some(c => c.id === `commons-${page.pageid}` && c.place === target.name)) continue;
      const meta = info.extmetadata ?? {};
      candidates.push({ id: `commons-${page.pageid}`, place: target.name, source: 'commons', title: page.title,
        sourceUrl: info.descriptionurl, photographer: strip(meta.Artist?.value),
        license: strip(meta.LicenseShortName?.value), licenseUrl: meta.LicenseUrl?.value || '',
        width: info.width, height: info.height, imageUrl: info.thumburl || info.url,
        previewUrl: info.thumburl || info.url, evidence: strip(meta.ImageDescription?.value),
        categories: strip(meta.Categories?.value), objectName: strip(meta.ObjectName?.value), review: 'pending',
      });
    }
  } catch (err) { console.error(JSON.stringify({ place: target.name, source: 'commons', error: String(err) })); }
  console.log(JSON.stringify({ place: target.name, candidates: candidates.filter(c => c.place === target.name).length }));
  await fs.writeFile(path.join(out, 'candidates.json'), JSON.stringify(candidates, null, 2));
}

// 图片下载无 Authorization；仅允许两个图源的固定 HTTPS 图片域名，拒绝重定向，单张 8 MiB。
let cursor = 0;
const photos = [...new Map(candidates.map(c => [c.id, c])).values()];
const blockedHosts = new Set<string>();
const errors: { id: string; error: string }[] = [];
await Promise.all(Array.from({ length: 1 }, async () => {
  for (;;) {
    const photo = photos[cursor++]; if (!photo) break;
    if (Math.max(photo.width, photo.height) < 1400 || Math.min(photo.width, photo.height) < 800) continue;
    const file = path.join(out, 'previews', photo.id + '.jpg');
    try {
      await fs.access(file);
    } catch {
      try {
        const url = new URL(photo.previewUrl);
        if (url.protocol !== 'https:' || !['images.pexels.com', 'upload.wikimedia.org', 'thumb.wikimedia.org'].includes(url.hostname) || url.username || url.password || url.port) throw new Error('image host rejected');
        if (blockedHosts.has(url.hostname)) continue;
        await wait();
        const response = await fetch(url, { signal: AbortSignal.timeout(20_000), redirect: 'error' });
        if (response.status === 429) blockedHosts.add(url.hostname);
        if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) throw new Error(`image HTTP ${response.status}`);
        const chunks = []; let bytes = 0;
        for await (const chunk of response.body as any) { bytes += chunk.length; if (bytes > 8 * 1024 * 1024) throw new Error('image too large'); chunks.push(chunk); }
        await fs.writeFile(file, Buffer.concat(chunks));
      } catch (err) { errors.push({ id: photo.id, error: String(err) }); console.error(JSON.stringify(errors.at(-1))); }
    }
  }
}));
await fs.writeFile(path.join(out, 'download-errors.json'), JSON.stringify({ errors, blockedHosts: [...blockedHosts] }, null, 2));
console.log(JSON.stringify({ candidatePairs: candidates.length, uniquePhotos: photos.length, output: out }));
