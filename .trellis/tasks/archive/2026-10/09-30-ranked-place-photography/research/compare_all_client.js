'use strict';
(async()=>{
 const data=await fetch('comparison.json').then(r=>{if(!r.ok)throw Error('数据加载失败');return r.json();});
 const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const safe=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:'';}catch{return '';}};
 const src=value=>safe(value)||(/^media\/[a-zA-Z0-9/_\-.]+$/.test(value)&&!value.includes('..')?value:'');
 const link=(url,label)=>safe(url)?`<a href="${esc(safe(url))}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`:esc(label);
 const credit=p=>`${link(p.photographerUrl,p.photographer||'未提供作者')}${p.sourceUrl?' · '+link(p.sourceUrl,'作品来源'):''} · ${link(p.licenseUrl,p.license||'未提供许可信息')}`;
 const poolName=id=>data.sources.find(s=>s.id===id)?.name??id;
 const badge=p=>`<span class="badge ai-review ${esc(p.status)}">${esc(data.labels[p.status]??'待核实')}</span>${p.current?'<span class="badge current">七日版已采用</span>':''}`;
 const feedback=window.createPhotoSelection(data);
 let index=0,displayed=[],opener;
 const select=$('#place-select'),dialog=$('dialog');
 const requested=new URL(location.href).searchParams.get('place');
 if(requested&&data.places.some(p=>p.name===requested))index=data.places.findIndex(p=>p.name===requested);
 else index=data.places.findIndex(p=>p.name==='故宫博物院');
 select.innerHTML=data.places.map((p,i)=>`<option value="${i}">${esc(p.name)}${p.days.length?'':' · 未入程'}</option>`).join('');
 $('#source-filters').insertAdjacentHTML('beforeend',data.sources.map(s=>`<label><input type="checkbox" value="${s.id}" checked> ${esc(s.name)}</label>`).join(''));
 function photo(p){
  const slot=displayed.push(p)-1;
  return `<article class="photo" data-photo="${slot}" data-selection-key="${esc(p.selectionKey)}" data-source="${esc(p.source)}"><button class="image-button" type="button" aria-label="放大 ${esc(p.place)} ${esc(p.id)}"><img src="${esc(src(p.preview))}" alt="${esc(p.place)} · ${esc(p.id)}" loading="lazy" referrerpolicy="no-referrer"></button>${feedback.controls(p)}<div class="caption">${badge(p)}${p.underlyingSource?`<small>原图源：${esc(poolName(p.underlyingSource))}</small>`:''}<p class="ai-review">${esc(p.reason)}</p><p class="title">${esc(p.title)}</p><span class="photo-id">${esc(p.id)}</span>${p.width&&p.height?`<small>${p.width} × ${p.height}</small>`:''}<div class="credit">${credit(p)}</div></div></article>`;
 }
 function render(){
  const place=data.places[index];select.value=String(index);displayed=[];
  $('#position').textContent=`${index+1} / ${data.places.length}`;$('#place-title').textContent=place.name;
  $('#schedule').textContent=place.days.length?`已入程 · 第 ${place.days.join('、')} 天`:'候选景点 · 未排入七日行程';
  $('#place-note').textContent=place.current.length?`七日版已有 ${place.current.length} 张图片。可展开当前照片，对照各池候选；新检索使用英文规范关键词，可能与生成时的结果不同。`:'七日版此景点没有图片；下面是本轮独立检索结果，尚未写入行程。';
  $('#current-summary').textContent=`查看七日版实际照片（${place.current.length} 张）`;
  $('#current-photos').innerHTML=place.current.length?place.current.map(photo).join(''):'<p>当前无图。</p>';
  const enabled=[...document.querySelectorAll('#source-filters input:checked')].map(n=>n.value);
  const columns=$('#columns');columns.style.setProperty('--count',Math.max(enabled.length,1));
  const records=data.candidates.filter(p=>p.place===place.name);
  columns.innerHTML=data.sources.filter(s=>enabled.includes(s.id)).map(s=>{
   const all=records.filter(p=>p.source===s.id),previews=all.filter(p=>p.preview),query=data.searches.find(q=>q.place===place.name&&q.source===s.id),error=data.errors.find(e=>e.place===place.name&&e.source===s.id);
   const failures=all.filter(p=>p.previewError).length;
   const message=error?'查询失败':s.id==='curated'?'暂无符合当前精选规则的图片':s.id==='xhs'?'暂无可复用的已导入／旧试点图片':query?.records===0?'本次查询无结果':failures?'预览获取失败，可查看完整记录':'暂无预览';
   return `<section class="column" data-source="${s.id}"><h3>${esc(s.name)}</h3><div class="pool-info">${all.length} 条保留记录 · ${previews.length} 条预览${failures?` · ${failures} 条预览获取失败`:''}<br>${esc(query?.query??(s.id==='curated'?'读取有效精选清单':s.id==='xhs'?'复用已有图片，未重新采集':'北京＋'+place.name))}${s.id==='amap'?'<br>原始 POI 搜索，可能含附属地点':''}</div>${previews.length?photo(previews[0]):`<div class="empty">${message}</div>`}${previews.length>1?`<details class="more"><summary>展开其余 ${previews.length-1} 张</summary>${previews.slice(1).map(photo).join('')}</details>`:''}</section>`;
  }).join('')||'<p>请选择至少一个候选池。</p>';
  $('#records').innerHTML=`<table><thead><tr><th>候选池</th><th>记录 ID</th><th>标题／地点证据</th><th>状态</th><th>来源</th></tr></thead><tbody>${records.filter(p=>enabled.includes(p.source)).map(p=>`<tr><td>${esc(poolName(p.source))}</td><td>${esc(p.id)}</td><td>${esc(p.title)}<br><small>${esc(p.evidence)}</small></td><td>${p.preview?esc(data.labels[p.status]):p.previewError?'预览获取失败':'未取预览'}</td><td>${p.sourceUrl?link(p.sourceUrl,'原作品'):'未提供'}</td></tr>`).join('')}</tbody></table>`;
  document.querySelectorAll('.image-button img').forEach(img=>img.addEventListener('error',()=>{if(!img.parentElement.querySelector('.failed'))img.insertAdjacentHTML('afterend','<span class="failed">预览加载失败，可打开作品来源查看</span>');}));
  const url=new URL(location.href);url.searchParams.set('place',place.name);history.replaceState(null,'',url);
  feedback.setPlace(place.name);
 }
 select.addEventListener('change',()=>{index=Number(select.value);render();});
 $('#previous').addEventListener('click',()=>{index=(index+24)%25;render();});$('#next').addEventListener('click',()=>{index=(index+1)%25;render();});
 $('#source-filters').addEventListener('change',render);
 document.addEventListener('click',event=>{
  const button=event.target.closest('.image-button');if(!button)return;
  const p=displayed[Number(button.closest('.photo').dataset.photo)];opener=button;
  $('#dialog-title').textContent=`${p.place} · ${poolName(p.source)} · ${p.id}`;
  $('#dialog-image').src=src(p.preview);$('#dialog-image').alt=p.title||p.place;
  $('#dialog-reason').textContent=p.reason;$('#dialog-credit').innerHTML=credit(p);$('#dialog-selection').innerHTML=feedback.controls(p);feedback.refresh();dialog.showModal();
 });
 $('#close-dialog').addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>opener?.focus());
 dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
 render();window.comparisonReady=true;
})().catch(error=>{document.querySelector('main').textContent='对比数据未能加载，请刷新页面。';console.error(error);});
