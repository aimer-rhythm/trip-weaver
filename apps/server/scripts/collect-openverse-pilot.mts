// 有界补充来源候选：Openverse 索引的 Flickr CC 作品，人工审阅后才可进入正式图库。
import '../src/lib/proxy.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const out = path.join(root, 'data/photo-pilot/openverse');
await fs.mkdir(path.join(out, 'previews'), { recursive: true });
const targets = [
  ['西湖断桥', 'Hangzhou Broken Bridge'], ['九溪烟树', 'Hangzhou Jiuxi'],
  ['飞来峰', 'Hangzhou Feilai'], ['雷峰塔', 'Hangzhou Leifeng Pagoda'],
];
const candidates: Record<string, unknown>[] = [], errors: { place: string; reason: string }[] = [];
const pause = () => new Promise(resolve => setTimeout(resolve, 1200));
for (const [index, [place, query]] of targets.entries()) {
  try {
    const file = path.join(out, `search-${index}.json`);
    let data;
    try { data = JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await pause();
      const params = new URLSearchParams({ q: query!, source: 'flickr', license: 'by,by-sa,cc0', aspect_ratio: 'wide', page_size: '20', mature: 'false' });
      const response = await fetch(`https://api.openverse.org/v1/images/?${params}`, { signal: AbortSignal.timeout(20000), redirect: 'error', headers: { 'User-Agent': 'TripweaverPhotoPilot/1.0 (bounded local review)' } });
      if (!response.ok) throw new Error(`Openverse HTTP ${response.status}`);
      data = await response.json();
      await fs.writeFile(file, JSON.stringify(data, null, 2));
    }
    let downloaded = 0;
    for (const item of data.results ?? []) {
      if (item.source !== 'flickr' || !['by', 'by-sa', 'cc0'].includes(item.license) || item.mature) continue;
      const url = new URL(item.url);
      const id = String(item.id);
      if (!/^[a-f0-9-]{36}$/.test(id) || url.protocol !== 'https:' || url.username || url.password || url.port || url.hostname !== 'live.staticflickr.com') continue;
      const photo: Record<string, unknown> = { id: `openverse-${id}`, place, query, source: 'flickr', discoverySource: 'Openverse',
        title: item.title, photographer: item.creator, sourceUrl: item.foreign_landing_url, imageUrl: item.url,
        license: item.license, licenseVersion: item.license_version, licenseUrl: item.license_url,
        width: item.width, height: item.height, tags: item.tags, review: 'pending', preview: null };
      const preview = path.join(out, 'previews', id + '.jpg');
      try {
        await fs.access(preview); photo.preview = 'previews/' + id + '.jpg'; downloaded++;
      } catch {
        if (downloaded < 6) {
          downloaded++;
          try {
            await pause();
            const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(12000), headers: { Accept: 'image/jpeg' } });
            if (response.status !== 200 || !response.headers.get('content-type')?.startsWith('image/jpeg') || Number(response.headers.get('content-length')) > 8 * 1024 * 1024) {
              await response.body?.cancel(); throw new Error(`image HTTP ${response.status}`);
            }
            const reader = response.body?.getReader(); if (!reader) throw new Error('empty image');
            const chunks: Uint8Array[] = []; let bytes = 0;
            try {
              for (;;) {
                const chunk = await reader.read(); if (chunk.done) break;
                bytes += chunk.value.byteLength; if (bytes > 8 * 1024 * 1024) throw new Error('image too large');
                chunks.push(chunk.value);
              }
            } finally { await reader.cancel(); }
            const image = Buffer.concat(chunks);
            if (image[0] !== 255 || image[1] !== 216 || image[2] !== 255) throw new Error('not JPEG');
            await fs.writeFile(preview, image); photo.preview = 'previews/' + id + '.jpg';
          } catch (error) { photo.previewError = error instanceof Error ? error.message : 'image failure'; }
        }
      }
      candidates.push(photo);
    }
    console.log(JSON.stringify({ place, candidates: candidates.filter(p => p.place === place).length, previews: candidates.filter(p => p.place === place && p.preview).length }));
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'source failure';
    errors.push({ place: place!, reason }); console.log(JSON.stringify({ place, reason }));
  }
  await fs.writeFile(path.join(out, 'candidates.json'), JSON.stringify({ collectedAt: new Date().toISOString(), candidates, errors }, null, 2));
}
console.log(JSON.stringify({ candidates: candidates.length, previews: candidates.filter(p => p.preview).length, errors }));
