import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomBytes,randomUUID,createHash } from 'node:crypto';
import pg from 'pg';
import { chromium } from 'playwright';
const id='32c3abae-eb1e-4587-8832-5531b2169385';
const out='.trellis/tasks/09-29-hangzhou-image-diagnosis/research/photo-verification/beijing';
await fs.mkdir(out,{recursive:true});
const client=new pg.Client({connectionString:process.env.DATABASE_URL});
await client.connect();
const sessionId=randomUUID(),token=randomBytes(32).toString('hex');
const headers={Cookie:`tw_session=${token}`};
let browser;
try {
  const row=(await client.query('SELECT t.user_id,t.data FROM trips t JOIN trips owned ON owned.id=$2 AND owned.user_id=t.user_id WHERE t.id=$1',[id,'5dee10b5-b395-48cd-8fb9-470d4b9e4280'])).rows[0];
  assert.ok(row);
  await client.query('INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at) VALUES ($1,$2,$3,$4,$5)',[sessionId,row.user_id,createHash('sha256').update(token).digest('hex'),new Date(Date.now()+900000),new Date()]);
  const response=await fetch(`http://127.0.0.1:8787/api/trips/${id}`,{headers});
  assert.equal(response.status,200);
  const trip=await response.json();
  const association=await(await fetch(`http://127.0.0.1:8787/api/trips/${id}/conversation`,{headers})).json();
  const selected=trip.overview.filter(p=>p.photos?.length);
  assert.equal(selected.length,8);
  browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  await context.addCookies([{name:'tw_session',value:token,domain:'127.0.0.1',path:'/',httpOnly:true,sameSite:'Lax'}]);
  const page=await context.newPage(),errors=[],externalImages=[],writes=[],galleries=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(r.resourceType()==='image'&&!['localhost','127.0.0.1'].includes(new URL(r.url()).hostname))externalImages.push(r.url());if(['PUT','PATCH','DELETE'].includes(r.method()))writes.push(r.method());});
  await page.goto(`http://127.0.0.1:5173/trips/${id}`);
  const days=page.getByRole('group',{name:'行程天数'});
  await days.waitFor();
  for(let day=1;day<=trip.days.length;day++){
    await days.getByRole('button',{name:`第${day}天`,exact:true}).click();
    for(const poi of selected){
      const trigger=page.getByRole('button',{name:`查看${poi.name}完整照片`,exact:true});
      if(!await trigger.count())continue;
      await trigger.scrollIntoViewIfNeeded();
      await trigger.locator('img').evaluate(img=>img.decode());
      await trigger.click();
      const dialog=page.getByRole('dialog',{name:`${poi.name} · 完整照片`,exact:true});
      assert.equal(await dialog.getByRole('group',{name:'选择照片'}).getByRole('button').count(),poi.photos.length);
      for(let n=0;n<poi.photos.length;n++){
        await dialog.getByRole('button',{name:`查看第${n+1}张照片`,exact:true}).click();
        await dialog.locator('.poi-photo-expanded').evaluate(img=>img.decode());
        assert.equal(await dialog.locator('.poi-photo-expanded').getAttribute('src'),poi.photos[n].url);
        assert.ok((await dialog.locator('.photo-credit').textContent()).includes(poi.photos[n].attribution.photographer));
        if(poi.name==='故宫博物院'&&n===0)await page.screenshot({path:`${out}/forbidden-city-gallery.png`});
      }
      galleries.push({name:poi.name,photos:poi.photos.length});
      await page.keyboard.press('Escape');
      assert.equal(await trigger.locator('img').getAttribute('src'),poi.coverUrl);
    }
    await page.evaluate(()=>{for(const el of document.querySelectorAll('*'))if(el.scrollHeight>el.clientHeight)el.scrollTop=0;});
    await page.waitForTimeout(300);
    await page.screenshot({path:`${out}/day-${day}.png`,fullPage:true});
  }
  await page.setViewportSize({width:390,height:844});
  await days.getByRole('button',{name:'第1天',exact:true}).click();
  const first=page.getByRole('button',{name:'查看故宫博物院完整照片',exact:true});
  await first.scrollIntoViewIfNeeded();
  await page.screenshot({path:`${out}/mobile-day-1.png`,fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await first.click();
  const dialog=page.getByRole('dialog',{name:'故宫博物院 · 完整照片',exact:true});
  await dialog.getByRole('button',{name:'下一张照片',exact:true}).click();
  await dialog.locator('.poi-photo-expanded').evaluate(img=>img.decode());
  await page.screenshot({path:`${out}/mobile-gallery.png`});
  await page.keyboard.press('Escape');
  let chat=false;
  if(association.conversationId){
    await page.getByRole('button',{name:'对话',exact:true}).click();
    await page.getByRole('textbox',{name:'输入你的行程想法'}).waitFor();chat=true;
  }
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
  const after=(await client.query('SELECT data FROM trips WHERE id=$1 AND user_id=$2',[id,row.user_id])).rows[0].data;
  assert.deepEqual(after,row.data,'浏览不得改动行程');
  assert.equal(galleries.length,8);
  const externalPhotoRequests=externalImages.filter(raw=>{const url=new URL(raw);return !((url.pathname==='/appmaptile'&&/^webrd\d+\.is\.autonavi\.com$/.test(url.hostname))||(url.hostname==='webapi.amap.com'&&url.pathname==='/theme/v2.0/logo@1x.png'));});
  assert.deepEqual(externalPhotoRequests,[],'已选照片仅访问本地，地图瓦片单独计数');
  const report={tripId:id,selectedPlaces:selected.length,photos:selected.reduce((n,p)=>n+p.photos.length,0),galleries,chat,conversationId:association.conversationId,errors,writes,externalPhotoRequests,mapAssetRequests:externalImages.length-externalPhotoRequests.length};
  await fs.writeFile(`${out}/result.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
}finally{await browser?.close();await client.query('DELETE FROM sessions WHERE id=$1',[sessionId]);await client.end();}
