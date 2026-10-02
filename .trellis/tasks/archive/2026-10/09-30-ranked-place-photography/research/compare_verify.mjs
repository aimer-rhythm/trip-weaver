import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'verification/comparison');
await fs.mkdir(out, { recursive: true });
const root = 'http://127.0.0.1:18843';
assert.equal((await fetch(root)).status, 200);
assert.equal((await fetch(root, { method: 'POST' })).status, 405);
const report = JSON.parse(await fs.readFile(path.join(here, 'live/comparison/review.json'), 'utf8'));
assert.equal(report.adoption, 'comparison-only');
assert.equal(report.audited.length, 118);
assert.equal(report.baseline.length, 8);
assert.equal(report.stats.reduce((n,s)=>n+s.preferred,0),24);
const browser = await chromium.launch({ headless: true });
const results = [];
const failures = [], unexpectedRequests = [];
async function decodeImages(page) {
  // DOM 的折叠/屏幕外图片与解码探针分开；单独探针逐图核验实际源文件，
  // 避免把折叠节点在懒加载切换时的 decode 拒绝误报为媒体损坏。
  await page.locator('article img').evaluateAll(images => images.forEach(img => { img.loading='eager'; }));
  const results = await page.locator('article img').evaluateAll(async images => {
    const result=[];
    for(const img of images){
      const probe=new Image(); probe.src=img.src;
      try { await probe.decode(); result.push({id:img.closest('article').dataset.id,ok:true,width:probe.naturalWidth,height:probe.naturalHeight}); }
      catch(error) { result.push({id:img.closest('article').dataset.id,ok:false,error:String(error)}); }
    }
    return result;
  });
  await page.waitForFunction(() => [...document.querySelectorAll('article img')].every(img => img.complete && img.naturalWidth > 0), undefined, { timeout:30000 });
  return results;
}
try {
  const context = await browser.newContext();
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (req.method() !== 'GET' || !(url.origin === root || url.hostname === 'images.unsplash.com')) {
      unexpectedRequests.push({ method: req.method(), host: url.hostname });
      await route.abort();
    } else await route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', error => failures.push(error.message));
  for (const width of [1440,390]) {
    await page.setViewportSize({ width, height:900 });
    await page.goto(root, { waitUntil:'domcontentloaded' });
    const decoded = await decodeImages(page);
    assert(decoded.every(p=>p.ok),`图片解码失败：${JSON.stringify(decoded.filter(p=>!p.ok))}`);
    assert.equal(await page.locator('.place').count(),5);
    assert.equal(await page.locator('.column').count(),25);
    assert.equal(await page.locator('.empty').count(),4);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`宽度 ${width} 横向溢出`);
    const trigger=page.locator('#place-0 .column').nth(2).locator('.image-button').first();
    await trigger.click();
    assert(await page.locator('dialog').evaluate(dialog=>dialog.open));
    assert.match(await page.locator('#dialog-title').innerText(),/unsplash-zbOLCwA9Fq0/);
    assert.equal(await page.locator('#dialog-credit a').count(),3);
    await page.keyboard.press('Escape');
    assert(!(await page.locator('dialog').evaluate(dialog=>dialog.open)));
    assert(await trigger.evaluate(button=>button===document.activeElement));
    const details=page.locator('#place-0 .column').nth(1).locator('details');
    await details.locator('summary').click();
    assert(await details.evaluate(node=>node.open));
    await details.locator('.image-button').first().click();
    assert.match(await page.locator('#dialog-title').innerText(),/pexels-20694743/);
    await page.getByRole('button',{name:'关闭',exact:true}).click();
    await details.locator('summary').click();
    await page.evaluate(()=>scrollTo(0,0));
    await page.screenshot({path:path.join(out,`report-${width}.png`),fullPage:true});
    if(width===1440){
      for(let i=0;i<5;i++) await page.locator(`#place-${i}`).screenshot({path:path.join(out,`review-place-${i}.png`)});
    }
    results.push({view:'comparison',width,decoded:decoded.length,overflow:false,modal:true,focusRestored:true,alternatives:true});
  }
  await page.goto(`${root}/all.html`,{waitUntil:'domcontentloaded'});
  assert.equal(await page.locator('article.photo').count(),118);
  const all = await decodeImages(page);
  await fs.writeFile(path.join(out,'all-decode.json'),JSON.stringify(all,null,2)+'\n');
  assert(all.every(p=>p.ok),`全部候选页有解码失败：${JSON.stringify(all.filter(p=>!p.ok))}`);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.equal(await page.locator('.uncertain').count(),14);
  results.push({view:'all-previews',width:390,decoded:all.length,uncertain:14,overflow:false});
  assert.equal(failures.length,0);
  assert.equal(unexpectedRequests.length,0);
  await fs.writeFile(path.join(out,'report-browser.json'),JSON.stringify({at:new Date().toISOString(),results,pageErrors:failures,unexpectedRequests},null,2)+'\n');
  console.log(JSON.stringify({results,pageErrors:failures.length,unexpectedRequests:unexpectedRequests.length}));
} finally { await browser.close(); }
