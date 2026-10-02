import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const out=path.join(here,'live/comparison');
const data=JSON.parse(await fs.readFile(path.join(out,'candidates.json'),'utf8'));
const names={pexels:'Pexels',unsplash:'Unsplash',pixabay:'Pixabay',commons:'Wikimedia Commons'};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
for (const [index,[place]] of data.targets.entries()) {
  const columns=Object.entries(names).map(([source,label])=>`<div><h2>${label}</h2>${data.candidates.filter(p=>p.place===place&&p.source===source&&p.preview).map(p=>`<article><img src="${esc(p.preview)}"><b>${esc(p.id)}</b><p>${esc(p.title).slice(0,130)}</p><small>${p.width} × ${p.height}</small></article>`).join('')}</div>`).join('');
  await fs.writeFile(path.join(out,`sheet-${index}.html`),`<!doctype html><meta charset="utf-8"><title>${esc(place)}候选</title><style>*{box-sizing:border-box}body{margin:16px;font:14px system-ui;background:#e9edf1}h1{margin:10px}main{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}article{height:258px;background:white;margin:8px 0;padding:8px;overflow:hidden}img{width:100%;height:190px;object-fit:contain;background:#edf0f1}b{display:block;font-size:12px}p{margin:3px 0;font-size:11px}small{font-size:10px}</style><h1>${esc(place)} · 本轮各来源候选（尚未审定）</h1><main>${columns}</main>`);
}
console.log('已生成5张候选联系表页面');
