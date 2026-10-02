import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {reviews,reviewVersion} from './compare_review.mjs';
import {selectionCatalog} from './compare_selection.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../../../..'),out=path.join(here,'live/all-pools');
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const external=await read(path.join(out,'candidates.json')),local=await read(path.join(out,'local-pools.json'));
const trip=await read(path.join(here,'verification/beijing-seven-days/trip.json'));
let focused=[];try{focused=await read(path.join(here,'compare_all_reviews.json'));}catch(e){if(e.code!=='ENOENT')throw e;}
const sources=[['curated','现有精选'],['pexels','Pexels'],['pixabay','Pixabay'],['unsplash','Unsplash'],['commons','Commons'],['xhs','小红书已有图'],['amap','高德']].map(([id,name])=>({id,name}));
const labels={curated:'已有精选',recommended:'本轮优先比较',preferred:'此前推荐',alternative:'可作备选',reject:'不推荐作封面',uncertain:'身份待核',pending:'待核实',stored:'已有导入 · 待复核',pilot:'旧试点 · 待复核',current:'七日版已采用'};
const prior=new Map();
for(const row of reviews)for(const [source,entries] of Object.entries(row.groups))for(const [id,status,reason] of entries){
  prior.set(`${row.place==='天坛'?'天坛公园':row.place}/${source}-${id}`,{status,reason,reviewOrigin:reviewVersion});
}
const canonical=url=>{try{const u=new URL(url);return u.origin+decodeURIComponent(u.pathname).replace(/\/$/,'');}catch{return '';}};
async function copyCurrent(url){
  if(!url?.startsWith('/media/'))return url;
  const base=path.join(root,'data/media'),file=path.resolve(base,url.slice(7));
  assert(file.startsWith(base+path.sep));
  const bytes=await fs.readFile(file),preview=`media/current/${createHash('sha256').update(bytes).digest('hex')}${path.extname(file)}`;
  await fs.mkdir(path.dirname(path.join(out,preview)),{recursive:true});await fs.writeFile(path.join(out,preview),bytes);return preview;
}
const places=[];
for(const p of trip.overview.filter(p=>p.category==='attraction')){
  const photos=p.photos?.length?p.photos:p.coverUrl?[{url:p.coverUrl,attribution:p.coverAttribution}]:[];
  const current=[];
  for(const [i,photo] of photos.entries())current.push({id:`current-${i+1}`,place:p.name,source:photo.attribution?.source??'legacy',...photo.attribution,
    preview:await copyCurrent(photo.url),originalUrl:photo.url,status:'current',title:`${i===0?'封面':'画廊'} · ${p.name}`,
    reason:photo.attribution?'七日行程保存的实际照片；采用不等于本轮质量审核通过。':'旧兜底图片，原行程未提供作者和许可记录。'});
  places.push({name:p.name,days:trip.days.filter(d=>d.activities.some(a=>a.name===p.name)).map(d=>d.dayIndex),current});
}
const candidates=[...external.candidates,...local.candidates].map(p=>{
  const known=prior.get(`${p.place}/${p.id}`),fresh=focused.find(r=>r.place===p.place&&r.id===p.id);
  const current=places.find(r=>r.name===p.place).current;
  const used=current.some(c=>(canonical(c.sourceUrl)&&canonical(c.sourceUrl)===canonical(p.sourceUrl))||canonical(c.originalUrl)&&canonical(c.originalUrl)===canonical(p.preview));
  return {...p,...(p.source==='amap'?{photographer:'高德POI图片（未提供作者）'}:{}),status:known?.status??(['curated','stored','pilot'].includes(p.review)?p.review:'pending'),
    reason:known?.reason??(p.review==='curated'?p.evidence:'尚未逐张核实地点与封面质量。'),...known,...fresh,current:used||p.current===true};
});
const searches=[...external.searches,...local.searches];
const stats=sources.map(s=>{
  const records=candidates.filter(p=>p.source===s.id),previews=records.filter(p=>p.preview);
  return {...s,records:records.length,previews:previews.length,places:new Set(previews.map(p=>p.place)).size,
    previewErrors:records.filter(p=>p.previewError).length,reviewed:previews.filter(p=>p.reviewOrigin).length};
});
const data={generatedAt:new Date().toISOString(),tripId:trip.id,places,sources,labels,stats,searches,candidates,
  errors:[...external.errors,...local.errors],requests:{external:external.requests,amap:local.requests},focusedReviewCount:focused.length};
