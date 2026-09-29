import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const out=path.resolve(process.env.TRIP_COLLECTION_OUTPUT ?? 'verify-shots/trip-collection');
const baseUrl=process.env.TRIP_COLLECTION_URL ?? 'http://127.0.0.1:5173';
await fs.mkdir(out,{recursive:true});
const names=[['北京','北京 · 四日漫游'],['杭州','湖山之间，慢慢走过杭州'],['成都','成都的街巷与烟火'],['上海','梧桐树下的周末'],['北京','古都秋日散步计划'],['大理','在苍山洱海之间，留一点时间给自己']];
const fixture=names.map(([destination,title],i)=>({id:`trip-${i}`,destination,title,daysCount:i+2,activityCount:8+i*3,totalCost:0,usedXhs:false,version:1,createdAt:Date.UTC(2026,8,10+i),updatedAt:Date.UTC(2026,8,28-i)}));
const assetDir=path.resolve('apps/web/src/assets/city-landmarks');
const testAssets=[path.join(assetDir,'封面测试.svg'),path.join(assetDir,'损坏测试.svg')];
const createdAssets=[];
let browser;
try {
 for(const [index,file] of testAssets.entries()) {
  await fs.writeFile(file,index===0?'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120"><path fill="none" stroke="black" stroke-width="2" d="M20 100h120M40 95V55l40-35 40 35v40M65 95V70h30v25"/></svg>':'invalid SVG fixture',{flag:'wx'});
  createdAssets.push(file);
 }
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const page=await browser.newPage({viewport:{width:1672,height:941},reducedMotion:'reduce'});
 let rows=fixture; let fail=false; let detailRequests=0; let writes=0; let release;
 const held=new Promise(resolve=>{release=resolve;}); let hold=true; const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route(`${baseUrl}/api/**`,async route=>{
  const pathname=new URL(route.request().url()).pathname;let data={};
  if(route.request().method()!=='GET') writes++;
  if(pathname==='/api/auth/me')data={id:'test',email:'collection@example.test'};
  else if(pathname==='/api/usage')data={remaining:2,dailyLimit:4};
  else if(pathname==='/api/trips') {if(hold)await held;if(fail)return route.fulfill({status:503,json:{message:'test failure'}});data=rows;}
  else if(pathname.endsWith('/conversation'))data={conversationId:null};
  else if(pathname.startsWith('/api/trips/')){detailRequests++;const item=fixture.find(t=>pathname.endsWith(t.id));data={...item,days:[],startDate:'',partySize:2,preferences:[],extraNotes:'',meta:{usedXhs:false,reviewNotes:[]}};}
  else if(pathname==='/api/settings/config')data={amapJsKey:'',amapJsSecurityCode:''};
  return route.fulfill({json:data});
 });
 await page.goto(`${baseUrl}/trips`);
 await page.locator('.collection-skeleton').first().waitFor();
 await page.screenshot({path:path.join(out,'loading.png')});
 hold=false;release();
 await page.locator('.collection-card').first().waitFor();
 await page.evaluate(()=>document.fonts.ready);
 await page.waitForFunction(()=>document.querySelectorAll('.collection-card').length===6);
 assert.equal(await page.locator('.collection-card').count(),6);
 assert.equal(detailRequests,0,'list must not fetch full detail per card');
 const contents=await page.locator('.trip-collection').innerText();
 for(const removed of ['导入 JSON','新建行程','重命名','删除','加载示例行程'])assert.ok(!contents.includes(removed),removed);
 for(const [name,width,height]of [['desktop',1920,1080],['laptop',1280,800],['tablet',820,1100],['mobile',375,812],['landscape',812,375]]){
  await page.setViewportSize({width,height});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${name}: horizontal overflow`);
  if(name==='desktop')assert.ok(await page.locator('.collection-card').last().evaluate(el=>el.getBoundingClientRect().bottom<=innerHeight),'six cards must fit 1920x1080');
  await page.screenshot({path:path.join(out,`${name}.png`),fullPage:true});
 }
 await page.setViewportSize({width:1280,height:800});
 await page.getByRole('searchbox',{name:'搜索行程'}).fill('北京');
 await page.waitForFunction(()=>document.querySelectorAll('.collection-card').length===2);
 assert.equal(await page.locator('.collection-card').count(),2);
 await page.getByLabel('排序',{exact:true}).selectOption('created');
 await page.waitForFunction(()=>document.querySelector('.collection-card h2')?.textContent==='古都秋日散步计划');
 await page.getByLabel('目的地',{exact:true}).selectOption('杭州');
 await page.getByRole('heading',{name:'还没有找到这份旅程'}).waitFor();
 await page.screenshot({path:path.join(out,'no-results.png')});
 await page.getByRole('button',{name:'清除筛选'}).click();
 await page.waitForFunction(()=>document.querySelectorAll('.collection-card').length===6);
 assert.equal(await page.locator('.collection-card').count(),6);
 await page.getByLabel('排序',{exact:true}).selectOption('updated');
 await page.getByRole('searchbox',{name:'搜索行程'}).fill('杭州');
 await page.getByRole('link',{name:'查看行程：湖山之间，慢慢走过杭州'}).click();
 await page.locator('.editor-page').waitFor();
 await page.goBack();
 await page.locator('.trip-collection').waitFor();
 assert.equal(await page.getByRole('searchbox',{name:'搜索行程'}).inputValue(),'杭州');
 await page.waitForFunction(()=>document.querySelectorAll('.collection-card').length===1);
 assert.equal(await page.locator('.collection-card').count(),1);
 await page.getByRole('button',{name:'清除筛选'}).click();
 await page.locator('.collection-card').first().focus();
 await page.keyboard.press('Enter');
 await page.locator('.editor-page').waitFor();
 await page.goBack();
 fail=true;
 await page.reload();
 await page.getByRole('alert').waitFor({timeout:20000});
 await page.screenshot({path:path.join(out,'error.png')});
 fail=false;
 await page.getByRole('button',{name:'重新加载'}).click();
 await page.locator('.collection-card').first().waitFor();
 rows=[];
 await page.reload();
 await page.getByRole('heading',{name:'你的旅行手册，等待第一段故事'}).waitFor();
 await page.screenshot({path:path.join(out,'empty.png')});
 rows=[{...fixture[0],title:'一份很长的行程标题，用来确认在狭窄的手机屏幕上仍然保持文字清晰、卡片边界完整、功能正常',destination:'呼和浩特与周边草原'}];
 await page.setViewportSize({width:375,height:812});
 await page.reload();
 await page.locator('.collection-card').first().waitFor();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await page.screenshot({path:path.join(out,'long-title.png')});
 rows=[
  {...fixture[0],destination:'封面测试市'},
  {...fixture[1],destination:'损坏测试'},
  {...fixture[2],destination:'封面测试、杭州'},
 ];
 await page.reload();
 await page.locator('.collection-landmark').waitFor();
 assert.equal(await page.locator('.collection-landmark').count(),1,'only an exact city match gets a local illustration');
 assert.equal(await page.locator('.collection-cover[data-illustrated="false"]').count(),2,'invalid or unmatched SVGs keep text covers');
 assert.ok(await page.locator('.collection-landmark').evaluate(el=>getComputedStyle(el).maskImage!=='none'),'local SVG is used as the cover-coloured mask');
 assert.equal(await page.locator('.collection-cover img').first().evaluate(el=>el.complete&&el.naturalWidth>0),true);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await page.screenshot({path:path.join(out,'local-svg-mobile.png'),fullPage:true});
 await page.setViewportSize({width:1920,height:1080});
 await page.screenshot({path:path.join(out,'local-svg-desktop.png'),fullPage:true});
 assert.equal(writes,0,'collection interactions must not mutate data');
 assert.deepEqual(errors,[]);
 await fs.writeFile(path.join(out,'results.json'),JSON.stringify({status:'passed',checks:['removed actions','loading','search/filter combination','sort','no result/reset','URL restoration','keyboard navigation','retry','empty','5 viewports','long title','no list detail fanout','no writes','local SVG load and mask','city suffix matching','broken SVG fallback','multi-city fallback'],errors},null,2));
 console.log('My trips collection checks passed:',out);
}finally{
 await browser?.close();
 for(const file of createdAssets) await fs.unlink(file);
}
