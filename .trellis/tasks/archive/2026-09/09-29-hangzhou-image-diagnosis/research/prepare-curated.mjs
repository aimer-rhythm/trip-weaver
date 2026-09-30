// 下载已人工查看联系表的少量候选；此脚本不批准照片、不更新精选清单。
import '../../../../apps/server/src/lib/proxy.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
const base = path.resolve('data/photo-pilot');
const photos = JSON.parse(await fs.readFile(path.join(base, 'candidates.json'), 'utf8'));
const ids = ['pexels-11798710', 'pexels-38075805', 'pexels-12076683', 'pexels-11798773'];
await fs.mkdir(path.join(base, 'full'), { recursive: true });
for (const id of ids) {
  const photo = photos.find(p => p.id === id);
  const file = path.join(base, 'full', id + '.jpg');
  try { await fs.access(file); continue; } catch {}
  const url = new URL(photo.imageUrl);
  if (url.protocol !== 'https:' || url.hostname !== 'images.pexels.com' || url.port || url.username || url.password) throw new Error('图片域名不合法');
  const response = await fetch(url, { signal: AbortSignal.timeout(20000), redirect: 'error' });
  if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) throw new Error(`图片下载失败 ${response.status}`);
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 8 * 1024 * 1024) throw new Error('图片超限');
    chunks.push(chunk);
  }
  await fs.writeFile(file, Buffer.concat(chunks));
  console.log(JSON.stringify({ id, bytes: size }));
}
