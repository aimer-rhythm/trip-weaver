// 固定北京行程的摄影样本：仅采集并保存候选，不写行程、不自动批准照片。
import '../../../../apps/server/src/lib/proxy.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const out = path.resolve('data/photo-pilot/beijing');
await fs.mkdir(path.join(out, 'previews'), { recursive: true });
const targets = [
  ['故宫博物院', 'Forbidden City Beijing', '"Forbidden City" Beijing sunset'],
  ['景山公园', 'Jingshan Park Beijing', '"Jingshan Park" Beijing'],
  ['北海公园', 'Beihai Park Beijing', '"Beihai Park" Beijing'],
  ['什刹海', 'Shichahai Beijing', '"Shichahai" Beijing'],
  ['天坛公园', 'Temple of Heaven Beijing', '"Temple of Heaven" Beijing'],
  ['中国国家博物馆', 'National Museum China Beijing', '"National Museum of China"'],
  ['雍和宫', 'Yonghe Temple Beijing', '"Yonghe Temple" Beijing'],
  ['颐和园', 'Summer Palace Beijing', '"Summer Palace" Beijing sunset'],
  ['八达岭长城', 'Badaling Great Wall', '"Badaling" Great Wall'],
];
const candidates: any[] = [], errors: any[] = [];
const strip = (s: unknown) => typeof s === 'string' ? s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : '';
const pause = () => new Promise(resolve => setTimeout(resolve, 1050));
let requests = 0;
async function cached(url: string, headers: Record<string, string> = {}) {
  const file = path.join(out, 'query-' + createHash('sha256').update(url).digest('hex') + '.json');
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  await pause(); requests++;
  const r = await fetch(url, { headers: { 'User-Agent': 'TripweaverPhotoPilot/1.0', ...headers }, redirect: 'error', signal: AbortSignal.timeout(20000) });
  if (r.status !== 200) throw new Error(`source HTTP ${r.status}`);
  const data = await r.json();
  await fs.writeFile(file, JSON.stringify(data, null, 2));
  return data;
}
function score(p: any) {
  return (p.width > p.height ? 4 : 0) + (/sunset|sunrise|dusk|twilight|mist|snow|autumn|night|夕|暮|晨|雪|秋|夜/i.test(p.title + p.evidence) ? 2 : 0)
    - (/portrait|girl|woman|man posing|tourists|crowd|人像|游客/i.test(p.title) ? 4 : 0);
}
for (const [place, query, commons] of targets) {
  for (const source of ['pexels', 'commons', 'flickr']) {
    try {
      const pool: any[] = [];
      if (source === 'pexels') {
        if (!process.env.PEXELS_API_KEY) continue;
        const data = await cached('https://api.pexels.com/v1/search?' + new URLSearchParams({ query: query!, orientation: 'landscape', per_page: '12' }), { Authorization: process.env.PEXELS_API_KEY });
        for (const p of data.photos ?? []) pool.push({ id: `pexels-${p.id}`, source, place, query, title: p.alt, evidence: p.alt,
          sourceUrl: p.url, photographer: p.photographer, license: 'Pexels License', licenseUrl: 'https://www.pexels.com/license/',
          width: p.width, height: p.height, imageUrl: p.src?.large2x, review: 'pending' });
      } else if (source === 'commons') {
        const data = await cached('https://commons.wikimedia.org/w/api.php?' + new URLSearchParams({ action: 'query', format: 'json', generator: 'search', gsrsearch: commons + ' filetype:bitmap', gsrnamespace: '6', gsrlimit: '12', prop: 'imageinfo', iiprop: 'url|size|extmetadata', iiurlwidth: '1600' }));
        if (data.error) throw new Error(data.error.code);
        for (const p of Object.values(data.query?.pages ?? {}) as any[]) {
          const i = p.imageinfo?.[0]; if (!i) continue;
          const m = i.extmetadata ?? {}, license = strip(m.LicenseShortName?.value);
          if (!/^CC (BY|BY-SA) [234]\.0$|^CC0$/.test(license)) continue;
          pool.push({ id: `commons-${p.pageid}`, source, place, query: commons, title: p.title, evidence: strip(m.ImageDescription?.value), categories: strip(m.Categories?.value),
            sourceUrl: i.descriptionurl, photographer: strip(m.Artist?.value), license, licenseUrl: (m.LicenseUrl?.value ?? '').replace(/^http:/, 'https:'),
            width: i.width, height: i.height, imageUrl: i.thumburl || i.url, review: 'pending' });
        }
      } else {
        // 摄影补充仅限三个地点，每处两张预览，避免把试用扩成整城抓取。
        if (!['故宫博物院', '天坛公园', '八达岭长城'].includes(place!)) continue;
        const data = await cached('https://api.openverse.org/v1/images/?' + new URLSearchParams({ q: query!, source: 'flickr', license: 'by,by-sa,cc0', aspect_ratio: 'wide', page_size: '10', mature: 'false' }));
        for (const p of data.results ?? []) if (p.source === 'flickr' && !p.mature && ['by', 'by-sa', 'cc0'].includes(p.license)) pool.push({
          id: `openverse-${p.id}`, source, place, query, title: p.title, evidence: p.title, sourceUrl: p.foreign_landing_url, photographer: p.creator,
          license: p.license, licenseUrl: p.license_url, width: p.width, height: p.height, imageUrl: p.url, review: 'pending' });
      }
      let count = 0;
      for (const photo of pool.sort((a,b) => score(b) - score(a))) {
        candidates.push(photo);
        if (count >= (source === 'flickr' ? 2 : 4) || (photo.width && photo.height && (photo.width < photo.height || Math.max(photo.width, photo.height) < 1000))) continue;
        count++;
        try {
          const file = path.join(out, 'previews', photo.id + '.jpg');
          try { await fs.access(file); }
          catch {
            const url = new URL(photo.imageUrl);
            if (url.protocol !== 'https:' || url.username || url.password || url.port || !['images.pexels.com','upload.wikimedia.org','thumb.wikimedia.org','live.staticflickr.com'].includes(url.hostname)) throw new Error('invalid image host');
            await pause(); requests++;
            const r = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(16000) });
            if (r.status !== 200 || !/^image\/(jpeg|png|webp)(;|$)/i.test(r.headers.get('content-type') ?? '') || Number(r.headers.get('content-length')) > 8*1024*1024) { await r.body?.cancel(); throw new Error(`image HTTP ${r.status}`); }
            const reader = r.body?.getReader(); if (!reader) throw new Error('empty image');
            const chunks: Uint8Array[] = []; let size = 0;
            try { for (;;) { const c = await reader.read(); if (c.done) break; size += c.value.length; if (size > 8*1024*1024) throw new Error('image too large'); chunks.push(c.value); } }
            finally { await reader.cancel(); }
            const bytes = Buffer.concat(chunks);
            if (!((bytes[0] === 255 && bytes[1] === 216) || bytes.subarray(1,4).toString() === 'PNG' || bytes.subarray(0,4).toString() === 'RIFF')) throw new Error('invalid raster');
            await fs.writeFile(file, bytes);
          }
          photo.preview = 'previews/' + photo.id + '.jpg';
        } catch (error) { photo.previewError = error instanceof Error ? error.message : 'image failed'; }
      }
      console.log(JSON.stringify({ place, source, records: pool.length, previews: pool.filter(p => p.preview).length }));
    } catch (error) { errors.push({ place, source, reason: error instanceof Error ? error.message : 'source failure' }); }
    await fs.writeFile(path.join(out, 'candidates.json'), JSON.stringify({ candidates, errors }, null, 2));
  }
}
console.log(JSON.stringify({ candidates: candidates.length, previews: candidates.filter(p => p.preview).length, requests, errors }));
