'use strict';
window.createPhotoSelection=function(data){
 const $=selector=>document.querySelector(selector),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const groups=new Map();
 for(const p of [...data.candidates.filter(p=>p.preview),...data.places.flatMap(p=>p.current)]){
  if(typeof p.selectionKey!=='string')continue;
  if(!groups.has(p.selectionKey))groups.set(p.selectionKey,p);
 }
 let state=null,busy=false,currentPlace='',message='',failed=false,lastRequest=null;
 const noteDrafts=new Map();
 const statusLabels={done:'已挑完',none:'都不合适',in_progress:'挑选中'};
 function validate(value){
  if(!value||value.schemaVersion!==1||value.catalogVersion!==data.selectionCatalogVersion||!Number.isSafeInteger(value.revision)||!value.ratings||Array.isArray(value.ratings)||!value.places||Array.isArray(value.places)||!Array.isArray(value.snapshots))throw Error('已保存的选择与当前候选池不兼容，请保留旧记录并核对。');
  for(const [key,rating] of Object.entries(value.ratings))if(!groups.has(key)||!['selected','rejected'].includes(rating))throw Error('选择记录含未知图片或状态。');
  for(const [place,p] of Object.entries(value.places))if(!data.places.some(v=>v.name===place)||!p||p.status&&!Object.hasOwn(statusLabels,p.status)||p.note!==undefined&&(typeof p.note!=='string'||p.note.length>1000))throw Error('景点反馈格式无效。');
  return value;
 }
 const count=(place,rating)=>[...groups].filter(([key,p])=>(!place||p.place===place)&&state?.ratings[key]===rating).length;
 function update(){
  const ready=state&&!busy&&!failed,completed=state?data.places.filter(p=>['done','none'].includes(state.places[p.name]?.status)).length:0;
  $('#selection-progress').textContent=state?`已选 ${count(null,'selected')} 张 · ${completed} / ${data.places.length} 个景点挑完`:'正在读取已保存选择…';
  $('#save-status').textContent=message|| (state?'选择已保存到本机项目':'');
  $('#save-status').classList.toggle('save-error',failed);
  $('#reload-selection').hidden=!failed;$('#reload-selection').disabled=busy;
  for(const button of document.querySelectorAll('[data-rating]')){
   const rating=state?.ratings[button.dataset.key],active=rating===button.dataset.rating;
   button.disabled=!ready;button.setAttribute('aria-pressed',String(active));
   button.textContent=button.dataset.rating==='selected'?(active?'已选 · 取消':'选这张'):(active?'已排除 · 撤销':'不合适');
  }
  for(const card of document.querySelectorAll('.photo[data-selection-key]')){
   card.classList.toggle('user-selected',state?.ratings[card.dataset.selectionKey]==='selected');
   card.classList.toggle('user-rejected',state?.ratings[card.dataset.selectionKey]==='rejected');
  }
  const placeStatus=state?.places[currentPlace]?.status??'in_progress';
  $('#place-selection-count').textContent=currentPlace?`本景点已选 ${count(currentPlace,'selected')} 张 · 标记不合适 ${count(currentPlace,'rejected')} 张 · ${statusLabels[placeStatus]}`:'';
  for(const button of document.querySelectorAll('[data-place-status]')){
   button.disabled=!ready||(button.dataset.placeStatus==='none'&&count(currentPlace,'selected')>0)||(button.dataset.placeStatus==='done'&&count(currentPlace,'selected')===0);
   button.setAttribute('aria-pressed',String(button.dataset.placeStatus===placeStatus));
  }
  $('#save-note').disabled=!ready;$('#selection-snapshot').disabled=!ready||!completed;$('#export-selection').disabled=!state||busy;
  const latest=state?.snapshots.at(-1);
  $('#snapshot-status').textContent=latest?`已保存分析快照，包含 ${latest.completedPlaces} 个已完成景点。${state.revision>latest.feedbackRevision+1?'你之后又作了修改，可再保存一版。':'告诉我“已挑好”，我就读取这版进行对比分析。'}`:'选择只用于归纳摄影偏好，不会自动替换行程图片。选好后保存本轮选择，再告诉我“已挑好”。';
  for(const [i,option] of [...$('#place-select').options].entries()){
   const p=data.places[i],n=count(p.name,'selected'),done=['done','none'].includes(state?.places[p.name]?.status);
   option.textContent=`${done?'✓ ':''}${p.name}${n?` · 已选${n}`:''}${p.days.length?'':' · 未入程'}`;
  }
 }
 function setNote(){
  $('#selection-note').value=noteDrafts.get(currentPlace)??state?.places[currentPlace]?.note??'';
  $('#note-status').textContent=noteDrafts.has(currentPlace)?'备注尚未保存':'';
 }
 async function load(){
  busy=true;message='读取已保存选择…';update();
  try{
   const response=await fetch('/api/selections',{signal:AbortSignal.timeout(10000)});
   const value=await response.json();if(!response.ok)throw Error(value.error||'读取失败');
   state=validate(value);failed=false;message=state.updatedAt?'已恢复保存的选择':'尚未选择，可以开始挑图';lastRequest=null;setNote();
  }catch(error){failed=true;message='选择读取失败：'+error.message;}
  finally{busy=false;update();}
 }
 async function mutate(action){
  if(!state||busy||failed)return;
  busy=true;message='保存中…';update();
  lastRequest={...action,catalogVersion:data.selectionCatalogVersion,revision:state.revision,operationId:crypto.randomUUID()};
  try{
   const response=await fetch('/api/selections',{method:'POST',headers:{'Content-Type':'application/json','X-Photo-Review':'1'},body:JSON.stringify(lastRequest),signal:AbortSignal.timeout(10000)});
   const value=await response.json();if(!response.ok)throw Error(value.error||'保存失败');
   state=validate(value);message='已保存';lastRequest=null;
   if(action.kind==='note'){noteDrafts.delete(action.place);if(currentPlace===action.place)setNote();}
  }catch(error){failed=true;message='保存未确认：'+error.message+' 请重读结果后核对。';}
  finally{busy=false;update();}
 }
 document.addEventListener('click',event=>{
  const rate=event.target.closest('[data-rating]');
  if(rate){const value=state?.ratings[rate.dataset.key]===rate.dataset.rating?'unmarked':rate.dataset.rating;void mutate({kind:'rating',key:rate.dataset.key,value});return;}
  const place=event.target.closest('[data-place-status]');if(place)void mutate({kind:'place',place:currentPlace,value:place.dataset.placeStatus});
 });
 $('#save-note').addEventListener('click',()=>void mutate({kind:'note',place:currentPlace,value:$('#selection-note').value}));
 $('#selection-note').addEventListener('input',()=>{noteDrafts.set(currentPlace,$('#selection-note').value);$('#note-status').textContent='备注尚未保存';});
 $('#selection-snapshot').addEventListener('click',()=>void mutate({kind:'snapshot'}));
 $('#reload-selection').addEventListener('click',()=>void load());
 $('#hide-ai').addEventListener('change',()=>document.body.classList.toggle('hide-ai',$('#hide-ai').checked));
 document.body.classList.add('hide-ai');
 $('#expand-candidates').addEventListener('click',()=>{for(const d of document.querySelectorAll('.column details.more'))d.open=true;});
 $('#export-selection').addEventListener('click',()=>{
  const blob=new Blob([JSON.stringify({exportedAt:new Date().toISOString(),feedback:state},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='北京景点选图备份.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 });
 void load();
 return {
  controls:p=>p.selectionKey?`<div class="photo-selection"><button type="button" data-key="${esc(p.selectionKey)}" data-rating="selected" aria-pressed="false" disabled>选这张</button><button type="button" data-key="${esc(p.selectionKey)}" data-rating="rejected" aria-pressed="false" disabled>不合适</button></div>`:'',
  setPlace(place){if(currentPlace!==place){currentPlace=place;setNote();}update();},
  refresh:update,
 };
};