data.selectionCatalogVersion=selectionCatalog(data).catalogVersion;
assert.equal(places.length,25);assert.equal(places.filter(p=>p.days.length).length,22);
assert.equal(places.reduce((sum,p)=>sum+p.current.length,0),31);
await fs.writeFile(path.join(out,'comparison.json'),JSON.stringify(data,null,2));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const css=await fs.readFile(path.join(here,'compare_all.css'),'utf8');
const selectionCss=await fs.readFile(path.join(here,'compare_selection.css'),'utf8');
const client=await fs.readFile(path.join(here,'compare_all_client.js'),'utf8');
await fs.writeFile(path.join(out,'app.js'),client);
await fs.copyFile(path.join(here,'compare_selection_client.js'),path.join(out,'selection.js'));
await fs.writeFile(path.join(out,'index.html'),`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>北京七日 · 全部候选池对比</title><style>${css}\n${selectionCss}</style></head><body>
<header><div class="eyebrow">TRIPWEAVER / 独立图源对比 / 2026.10.01</div><h1>同一景点，七个候选池。</h1><p>北京七日版的 25 个候选景点，22 个实际入程。四家图库独立检索，每格最多 6 张预览，可点击放大。</p>
<div class="notice">精选库是已审核图片的集合，原始图源仍可能是 Pexels 或 Commons。其余搜索结果可能错配；默认首张仅按检索采样顺序展示，不代表推荐。小红书仅复用已有图片及此前 5 景点试点，本轮未重新采集。</div>
<details class="statistics ai-summary"><summary>本轮对比结论与值得先看的景点</summary><div class="table-scroll"><table><thead><tr><th>候选池</th><th>本轮看到的优势</th><th>主要问题与定位</th></tr></thead><tbody>
<tr><td>现有精选</td><td>已有地点审核和本地文件，19张覆盖8景点</td><td>稳定优先；覆盖有限，是多个原始图源的精选集合</td></tr>
<tr><td>Pexels</td><td>圆明园遗址、鼓楼、恭王府有较好建筑景观</td><td>继续作主要候选；水立方检索也会混入鸟巢和大剧院</td></tr>
<tr><td>Pixabay</td><td>故宫暮色、慕田峪、水立方细部有可比样片</td><td>主要候选但必须严查地点；多组精确查询返回过山车等泛化结果</td></tr>
<tr><td>Unsplash</td><td>天坛、天安门城楼、奥林匹克塔构图与光线突出</td><td>按景点补充；国子监、王府井等查询出现其他北京地标</td></tr>
<tr><td>Commons</td><td>国子监、王府井、水立方地点更容易核对</td><td>补具体地标；混有历史照片、展品、人群，需逐图看许可</td></tr>
<tr><td>小红书已有图</td><td>有季节、机位和旅行氛围</td><td>补充来源；只比已有10张，未作同轮新采集，作者／授权记录不齐</td></tr>
<tr><td>高德</td><td>25景点均有POI关联预览，便于补入口与外观</td><td>兜底；可能返回附属地点、室内陈设或人像，作者许可未知</td></tr>
</tbody></table></div><p>建议先看：<a href="?place=${encodeURIComponent('圆明园')}">圆明园</a>（遗址 vs 荷花／错配） · <a href="?place=${encodeURIComponent('国子监')}">国子监</a>（Commons建筑 vs 泛城市图） · <a href="?place=${encodeURIComponent('水立方')}">水立方</a>（容易与鸟巢混淆） · <a href="?place=${encodeURIComponent('王府井')}">王府井</a>（街景补缺）。结论仅针对本轮已看样片，不代表全平台排名。</p></details>
<details class="statistics"><summary>查看各池规模与采集范围</summary><div class="table-scroll"><table><thead><tr><th>候选池</th><th>保留记录</th><th>预览记录</th><th>有预览景点</th><th>预览获取失败</th></tr></thead><tbody>${stats.map(s=>`<tr><td>${s.name}</td><td>${s.records}</td><td>${s.previews}</td><td>${s.places}/25</td><td>${s.previewErrors}</td></tr>`).join('')}</tbody></table></div><p>四家图库合计 ${external.candidates.length} 条记录、${external.candidates.filter(p=>p.preview).length} 条预览；含跨查询重复。高德保留每景点最多 6 张，原始 POI 返回见 queries 文件。各池采样方式不同，有图数量不等于准确覆盖率。Unsplash 和高德预览需要联网。</p><p>100 组外部查询：80 次新请求＋20 组精确查询缓存；高德 ${local.requests} 次正常计额请求。没有新增小红书请求。</p></details></header>
<main><section id="selection-panel" aria-label="我的选图"><h2>挑出你喜欢的图片</h2><p>每个景点可以多选，也可以标记“不合适”。选完当前景点后点“本景点挑完”；未选择不会直接视为不喜欢。</p><div class="selection-toolbar"><strong id="selection-progress">正在读取选择…</strong><span id="save-status" role="status" aria-live="polite"></span><button id="reload-selection" type="button" hidden>重读已保存结果</button></div><div class="selection-toolbar"><label><input id="hide-ai" type="checkbox" checked> 隐藏 AI 审片意见，按自己的标准挑选</label><button id="expand-candidates" type="button">展开本景点全部预览</button><button id="selection-snapshot" type="button" disabled>保存本轮选择，供后续分析</button><button id="export-selection" type="button" disabled>导出选择备份</button></div><p id="snapshot-status" class="hint">选择只用于归纳摄影偏好，不会自动替换行程图片。</p></section><div class="toolbar"><label for="place-select">选择景点</label><select id="place-select"></select><button id="previous" type="button">上一个</button><button id="next" type="button">下一个</button><span id="position"></span></div><fieldset id="source-filters"><legend>显示候选池</legend></fieldset><div class="place-heading"><h2 id="place-title"></h2><span id="schedule"></span></div><section class="place-feedback"><strong id="place-selection-count"></strong><div class="selection-toolbar"><button data-place-status="done" type="button" disabled>本景点挑完</button><button data-place-status="none" type="button" disabled>都不合适</button><button data-place-status="in_progress" type="button" disabled>继续挑选</button></div><label for="selection-note">挑选理由（可选，最多 1000 字）</label><textarea id="selection-note" maxlength="1000" rows="2" placeholder="例如：喜欢远景、晚霞，人物不要太突出。"></textarea><button id="save-note" type="button" disabled>保存备注</button><span id="note-status" role="status"></span></section><div id="place-note" class="notice"></div><details id="current-panel"><summary id="current-summary"></summary><div id="current-photos" class="current-photos"></div></details><p class="hint">横向滚动可并排看全部来源；“展开其余”查看同池更多预览。同景点相同照片会同步选择，计为一张。</p><div class="comparison-scroll" tabindex="0" aria-label="七个候选池并排对比"><div id="columns"></div></div><details><summary>当前景点的完整候选记录（含未取预览）</summary><div id="records" class="table-scroll"></div></details></main>
<footer>本页保存你的个人选图反馈，用于后续比较入选与其他候选，归纳筛选条件。已有AI审核与个人选择分别保存；正式图库和行程保持原样。<p><a href="comparison.json">合并对比记录</a> · <a href="candidates.json">四家图库原始候选</a> · <a href="local-pools.json">精选／小红书／高德记录</a> · <a href="http://localhost:5173/trips/${trip.id}" target="_blank" rel="noopener">查看七日行程</a></p></footer>
<dialog aria-labelledby="dialog-title"><div class="dialog-bar"><strong id="dialog-title"></strong><button id="close-dialog" type="button">关闭</button></div><img id="dialog-image" alt=""><div id="dialog-selection"></div><p id="dialog-reason" class="ai-review"></p><div id="dialog-credit"></div></dialog><script src="selection.js"></script><script src="app.js"></script></body></html>`);
// 审片板固定显示采样首张；每张均有来源及 ID，便于将视觉观察写回明确记录。
for(let batch=0;batch<5;batch++){
 const rows=places.slice(batch*5,batch*5+5).map(p=>`<h2>${esc(p.name)}</h2><div class="board-row">${sources.map(s=>{
   const img=candidates.find(c=>c.place===p.name&&c.source===s.id&&c.preview);
   return `<article><strong>${s.name}</strong>${img?`<img src="${esc(img.preview)}" alt="${esc(img.id)}"><small>${esc(img.id)}</small><p>${esc(img.title).slice(0,150)}</p>`:'<p>无已有预览</p>'}</article>`;
 }).join('')}</div>`).join('');
 await fs.writeFile(path.join(out,`sheet-${batch}.html`),`<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer"><style>body{font:14px system-ui;background:#eef1eb;padding:12px}h2{font-size:20px;margin:15px 0 6px}.board-row{display:grid;grid-template-columns:repeat(7,1fr);gap:9px}article{background:white;padding:8px;min-width:0}img{width:100%;height:155px;object-fit:contain;display:block}small{font-size:10px;overflow-wrap:anywhere}p{font-size:11px;line-height:1.3;max-height:28px;overflow:hidden;margin:3px 0}</style>${rows}`);
}
console.log(JSON.stringify({stats,matchedPrior:candidates.filter(p=>p.reviewOrigin===reviewVersion).length,focused:focused.length,usedMatches:candidates.filter(p=>p.current).length,current:31},null,2));
