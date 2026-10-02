import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
const here=path.dirname(fileURLToPath(import.meta.url)),out=path.join(here,'live/all-pools'),qa=path.join(here,'verification/all-pools');
const data=JSON.parse(await fs.readFile(path.join(out,'comparison.json'),'utf8'));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const names=['圆明园','国子监','王府井','水立方'];
const browser=await chromium.launch({headless:true});
try{
 for(const [i,name] of names.entries()){
  const rows=['pexels','pixabay','unsplash','commons'].map(source=>`<h2>${name} / ${source}</h2><div>${data.candidates.filter(p=>p.place===name&&p.source===source&&p.preview).map(p=>`<article><img src="${esc(p.preview)}"><small>${p.id}</small><p>${esc(p.title)}</p></article>`).join('')}</div>`).join('');
  await fs.writeFile(path.join(out,`focus-${i}.html`),`<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer"><style>body{font:14px system-ui;background:#eef1eb;padding:10px}h2{font-size:20px;margin:10px 0}div{display:grid;grid-template-columns:repeat(6,1fr);gap:8px}article{padding:8px;background:white;min-width:0}img{width:100%;height:185px;object-fit:contain}small{font-size:11px;overflow-wrap:anywhere}p{font-size:11px;line-height:1.3;height:28px;overflow:hidden}</style>${rows}`);
  const page=await browser.newPage({viewport:{width:1680,height:1300}});await page.goto(`http://127.0.0.1:18845/focus-${i}.html`,{waitUntil:'domcontentloaded'});
  const decoded=await page.locator('img').evaluateAll(nodes=>Promise.all(nodes.map(async img=>{try{await Promise.race([img.decode(),new Promise((_,r)=>setTimeout(r,15000))]);return true;}catch{return false;}})));
  await page.screenshot({path:path.join(qa,`focus-${i}.png`),fullPage:true});console.log(JSON.stringify({place:name,previews:decoded.length,failed:decoded.filter(v=>!v).length}));await page.close();
 }
}finally{await browser.close();}
