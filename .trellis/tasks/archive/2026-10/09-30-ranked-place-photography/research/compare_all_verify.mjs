import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url)),out=path.join(here,'verification/all-pools'),base='http://127.0.0.1:18845';
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const boards=process.argv.includes('--boards');
try{
 if(boards){
  for(let i=0;i<5;i++){
   const page=await browser.newPage({viewport:{width:1680,height:1200}});
   await page.goto(`${base}/sheet-${i}.html`,{waitUntil:'domcontentloaded'});
   const decoded=await page.locator('img').evaluateAll(nodes=>Promise.all(nodes.map(async img=>{
    try{await Promise.race([img.decode(),new Promise((_,reject)=>setTimeout(()=>reject(Error('timeout')),20000))]);return {id:img.alt,ok:true};}
    catch{return {id:img.alt,ok:false};}
   })));
   await page.screenshot({path:path.join(out,`sheet-${i}.png`),fullPage:true});
   await fs.writeFile(path.join(out,`sheet-${i}.json`),JSON.stringify(decoded,null,2));
   console.log(JSON.stringify({board:i,images:decoded.length,failed:decoded.filter(p=>!p.ok)}));await page.close();
  }
 }else{
  const page=await browser.newPage({viewport:{width:1560,height:1100}}),errors=[],writes=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('request',req=>{if(req.method()!=='GET')writes.push(req.method()+' '+req.url());});
  await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.comparisonReady===true);
  const places=await page.locator('#place-select option').allTextContents();assert.equal(places.length,25);
  let slots=0;
  for(let i=0;i<25;i++){
   await page.selectOption('#place-select',String(i));assert.equal(await page.locator('.column').count(),7);slots+=7;
   assert.equal(await page.locator('#place-title').textContent(),places[i].replace(' · 未入程',''));
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert(!overflow,'desktop overflow');
  }
  await page.selectOption('#place-select','4');
  await page.locator('.column[data-source="pexels"] .image-button').first().click();assert(await page.locator('dialog').isVisible());
  assert((await page.locator('#dialog-credit').textContent()).includes('Pexels'));
  await page.keyboard.press('Escape');assert(!(await page.locator('dialog').isVisible()));
  assert(await page.locator('.column[data-source="pexels"] .image-button').first().evaluate(el=>el===document.activeElement));
  await page.locator('.column[data-source="pexels"] summary').click();assert.equal(await page.locator('.column[data-source="pexels"] .image-button:visible').count(),6);
  await page.locator('#source-filters input[value="commons"]').uncheck();assert.equal(await page.locator('.column').count(),6);
  await page.locator('#source-filters input[value="commons"]').check();
  await page.locator('#current-summary').click();assert.equal(await page.locator('#current-photos .photo').count(),3);
  await page.locator('#current-summary').click();
  await page.locator('.column[data-source="curated"] img').first().evaluate(img=>img.decode());
  await page.screenshot({path:path.join(out,'desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.selectOption('#place-select','11');
  assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)),'mobile overflow');
  await page.locator('.column[data-source="pixabay"] .image-button').first().click();assert(await page.locator('dialog').isVisible());
  await page.locator('#close-dialog').click();
  await page.screenshot({path:path.join(out,'mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
  if(process.argv.includes('--ui-only')){
   await page.selectOption('#place-select','12');
   assert((await page.locator('.column[data-source="pexels"] .badge').first().textContent()).includes('本轮优先比较'));
   assert((await page.locator('.column[data-source="pixabay"] .caption p').first().textContent()).includes('荷花'));
   await page.selectOption('#place-select','16');
   await page.locator('.column[data-source="pixabay"] summary').click();
   assert.equal(await page.locator('.column[data-source="pixabay"] .recommended').count(),1);
   await fs.writeFile(path.join(out,'ui-final.json'),JSON.stringify({places:25,slots,currentPhotos:31,desktopWidth:1560,mobileWidth:390,errors,writes,focusedLabels:true},null,2));
   console.log(JSON.stringify({places:25,slots,errors,writes,focusedLabels:true}));
  }else{
  // 独立 Image 探针验证全部唯一预览；不对 lazy/折叠节点直接 decode，避免误报。
  const data=JSON.parse(await fs.readFile(path.join(here,'live/all-pools/comparison.json'),'utf8'));
  const previews=[...new Set([...data.candidates,...data.places.flatMap(p=>p.current)].filter(p=>p.preview).map(p=>p.preview))];
  const decoded=await page.evaluate(async urls=>{
   const output=[];let next=0;
   await Promise.all(Array.from({length:8},async()=>{while(next<urls.length){const url=urls[next++];const ok=await new Promise(resolve=>{
    const img=new Image(),timer=setTimeout(()=>{img.src='';resolve(false);},12000);img.onload=()=>{clearTimeout(timer);resolve(img.naturalWidth>0);};img.onerror=()=>{clearTimeout(timer);resolve(false);};img.referrerPolicy='no-referrer';img.src=url;
   });output.push({url,ok});}}));return output;
  },previews);
  await fs.writeFile(path.join(out,'decode.json'),JSON.stringify(decoded,null,2));
  const result={places:25,slots,currentPhotos:31,desktopWidth:1560,mobileWidth:390,errors,writes,
   uniquePreviewUrls:decoded.length,decoded:decoded.filter(p=>p.ok).length,failed:decoded.filter(p=>!p.ok),
   sourceFailures:data.sources.map(s=>({source:s.id,failed:data.candidates.filter(p=>p.source===s.id&&p.preview&&decoded.some(d=>d.url===p.preview&&!d.ok)).length}))};
  await fs.writeFile(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  }
 }
}finally{await browser.close();}
