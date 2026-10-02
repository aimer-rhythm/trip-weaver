import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const out=path.join(here,'verification/comparison');
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage({viewport:{width:1680,height:1100}});
  for(let i=0;i<5;i++){
    await page.goto(`http://127.0.0.1:18843/sheet-${i}.html`);
    const result=await page.locator('img').evaluateAll(nodes=>Promise.all(nodes.map(async img=>{
      try{await Promise.race([img.decode(),new Promise((_,reject)=>setTimeout(reject,20000))]);return {url:img.getAttribute('src'),ok:true};}
      catch{return {url:img.getAttribute('src'),ok:false};}
    })));
    await page.screenshot({path:path.join(out,`sheet-${i}.png`),fullPage:true});
    console.log(JSON.stringify({place:i,images:result.length,failed:result.filter(x=>!x.ok).length}));
    await fs.writeFile(path.join(out,`decode-${i}.json`),JSON.stringify(result,null,2));
  }
}finally{await browser.close();}
