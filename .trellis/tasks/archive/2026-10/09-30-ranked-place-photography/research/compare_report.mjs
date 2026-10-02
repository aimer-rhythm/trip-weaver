import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { reviews, reviewVersion, xhsNotes } from './compare_review.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'live/comparison');
const input = await fs.readFile(path.join(out, 'candidates.json'));
const data = JSON.parse(input);
const xhs = JSON.parse(await fs.readFile(path.join(here, 'preview/xhs-place-images-beijing.json'), 'utf8'));
const names = { xhs: '小红书 · 现有选择', pexels: 'Pexels', unsplash: 'Unsplash', pixabay: 'Pixabay', commons: 'Wikimedia Commons' };
const labels = { preferred: '推荐比较', alternative: '可作备选', reject: '本轮不推荐', uncertain: '身份待核', baseline: '现有基线' };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const safeLink = value => { const u = new URL(value); assert.equal(u.protocol, 'https:'); assert.equal(u.username + u.password, ''); return esc(u.href); };
const link = (url, label) => `<a href="${safeLink(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;
const audited = [];
for (const row of reviews) {
  for (const [source, entries] of Object.entries(row.groups)) {
    for (const [shortId, status, reason] of entries) {
      const id = `${source}-${shortId}`;
      const p = data.candidates.find(p => p.place === row.place && p.source === source && p.id === id);
      assert(p?.preview, `未采集的审核条目：${row.place}/${id}`);
      assert(labels[status]);
      audited.push({ ...p, status, reason, reviewMethod: 'agent-visual-preview', reviewVersion });
    }
    for (const shortId of row.display[source]) {
      const p = audited.find(p => p.place === row.place && p.id === `${source}-${shortId}`);
      assert(p && ['preferred', 'alternative'].includes(p.status), '展示推荐不得包含拒绝/身份待核照片');
    }
  }
}
assert.equal(audited.length, data.candidates.filter(p => p.preview).length);
assert.equal(new Set(audited.map(p => `${p.place}/${p.id}`)).size, audited.length);
const baseline = [];
for (const [index, p] of xhs.images.entries()) {
  const bytes = await fs.readFile(path.join(here, 'preview/media', p.key));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), p.sha256);
  const preview = `media/xhs-baseline/${p.sha256}.webp`;
  await fs.mkdir(path.dirname(path.join(out, preview)), { recursive: true });
  await fs.writeFile(path.join(out, preview), bytes);
  baseline.push({ id: `xhs-${index + 1}`, place: p.placeName, source: 'xhs', preview, width: p.width, height: p.height, photographer: p.author,
    sourceUrl: p.sourceUrl, license: '未确认授权', status: 'baseline', reason: xhsNotes[index], reviewMethod: 'agent-visual-preview', originalReviewMethod: p.reviewMethod });
}
const stats = Object.keys(names).map(source => {
  const list = source === 'xhs' ? baseline : audited.filter(p => p.source === source);
  return { source, records: source === 'xhs' ? null : data.candidates.filter(p => p.source === source).length,
    previews: list.length, uniqueImages: new Set(list.map(p => p.id)).size,
    preferred: list.filter(p => p.status === 'preferred').length,
    preferredPlaces: [...new Set(list.filter(p => p.status === 'preferred').map(p => p.place))],
    statuses: Object.fromEntries(Object.keys(labels).map(s => [s, list.filter(p => p.status === s).length])) };
});
const report = { generatedAt: new Date().toISOString(), reviewVersion, inputSha256: createHash('sha256').update(input).digest('hex'),
  scope: '小红书先按城市＋规范景点名新采集了 TOP20 中排名 1/2/3/6/7 的 5 地点试点，未跑完整 TOP20；每关键词最多 3 篇、每篇最多 4 图，景山与八达岭另有扩词补缺。当前复用其 8 张选择；其他来源每地点一次查询、最多 6 张预览，采样不同，不计算跨来源成功率。',
  adoption: 'comparison-only', stats, places: reviews.map(({place, winner, summary, display}) => ({place, winner, summary, display})), audited, baseline };
await fs.writeFile(path.join(out, 'review.json'), JSON.stringify(report, null, 2) + '\n');

const credit = p => `${p.photographerUrl ? link(p.photographerUrl, p.photographer) : esc(p.photographer)} · ${link(p.sourceUrl, '作品来源')}${p.licenseUrl ? ` · ${link(p.licenseUrl, p.license)}` : ` · ${esc(p.license)}`}`;
const photo = p => `<article class="photo" data-id="${esc(p.id)}" data-place="${esc(p.place)}" data-source="${p.source}"><button class="image-button" type="button" aria-label="放大 ${esc(p.place)} ${esc(p.id)}"><img src="${esc(p.preview)}" alt="${esc(p.place)} · ${esc(p.id)}" referrerpolicy="no-referrer" loading="lazy"></button><div class="caption"><span class="status ${p.status}">${labels[p.status]}</span><h4>${esc(p.id)}</h4><p>${esc(p.reason)}</p><small>${p.width} × ${p.height} · ${p.width >= p.height ? '横版 / 方形' : '竖版'}（来源尺寸）</small><div class="credit">${credit(p)}</div></div></article>`;
const empty = source => `<div class="empty"><strong>本轮暂无推荐</strong><p>${source === 'xhs' ? '此前八达岭试点保留缺口。' : '预览中未找到身份明确、达到本轮摄影偏好的样片。'}</p><p>可在完整审核里查看错配与待核候选。</p></div>`;
const styles = `*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:#f5f3ef;color:#252c2d;font:15px/1.65 system-ui,'Microsoft Yahei',sans-serif}a{color:#2b625b;text-underline-offset:3px}button{font:inherit;cursor:pointer}button:focus-visible,a:focus-visible,summary:focus-visible{outline:3px solid #bc7b29;outline-offset:4px}header,main,footer{max-width:1680px;margin:auto;padding:28px 32px}header{padding-top:48px;padding-bottom:10px}h1{font-size:clamp(28px,3vw,44px);line-height:1.2;letter-spacing:-1px;margin:14px 0}h2{font-size:27px;margin:0 0 10px}h3{font-size:17px;margin:0 0 12px}h4{font-size:12px;overflow-wrap:anywhere;margin:8px 0}p{margin:8px 0}.eyebrow{font-size:12px;letter-spacing:2px;color:#66716f}.lead{max-width:950px;color:#4c5855}.note{padding:16px 20px;background:#e7ede7;border-radius:12px;margin:20px 0}.nav{display:flex;flex-wrap:wrap;gap:8px;margin:22px 0}.nav a{padding:8px 15px;border:1px solid #ced6ce;border-radius:24px;text-decoration:none;background:#fff}.method{font-size:13px;color:#52615b;max-width:1160px}.table-wrap{overflow:auto;border:1px solid #dce2d9;border-radius:12px;margin:20px 0}table{border-collapse:collapse;width:100%;font-size:13px;text-align:left;background:#fff}th,td{padding:10px 16px;border-bottom:1px solid #edf0e9;white-space:nowrap}th{background:#eaf0e8}.place{padding:28px 0;border-top:1px solid #d9ddd4;scroll-margin-top:16px}.summary{max-width:1100px;color:#52615b;margin-bottom:24px}.columns{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:16px;align-items:start}.column{min-width:0}.photo{background:#fff;border:1px solid #e0e3dc;border-radius:12px;overflow:hidden;margin-bottom:12px}.image-button{display:block;border:0;padding:10px;width:100%;height:218px;background:#eaece7}.image-button img{width:100%;height:100%;object-fit:contain}.caption{padding:13px}.caption p{font-size:13px;line-height:1.6}.caption small,.credit{font-size:11px;color:#69736c;overflow-wrap:anywhere}.credit{margin-top:8px}.status{display:inline-block;padding:2px 8px;border-radius:6px;font-size:11px;background:#edf0ec;color:#53614e}.preferred{background:#dcebdd;color:#225d34}.reject{background:#f3e8e3;color:#7c4738}.uncertain{background:#f7edcf;color:#775719}.baseline{background:#ebe8f0;color:#635278}.empty{padding:22px 15px;min-height:218px;border:1px dashed #bbc8b8;border-radius:12px;font-size:13px;color:#5b695b}details.more{margin-top:12px}summary{cursor:pointer;color:#365d4e;font-size:13px;padding:8px 0}details.more .image-button{height:180px}.best{margin:0 0 18px;font-size:13px;font-weight:600;color:#31664a}.review-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}.all-source{margin:24px 0}.all-source h3{margin:16px 0}dialog{border:0;border-radius:16px;padding:20px;max-width:min(1200px,94vw);max-height:94vh;background:#f8f8f3;color:#252c2d}dialog::backdrop{background:#101c1ddb}dialog img{width:100%;max-height:68vh;object-fit:contain;display:block}.dialog-bar{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:12px}dialog button{min-height:44px;border:1px solid #bec9bd;border-radius:8px;background:white;padding:8px 16px}#dialog-caption{font-size:13px;max-width:1000px}#dialog-credit{font-size:12px}footer{font-size:12px;color:#626c64;padding-bottom:40px}@media(max-width:1100px){.columns{grid-template-columns:repeat(3,minmax(0,1fr))}.review-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}@media(max-width:700px){header,main,footer{padding:22px 16px}.columns,.review-grid{grid-template-columns:1fr}.image-button{height:270px}.place{padding:24px 0}.caption{padding:15px}.column h3{margin-top:16px}.lead{font-size:14px}h2{font-size:24px}.empty{min-height:auto}.table-wrap{max-width:100%}dialog{padding:14px}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}`;
const script = `const dialog=document.querySelector('dialog');let opener;document.querySelectorAll('.image-button').forEach(button=>button.addEventListener('click',()=>{opener=button;const card=button.closest('article');const img=button.querySelector('img');const full=document.querySelector('#dialog-image');full.src=img.src;full.alt=img.alt;document.querySelector('#dialog-title').textContent=card.dataset.place+' · '+card.dataset.id;document.querySelector('#dialog-caption').textContent=card.querySelector('.caption p').textContent;document.querySelector('#dialog-credit').replaceChildren(...Array.from(card.querySelector('.credit').childNodes).map(n=>n.cloneNode(true)));dialog.showModal()}));document.querySelector('#close-dialog').addEventListener('click',()=>dialog.close());dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close()}});dialog.addEventListener('close',()=>opener?.focus());document.querySelectorAll('.image-button img').forEach(img=>img.addEventListener('error',()=>{img.alt+=' · 图片暂时加载失败，可打开作品来源查看';img.closest('button').setAttribute('aria-label',img.alt)}));`;
const shell = (title, body) => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${esc(title)}</title><style>${styles}</style></head><body>${body}<dialog aria-labelledby="dialog-title"><div class="dialog-bar"><strong id="dialog-title"></strong><button id="close-dialog" type="button">关闭</button></div><img id="dialog-image" alt=""><p id="dialog-caption"></p><div id="dialog-credit"></div></dialog><script>${script}</script></body></html>`;
const nav = reviews.map((r,i) => `<a href="#place-${i}">${esc(r.place)}</a>`).join('');
const table = `<div class="table-wrap"><table><thead><tr><th>来源</th><th>候选记录</th><th>已看预览</th><th>推荐比较</th><th>有推荐的地点</th></tr></thead><tbody>${stats.map(s=>`<tr><td>${names[s.source]}</td><td>${s.records ?? '复用此前选择'}</td><td>${s.previews}</td><td>${s.source==='xhs'?'基线，不重评分':s.preferred}</td><td>${s.source==='xhs'?'原有覆盖 4/5':`${s.preferredPlaces.length}/5`}</td></tr>`).join('')}</tbody></table></div>`;
const header = `<header><div class="eyebrow">TRIPWEAVER / 摄影样片评审 / 2026.10.01</div><h1>同一个景点，换个图源看看。</h1><p class="lead">北京 5 个景点，4 个外部图源，和现有 8 张小红书照片放在一起比较。先看主体是否准确，再看构图、光线、氛围与游客干扰。</p><div class="note"><strong>本轮建议：以 Pexels、Pixabay 为主要候选池，按景点补充 Unsplash 与 Commons；小红书先降为补充来源。</strong><p>每个来源每个景点展示最值得比较的一张，展开可看最多两张备选；点击照片可放大。推荐只是本次审片判断，尚未写入正式图库。</p></div>${table}<p class="method">范围：20 次查询，449 条候选记录，118 条预览记录（含同图跨查询重复）；每来源每地点最多看 6 张，Commons 天坛有 2 张下载失败。小红书基线来自此前不同方式采集的 8 张选择，不能据此计算平台成功率或判断全平台质量。Unsplash 使用官方图片直链，打开页面需联网；其他样片来自本地缓存。</p><nav class="nav" aria-label="景点导航">${nav}<a href="all.html">查看全部 118 条审核</a></nav></header>`;
const sections = reviews.map((row, index) => `<section class="place" id="place-${index}"><h2>${esc(row.place)}</h2><p class="summary">${esc(row.summary)}</p><p class="best">本轮优先比较：${esc(row.winner)}</p><div class="columns">${Object.entries(names).map(([source,label])=>{
  const list = source==='xhs' ? baseline.filter(p=>p.place===row.place) : row.display[source].map(id=>audited.find(p=>p.place===row.place&&p.id===`${source}-${id}`));
  return `<div class="column"><h3>${esc(label)}</h3>${list.length?photo(list[0]):empty(source)}${list.length>1?`<details class="more"><summary>另看 ${list.length-1} 张</summary>${list.slice(1).map(photo).join('')}</details>`:''}</div>`;
}).join('')}</div><p><a href="all.html#place-${index}">查看该景点全部候选与排除理由 →</a></p></section>`).join('');
const footer = `<footer>审核：AI 对实际预览进行视觉比较，并结合来源文字核对地点；不是人工验收。仅对本轮已看样片作判断，未看原片的其余候选仍保持待审。原始照片、作者与许可按每张作品列出；本页无正式图库写入、无采集按钮。<p><a href="review.json">结构化审核记录</a> · <a href="candidates.json">原始候选记录</a></p></footer>`;
await fs.writeFile(path.join(out,'index.html'),shell('北京五景点 · 图源对比',header+`<main><div class="note"><strong>小红书基线是哪一轮？</strong><p>是按新方案“北京＋规范景点名”定向采集、重新审核后的 5 景点试点，选自排名第 1、2、3、6、7 的故宫、天坛、景山、颐和园、八达岭；<strong>不是完整 TOP20 的采集结果</strong>。每关键词最多 3 篇笔记、每篇最多 4 张图，景山与八达岭另做过扩词补缺。本次复用最终 8 张选择，没有重新采集小红书。</p></div>${sections}</main>`+footer));
const full = reviews.map((row,index)=>`<section class="place" id="place-${index}"><h2>${esc(row.place)}</h2><p>${esc(row.summary)}</p>${Object.entries(names).filter(([s])=>s!=='xhs').map(([source,label])=>`<div class="all-source"><h3>${esc(label)}</h3><div class="review-grid">${audited.filter(p=>p.place===row.place&&p.source===source).map(photo).join('')}</div></div>`).join('')}</section>`).join('');
await fs.writeFile(path.join(out,'all.html'),shell('图源对比 · 全部预览审核',`<header><div class="eyebrow">逐条预览审核</div><h1>保留好图，也保留排除理由。</h1><p>共 118 条预览记录，包含跨查询重复。身份待核不进入推荐栏；本轮不推荐可能因为错配、画质、游客干扰或重复视角，不代表作品没有价值。</p><nav class="nav"><a href="index.html">← 返回图源对比</a>${nav}</nav></header><main>${full}</main>${footer}`));
console.log(JSON.stringify({records:data.candidates.length,reviewed:audited.length,uniquePreviewImages:new Set(audited.map(p=>p.id)).size,baseline:baseline.length,stats},null,2));
