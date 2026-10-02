// 五个相同地点的有界多图源试片：查询缓存、预览与证据只写本任务；不改图库或行程。
import { config } from 'dotenv';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { matchesStockPlace, safePhotoUrl } from '../../../../apps/server/src/integrations/stockPhotoSupport';
import { saveRemotePhoto } from '../../../../apps/server/src/integrations/photoStore';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
config({ path: [path.join(root, 'apps/server/.env'), path.join(root, '.env')], quiet: true });
await import('../../../../apps/server/src/lib/proxy');
const allPools = process.argv.includes('--all-pools');
const out = path.join(here, allPools ? 'live/all-pools' : 'live/comparison');
await fs.mkdir(path.join(out, 'queries'), { recursive: true });
const baseTargets = [
  ['故宫博物院', 'Forbidden City Beijing'], ['天坛', 'Temple of Heaven Beijing'],
  ['景山公园', 'Jingshan Park Beijing'], ['颐和园', 'Summer Palace Beijing'],
  ['八达岭长城', 'Badaling Great Wall'],
];
const english: Record<string,string> = {
  '天安门广场':'Tiananmen Square Beijing','天安门城楼':'Tiananmen Gate Beijing','天安门升旗':'Tiananmen Flag Raising Beijing',
  '国家博物馆':'National Museum of China Beijing','故宫博物院':'Forbidden City Beijing','景山公园':'Jingshan Park Beijing',
  '北海公园':'Beihai Park Beijing','天坛公园':'Temple of Heaven Beijing','雍和宫':'Lama Temple Beijing',
  '国子监':'Guozijian Beijing','恭王府':'Prince Gong Mansion Beijing','颐和园':'Summer Palace Beijing',
  '圆明园':'Old Summer Palace Beijing','八达岭长城':'Badaling Great Wall','慕田峪长城':'Mutianyu Great Wall Beijing',
  '鸟巢（国家体育场）':'Beijing National Stadium Bird Nest','水立方':'Water Cube Beijing','奥林匹克公园':'Olympic Park Beijing',
  '798艺术区':'798 Art District Beijing','什刹海':'Shichahai Beijing','烟袋斜街':'Yandai Xiejie Beijing',
  '鼓楼':'Drum Tower Beijing','南锣鼓巷':'Nanluoguxiang Beijing','前门大街':'Qianmen Street Beijing','王府井':'Wangfujing Beijing',
};
const trip = allPools ? JSON.parse(await fs.readFile(path.join(here,'verification/beijing-seven-days/trip.json'),'utf8')) : null;
const targets: string[][] = allPools ? trip.overview.filter((p:any)=>p.category==='attraction').map((p:any)=>[p.name,english[p.name]??`${p.name} Beijing`]) : baseTargets;
const old = allPools ? JSON.parse(await fs.readFile(path.join(here,'live/comparison/candidates.json'),'utf8')) : null;
const blocked = new Set<string>();
const sources = ['pexels', 'unsplash', 'pixabay', 'commons'];
const candidates: any[] = [], searches: any[] = [], errors: any[] = [];
const strip = (s: unknown) => typeof s === 'string' ? s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : '';
const headersFor = (source: string): Record<string,string> => source === 'pexels' ? { Authorization: process.env.PEXELS_API_KEY! }
  : source === 'unsplash' ? { Authorization: `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}`, 'Accept-Version': 'v1' } : {};
