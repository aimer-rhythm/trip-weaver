// 复看既有入选照片：按固定照片ID取原作品信息，不重新搜索。
import '../../../../apps/server/src/lib/proxy.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import { saveRemotePhoto } from '../../../../apps/server/src/integrations/photoStore.ts';
const out = path.resolve('data/photo-pilot/beijing');
const trip = JSON.parse(await fs.readFile(path.join(out,'existing-trips.json'),'utf8'))[0].data;
const data = JSON.parse(await fs.readFile(path.join(out,'candidates.json'),'utf8'));
for (const poi of trip.overview.filter((p:any) => p.coverUrl?.startsWith('https://images.pexels.com/'))) {
  const id = new URL(poi.coverUrl).pathname.match(/\/photos\/(\d+)\//)?.[1];
  if (!id || data.candidates.some((p:any) => p.place === poi.name && p.id === `pexels-${id}`)) continue;
  const file = path.join(out, `existing-${id}.json`);
  let p;
  try { p = JSON.parse(await fs.readFile(file,'utf8')); }
  catch {
    const r = await fetch(`https://api.pexels.com/v1/photos/${id}`, { headers: { Authorization: process.env.PEXELS_API_KEY! }, signal: AbortSignal.timeout(15000) });
    if (r.status !== 200) throw new Error(`Pexels photo HTTP ${r.status}`);
    p = await r.json(); await fs.writeFile(file, JSON.stringify(p,null,2));
  }
  const original = { source:'pexels' as const, photographer:p.photographer, sourceUrl:p.url, license:'Pexels License',licenseUrl:'https://www.pexels.com/license/',changes:'图源尺寸版本，未另行裁切' };
  const local = await saveRemotePhoto({ url:p.src.large2x, attribution:original });
  if (!local) throw new Error('入选照片保存失败');
  const preview = `previews/pexels-${id}.jpg`;
  await fs.copyFile(path.resolve('data',local.url.slice(1)), path.join(out,preview));
  data.candidates.push({ id:`pexels-${id}`, place:poi.name, source:'pexels', title:p.alt,evidence:p.alt,sourceUrl:p.url,photographer:p.photographer,
    license:original.license,licenseUrl:original.licenseUrl,width:p.width,height:p.height,imageUrl:p.src.large2x,preview,review:'pending',wasCover:true });
  console.log(JSON.stringify({place:poi.name,id,saved:true}));
}
await fs.writeFile(path.join(out,'candidates.json'),JSON.stringify(data,null,2));
