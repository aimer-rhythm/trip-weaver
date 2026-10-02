// 对比用只读精选/小红书，加独立高德查询；仅写本任务及正常高德预算账本。
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { config } from 'dotenv';
import pg from 'pg';
const here=path.dirname(fileURLToPath(import.meta.url)), root=path.resolve(here,'../../../..');
config({path:[path.join(root,'apps/server/.env'),path.join(root,'.env')],quiet:true});
await import('../../../../apps/server/src/lib/proxy');
const {env}=await import('../../../../apps/server/src/env');
const {createCuratedCoverLookup}=await import('../../../../apps/server/src/integrations/curatedPhotos');
const {normalizePlaceKey}=await import('../../../../apps/server/src/lib/placeKey');
const {amapRequest,amapQuotaGate}=await import('../../../../apps/server/src/integrations/amap/request');
const {createAmapQuotaLedger}=await import('../../../../apps/server/src/lib/amapQuotaLedger');
const out=path.join(here,'live/all-pools');
await fs.mkdir(path.join(out,'queries'),{recursive:true});
const trip=JSON.parse(await fs.readFile(path.join(here,'verification/beijing-seven-days/trip.json'),'utf8'));
const curated=JSON.parse(await fs.readFile(path.join(root,'apps/server/src/data/photography/beijing-curated.json'),'utf8'));
const xhs=JSON.parse(await fs.readFile(path.join(here,'preview/xhs-place-images-beijing.json'),'utf8'));
const db=new pg.Client({connectionString:env.databaseUrl});await db.connect();
const ledger=createAmapQuotaLedger(db,env.amapServiceBudgets);
amapQuotaGate.acquire=service=>ledger.acquire(service); // 使用同一个真实持久账本，不加载启动迁移。
const readCurated=createCuratedCoverLookup('北京');
const candidates:any[]=[],searches:any[]=[],errors:any[]=[];
let requests=0;
const key=(s:string)=>normalizePlaceKey(s.normalize('NFKC').trim());
async function local(base:string, relative:string) {
  const file=path.resolve(base,relative);
  if(!file.startsWith(path.resolve(base)+path.sep)||!/^\.(webp|jpg|jpeg|png)$/.test(path.extname(file)))return null;
  try {
    const bytes=await fs.readFile(file), preview=`media/local/${createHash('sha256').update(bytes).digest('hex')}${path.extname(file)}`;
    await fs.mkdir(path.dirname(path.join(out,preview)),{recursive:true});await fs.writeFile(path.join(out,preview),bytes);return preview;
  }catch{return null;}
}
try {
  const rows=(await db.query("SELECT name,payload FROM canonical_places WHERE city=$1",['北京'])).rows;
  for(const place of trip.overview.filter((p:any)=>p.category==='attraction')) {
    const name=place.name;
    const saved=await readCurated(name);
    for(const photo of saved?.photos??[]) {
      const relative=photo.url.replace(/^\/media\//,''),preview=await local(path.join(root,'data/media'),relative);
      const meta=curated.places.flatMap((p:any)=>p.photos).find((p:any)=>p.key===relative);
      if(preview)candidates.push({place:name,id:`curated-${meta.id}`,preview,...photo.attribution,
        source:'curated',underlyingSource:photo.attribution?.source,title:meta.review.evidence,evidence:meta.review.quality,
        review:'curated',reviewDetail:meta.review,current:trip.overview.find((p:any)=>p.name===name)?.coverUrl===photo.url});
    }
    searches.push({place:name,source:'curated',cached:true,records:candidates.filter(p=>p.place===name&&p.source==='curated').length});
    const found=rows.filter(r=>[r.name,...(Array.isArray(r.payload?.aliases)?r.payload.aliases:[])].some(s=>typeof s==='string'&&key(s)===key(name)));
    for(const row of found) {
      const photos=[...(Array.isArray(row.payload?.imageGallery)?row.payload.imageGallery:[]),...(row.payload?.coverImage?[{key:row.payload.coverImage}]:[])];
      for(const photo of photos) {
        if(typeof photo.key!=='string'||!photo.key.startsWith('xhs/'))continue;
        const preview=await local(path.join(root,'data/media'),photo.key);
        if(!preview||candidates.some(p=>p.place===name&&p.source==='xhs'&&p.preview===preview))continue;
        candidates.push({place:name,source:'xhs',id:`xhs-${path.basename(preview)}`,preview,title:row.name,
          photographer:photo.attribution?.photographer??'原笔记作者（旧记录未提供）',sourceUrl:photo.attribution?.sourceUrl,
          license:'未确认授权',evidence:'库内已导入图片；本轮未重新采集',review:'stored'});
      }
    }
    for(const photo of xhs.images.filter((p:any)=>key(p.placeName)===key(name))) {
      const preview=await local(path.join(here,'preview/media'),photo.key);
      if(!preview||candidates.some(p=>p.place===name&&p.source==='xhs'&&p.preview===preview))continue;
      candidates.push({place:name,source:'xhs',id:`xhs-pilot-${photo.sha256}`,preview,title:name,width:photo.width,height:photo.height,
        photographer:photo.author,sourceUrl:photo.sourceUrl,license:'未确认授权',evidence:photo.review?.evidence??'',review:'pilot',
        origin:'TOP20中5景点的定向试点，未跑完整TOP20'});
    }
    searches.push({place:name,source:'xhs',cached:true,records:candidates.filter(p=>p.place===name&&p.source==='xhs').length,
      note:'已导入图片＋此前定向试点；未新增小红书请求'});
    const file=path.join(out,'queries',`amap-${createHash('sha256').update(name).digest('hex')}.json`);
    let data:any,cached=false;
    try {
      try{data=JSON.parse(await fs.readFile(file,'utf8'));cached=true;}catch(e:any){if(e.code!=='ENOENT')throw e;}
      if(!data&&env.amapKey) {
        if(++requests>25)throw Error('budget');
        data=await amapRequest('place',new URLSearchParams({key:env.amapKey,keywords:name,region:'北京',city_limit:'true',show_fields:'photos',page_size:'3'}));
        await fs.writeFile(file,JSON.stringify(data));
        await new Promise(resolve=>setTimeout(resolve,1100));
      }
      const photos=(data?.pois??[]).flatMap((p:any)=>(p.photos??[]).map((photo:any,i:number)=>({
        place:name,source:'amap',id:`amap-${p.id}-${i}`,title:p.name,evidence:p.type,sourceUrl:`https://www.amap.com/detail/${p.id}`,
        imageUrl:photo.url,preview:typeof photo.url==='string'?photo.url.replace(/^http:/,'https:'):null,
        photographer:'高德POI图片（未提供作者）',poiPhotoTitle:photo.title,license:'高德POI图片',review:'pending',poiName:p.name
      }))).filter((p:any)=>{
        try{const u=new URL(p.preview);return u.protocol==='https:'&&!u.username&&!u.password&&['store.is.autonavi.com','aos-comment.amap.com','picinfo.openstreetmap.cn','store.is.autonavi.com'].includes(u.hostname);}catch{return false;}
      });
      const dedup=photos.filter((p:any,i:number)=>photos.findIndex((q:any)=>q.preview===p.preview)===i);
      candidates.push(...dedup.slice(0,6));searches.push({place:name,source:'amap',cached,configured:!!env.amapKey,records:dedup.length,previews:Math.min(dedup.length,6)});
    }catch(e){errors.push({place:name,source:'amap',reason:'高德查询失败或预算不足'});}
    await fs.writeFile(path.join(out,'local-pools.json'),JSON.stringify({tripId:trip.id,requests,searches,errors,candidates},null,2));
    console.log(JSON.stringify({place:name,curated:candidates.filter(p=>p.place===name&&p.source==='curated').length,
      xhs:candidates.filter(p=>p.place===name&&p.source==='xhs').length,amap:candidates.filter(p=>p.place===name&&p.source==='amap').length}));
  }
}finally{await db.end();}