const configured: Record<string,boolean> = { pexels: !!process.env.PEXELS_API_KEY, unsplash: !!process.env.UNSPLASH_ACCESS_KEY, pixabay: !!process.env.PIXABAY_API_KEY, commons: true };
const requests = { search: 0, download: 0 };
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const host = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).hostname;
  if (['api.pexels.com', 'api.unsplash.com', 'commons.wikimedia.org'].includes(host) || host === 'pixabay.com' && String(input).includes('/api/')) {
    if (++requests.search > (allPools ? 100 : 20)) throw new Error('search budget');
  } else {
    if (++requests.download > (allPools ? 450 : 90)) throw new Error('download budget');
  }
  return originalFetch(input, init);
};
async function json(source: string, query: string, url: string) {
  // 缓存键不包含 Pixabay 密钥；失败不写成功缓存。
  const file = path.join(out, 'queries', `${source}-${createHash('sha256').update(query).digest('hex')}.json`);
  try { return { body: JSON.parse(await fs.readFile(file, 'utf8')), cached: true }; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (allPools) {
    try {
      const prior = await fs.readFile(path.join(here,'live/comparison/queries',path.basename(file)), 'utf8');
      await fs.writeFile(file, prior);
      return { body: JSON.parse(prior), cached: true };
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  if (blocked.has(source)) throw new Error('provider rate limited');
  await new Promise(resolve => setTimeout(resolve, 1100));
  const r = await fetch(url, { headers: { ...headersFor(source), 'User-Agent': 'TripweaverPhotoComparison/1.0' }, redirect: 'error', signal: AbortSignal.timeout(20000) });
  if (r.status === 429 || r.headers.get('x-ratelimit-remaining') === '0') blocked.add(source);
  if (r.status !== 200) { await r.body?.cancel(); throw new Error(`HTTP ${r.status}`); }
  const text = await r.text();
  if (Buffer.byteLength(text) > 2 * 1024 * 1024) throw new Error('JSON too large');
  const body = JSON.parse(text);
  await fs.writeFile(file, text);
  return { body, cached: false };
}
const referral = (url: string) => { const u = new URL(url); u.searchParams.set('utm_source', 'tripweaver'); u.searchParams.set('utm_medium', 'referral'); return u.href; };
function score(p: any) {
  const text = `${p.title} ${p.evidence} ${p.sourceUrl}`;
  return (matchesStockPlace(text, {city:'北京',name:p.place}) ? 10 : 0) + (p.width >= p.height ? 3 : 0)
    + (/sunset|sunrise|dusk|twilight|mist|snow|autumn|night|夕|暮|晨|雪|秋|夜/i.test(text) ? 2 : 0)
    - (/portrait|posing|selfie|人像|摆拍/.test(text) ? 8 : 0);
}
for (const [place, query] of targets) {
  for (const source of sources) {
    if (!configured[source]) { searches.push({place, source, configured:false}); continue; }
    try {
      let url = '';
      if (source === 'pexels') url = 'https://api.pexels.com/v1/search?' + new URLSearchParams({ query: query!, per_page:'20' });
      if (source === 'unsplash') url = 'https://api.unsplash.com/search/photos?' + new URLSearchParams({ query: query!, per_page:'20', content_filter:'high' });
      if (source === 'pixabay') url = 'https://pixabay.com/api/?' + new URLSearchParams({ key: process.env.PIXABAY_API_KEY!, q:query!, per_page:'30', image_type:'photo', safesearch:'true' });
      if (source === 'commons') url = 'https://commons.wikimedia.org/w/api.php?' + new URLSearchParams({ action:'query', format:'json', generator:'search', gsrsearch: query! + ' filetype:bitmap', gsrnamespace:'6', gsrlimit:'20', prop:'imageinfo', iiprop:'url|size|extmetadata', iiurlwidth:'1600' });
      const {body:data,cached} = await json(source,query!,url);
      const pool: any[] = [];
      if (source === 'pexels') for (const p of data.photos ?? []) pool.push({ id:`pexels-${p.id}`, title:p.alt, evidence:p.alt, sourceUrl:p.url, photographer:p.photographer, license:'Pexels License', licenseUrl:'https://www.pexels.com/license/', width:p.width,height:p.height,imageUrl:p.src?.large2x });
      if (source === 'unsplash') for (const p of data.results ?? []) pool.push({ id:`unsplash-${p.id}`, title:p.alt_description ?? '', evidence:p.description ?? '', sourceUrl:referral(p.links.html), photographer:p.user.name, photographerUrl:referral(p.user.links.html), license:'Unsplash License', licenseUrl:referral('https://unsplash.com/license'), width:p.width,height:p.height,imageUrl:p.urls.regular });
      if (source === 'pixabay') for (const p of data.hits ?? []) pool.push({ id:`pixabay-${p.id}`, title:p.tags, evidence:p.tags, sourceUrl:p.pageURL, photographer:p.user, license:'Pixabay Content License', licenseUrl:'https://pixabay.com/service/license-summary/', width:p.imageWidth,height:p.imageHeight,imageUrl:p.largeImageURL });
      if (source === 'commons') for (const p of Object.values(data.query?.pages ?? {}) as any[]) {
        const i=p.imageinfo?.[0]; if (!i) continue;
        const m=i.extmetadata ?? {}, license=strip(m.LicenseShortName?.value);
        if (!/^CC (BY|BY-SA) [234]\.0$|^CC0$|^Public domain$/.test(license)) continue;
        pool.push({id:`commons-${p.pageid}`, title:p.title,evidence:strip(m.ImageDescription?.value),categories:strip(m.Categories?.value),sourceUrl:i.descriptionurl, photographer:strip(m.Artist?.value),license,licenseUrl:(m.LicenseUrl?.value ?? 'https://creativecommons.org/publicdomain/mark/1.0/').replace(/^http:/,'https:'),width:i.width,height:i.height,imageUrl:i.thumburl || i.url});
      }
      pool.forEach(p=>Object.assign(p,{place,query,source,review:'pending'}));
      pool.sort((a,b)=>score(b)-score(a));
      candidates.push(...pool);
      const preview = async (p:any) => {
        if (source === 'unsplash') {
          if (safePhotoUrl(p.imageUrl,['images.unsplash.com'])) p.preview=p.imageUrl; // 原始官方 hotlink，不自托管、不触发“采用”事件。
        } else {
          const prior = old?.candidates.find((c:any)=>c.id===p.id&&c.imageUrl===p.imageUrl&&c.preview&&!c.preview.startsWith('http'));
          if (prior) {
            const to=path.join(out,prior.preview);
            await fs.mkdir(path.dirname(to),{recursive:true});
            await fs.copyFile(path.join(here,'live/comparison',prior.preview),to);
            p.preview=prior.preview; p.previewReused=true; return;
          }
          const saved=await saveRemotePhoto({url:p.imageUrl},out);
          if (saved) p.preview=saved.url.replace(/^\//,''); else p.previewError='download failed';
        }
      };
      for(let start=0;start<Math.min(pool.length,6);start+=2) await Promise.all(pool.slice(start,start+2).map(preview));
      searches.push({place,source,query,cached,records:pool.length,previews:pool.filter(p=>p.preview).length});
      console.log(JSON.stringify(searches.at(-1)));
    } catch(error) {
      const reason=error instanceof Error && /^HTTP \d+$/.test(error.message) ? error.message : 'source request failed';
      errors.push({place,source,reason}); console.log(JSON.stringify(errors.at(-1)));
    }
    await fs.writeFile(path.join(out,'candidates.json'),JSON.stringify({at:new Date().toISOString(),targets,configured,requests,searches,errors,candidates},null,2));
  }
}
console.log(JSON.stringify({requests,candidates:candidates.length,previews:candidates.filter(p=>p.preview).length,errors}));
