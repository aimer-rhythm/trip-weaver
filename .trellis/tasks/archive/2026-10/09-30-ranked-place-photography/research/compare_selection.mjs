import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

const digest=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>{try{const u=new URL(value);return u.protocol==='https:'?u.origin+decodeURIComponent(u.pathname).replace(/\/$/,''):null;}catch{return null;}};
// Same-place equivalents share feedback, but a POI page is never treated as a photo identity.
export function selectionCatalog(data){
 const all=[...data.candidates.filter(p=>p.preview),...data.places.flatMap(p=>p.current)];
 const groups=[];
 for(const place of data.places){
  const photos=all.filter(p=>p.place===place.name),parents=photos.map((_,i)=>i),tokens=new Map();
  const find=i=>parents[i]===i?i:(parents[i]=find(parents[i]));
  photos.forEach((p,i)=>{
   const keys=[];
   if(!['amap','xhs'].includes(p.source)&&p.sourceUrl&&canonical(p.sourceUrl))keys.push('work:'+canonical(p.sourceUrl));
   if(canonical(p.preview))keys.push('image:'+canonical(p.preview));
   const localHash=p.preview.match(/\/([a-f0-9]{64})\.(webp|jpg|jpeg|png)$/)?.[1];
   if(localHash)keys.push('bytes:'+localHash);
   keys.push('record:'+p.source+':'+p.id);
   for(const key of keys){if(tokens.has(key))parents[find(i)]=find(tokens.get(key));else tokens.set(key,i);}
  });
  const buckets=new Map();photos.forEach((p,i)=>{const key=find(i);if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(p);});
  for(const records of buckets.values()){
   const refs=records.map(p=>`${p.source}/${p.id}`).sort();
   const key=digest(place.name+'\n'+refs.join('\n'));
   for(const photo of records)photo.selectionKey=key;
   groups.push({key,place:place.name,records});
  }
 }
 const catalogVersion=digest(JSON.stringify(groups.map(g=>[g.place,g.key]).sort()));
 return {groups,catalogVersion};
}

export function createSelectionStore(data,directory){
 const {groups,catalogVersion}=selectionCatalog(data),known=new Map(groups.map(g=>[g.key,g]));
 const names=new Set(data.places.map(p=>p.name)),file=path.join(directory,'selections.json');
 const empty=()=>({schemaVersion:1,catalogVersion,tripId:data.tripId,revision:0,updatedAt:null,lastOperation:null,ratings:{},places:{},snapshots:[]});
 const error=(status,message)=>Object.assign(new Error(message),{status});
 async function read(){
  try{
   const state=JSON.parse(await fs.readFile(file,'utf8'));
   if(state.schemaVersion!==1||state.catalogVersion!==catalogVersion||!Number.isSafeInteger(state.revision)||!state.ratings||!state.places||!Array.isArray(state.snapshots))throw error(409,'候选池或保存格式已变化，请保留旧选择并核对数据。');
   return state;
  }catch(e){if(e.code==='ENOENT')return empty();throw e;}
 }
 async function atomic(target,value){
  await fs.mkdir(path.dirname(target),{recursive:true});const temp=target+'.'+randomUUID()+'.tmp';
  try{await fs.writeFile(temp,JSON.stringify(value,null,2)+'\n',{flag:'wx'});await fs.rename(temp,target);}
  finally{await fs.rm(temp,{force:true});}
 }
 let tail=Promise.resolve();
 async function apply(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||input.catalogVersion!==catalogVersion||!Number.isSafeInteger(input.revision)||typeof input.operationId!=='string'||!/^[a-f0-9-]{36}$/.test(input.operationId))throw error(400,'无效的选择请求。');
  const state=await read();
  if(state.lastOperation===input.operationId)return state;
  if(input.revision!==state.revision)throw error(409,'另一页面已更新选择，请重新载入已保存结果。');
  if(input.kind==='rating'){
   if(!known.has(input.key)||!['selected','rejected','unmarked'].includes(input.value))throw error(400,'图片或选择状态无效。');
   if(input.value==='unmarked')delete state.ratings[input.key];else state.ratings[input.key]=input.value;
   const place=known.get(input.key).place;
   state.places[place]={...state.places[place],status:'in_progress'};
  }else if(input.kind==='place'){
   if(!names.has(input.place)||!['in_progress','done','none'].includes(input.value))throw error(400,'景点或完成状态无效。');
   const selected=groups.some(g=>g.place===input.place&&state.ratings[g.key]==='selected');
   if(input.value==='none'&&selected)throw error(400,'此景点还有已选图片，请先取消选择。');
   if(input.value==='done'&&!selected)throw error(400,'请先选择图片，或标记“都不合适”。');
   state.places[input.place]={...state.places[input.place],status:input.value};
  }else if(input.kind==='note'){
   if(!names.has(input.place)||typeof input.value!=='string'||input.value.length>1000)throw error(400,'备注最多1000字。');
   state.places[input.place]={...state.places[input.place],note:input.value};
  }else if(input.kind==='snapshot'){
   const completed=data.places.filter(p=>['done','none'].includes(state.places[p.name]?.status));
   if(!completed.length)throw error(400,'请至少完成一个景点的挑选。');
   const id=`selection-${Date.now()}-${randomUUID()}`;
   const snapshot={schemaVersion:1,id,createdAt:new Date().toISOString(),catalogVersion,tripId:data.tripId,
    feedbackRevision:state.revision,scope:'user-preference-comparison-only',
    instructions:'入选是正样本，明确不合适是负样本；未标记不等于负样本。仅对已完成景点归纳，其他景点保留待选。相同照片不重复计权，偏好不代表身份/许可确认。',
    places:data.places.map(p=>({place:p.name,status:state.places[p.name]?.status??'in_progress',note:state.places[p.name]?.note??'',
     candidates:groups.filter(g=>g.place===p.name).map(g=>({key:g.key,rating:state.ratings[g.key]??'unmarked',records:g.records.map(r=>({id:r.id,source:r.source,preview:r.preview,title:r.title,sourceUrl:r.sourceUrl,photographer:r.photographer,license:r.license,width:r.width,height:r.height}))}))}))};
   await atomic(path.join(directory,'snapshots',id+'.json'),snapshot);
   state.snapshots.push({id,at:snapshot.createdAt,feedbackRevision:state.revision,completedPlaces:completed.length});
  }else throw error(400,'不支持的选择操作。');
  state.revision++;state.updatedAt=new Date().toISOString();state.lastOperation=input.operationId;
  await atomic(file,state);return state;
 }
 return {read,catalogVersion,groups,mutate(input){const result=tail.then(()=>apply(input));tail=result.catch(()=>{});return result;}};
}
