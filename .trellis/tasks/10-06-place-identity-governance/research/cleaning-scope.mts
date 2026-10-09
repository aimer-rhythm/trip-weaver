import {placeNameKey} from '@tripweaver/shared';
import {createPlaceIdentityIndex, type IdentityPlace} from '../../../../apps/server/src/lib/placeIdentity.js';

export const QUOTAS = {attraction:50, food:30, cafe:10, photo_spot:10, market:10} as const;
export type Bucket = keyof typeof QUOTAS;
interface Source {
  id:number; city:string; name:string; normalized_name:string; entity_id:string|null; place_type:string;
  latitude:number|null; longitude:number|null; is_active:boolean; quality_score:number;
  recommend_score:number|null; mention_count_30d:number|null; source_count:number|null;
  address:string|null; top_reasons:unknown[]|null;
}
interface Entity {
  entity_id:string; city:string; canonical_name:string; primary_place_id:number|null; aliases:string[]; legacy_ids:string[];
  revision:number; status:string; redirect_to:string|null; overrides:Record<string,unknown>;
}
interface Place extends IdentityPlace {verified:boolean; category:string; source:string; lat:number|null; lng:number|null}
interface Review {id:number;city:string;status:string;detail:{reason:string;entityIds?:string[];scopePlaceIds?:number[];[key:string]:unknown}}
export interface ScopeInput {
  sources:Source[];entities:Entity[];reviews:Review[];
  scopes:Array<{place_id:number;city:string;entity_ids:string[];name_keys:string[]}>;
  scopeSources:Array<{place_id:number;scope_place_id:number}>;
  downstream:{places:Place[]};golden:Array<{city:string;name:string;category:string;file:string}>;
}
export interface BucketCorrection {entityId:string;revision:number;bucket:Bucket|null;evidence:string}
export interface ScopeOptions {excludedCities?:string[]}
export interface RankedPlace {
  id:string;city:string;name:string;revision:number;sourceIds:number[];rawType:string;bucket:Bucket|null;
  bucketBasis:string;score:number;sources:number;quality:number;lat:number;lng:number;address:string|null;
}
const typeBuckets:Record<string,Bucket>={attraction:'attraction',park:'attraction',scenic_area:'attraction',museum:'attraction',
  food:'food',cafe:'cafe',photo_spot:'photo_spot',market:'market',business_area:'market',shop:'market',mall:'market'};
const categoryBuckets:Record<string,Bucket|null>={'景点':'attraction','文化':'attraction','自然':'attraction','娱乐':'attraction',
  '美食':'food','咖啡':'cafe','购物':'market','住宿':null,'交通':null,'其他':null};
const groupBy=<T,>(rows:T[], key:(row:T)=>string)=>{
  const groups=new Map<string,T[]>();
  for(const row of rows){const k=key(row);groups.set(k,[...(groups.get(k)??[]),row]);}
  return groups;
};
const validCoordinate=(lat:unknown,lng:unknown):lat is number=>typeof lat==='number'&&typeof lng==='number'
  &&Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180;
const byEvidence=(a:RankedPlace,b:RankedPlace)=>b.score-a.score||b.sources-a.sources||b.quality-a.quality;
// 约2km网格仅在推荐分/独立来源数/质量均相同时增加地点分布；不用于身份判等。
const cell=(p:RankedPlace)=>`${Math.floor(p.lat/.02)}:${Math.floor(p.lng/.02)}`;

export function buildCleaningScope(input:ScopeInput, corrections:BucketCorrection[]=[], options:ScopeOptions={}) {
  const excludedCities=[...new Set(options.excludedCities??[])].sort();
  if(excludedCities.some(city=>typeof city!=='string'||!city.trim()))throw new Error('排除城市名称无效');
  const skippedCities=excludedCities.map(city=>({city,reason:'用户明确不处理',
    sourceRows:input.sources.filter(s=>s.city===city).length,entities:input.entities.filter(e=>e.city===city).length}));
  const included=(row:{city:string})=>!excludedCities.includes(row.city);
  const omittedEntities=new Set(input.entities.filter(e=>!included(e)).map(e=>e.entity_id));
  const includedSourceIds=new Set(input.sources.filter(included).map(s=>String(s.id)));
  input={...input,sources:input.sources.filter(included),entities:input.entities.filter(included),
    reviews:input.reviews.filter(included),scopes:input.scopes.filter(included),
    scopeSources:input.scopeSources.filter(s=>includedSourceIds.has(String(s.place_id))),
    downstream:{...input.downstream,places:input.downstream.places.filter(included)},golden:input.golden.filter(included)};
  corrections=corrections.filter(c=>!omittedEntities.has(c.entityId));
  const integer=(value:unknown)=>{const n=Number(value);if(!Number.isSafeInteger(n)||n<=0)throw new Error('无效来源ID');return n;};
  input={...input,sources:input.sources.map(s=>({...s,id:integer(s.id)})),
    entities:input.entities.map(e=>({...e,primary_place_id:e.primary_place_id===null?null:integer(e.primary_place_id)})),
    scopes:input.scopes.map(s=>({...s,place_id:integer(s.place_id)}))};
  const entities=new Map(input.entities.map(e=>[e.entity_id,e]));
  const resolve=(id:string):Entity=>{
    const seen=new Set<string>();let e=entities.get(id);const city=e?.city;
    while(e?.redirect_to){if(seen.has(e.entity_id))throw new Error('身份重定向环');seen.add(e.entity_id);e=entities.get(e.redirect_to);}
    if(!e||e.city!==city)throw new Error(`悬空或跨城身份：${id}`);return e;
  };
  const down=new Map(input.downstream.places.map(p=>[p.id,p]));
  const correctionById=new Map(corrections.map(c=>[c.entityId,c]));
  if(correctionById.size!==corrections.length)throw new Error('分类复核重复');
  for(const c of corrections){const e=entities.get(c.entityId);if(!e||e.redirect_to||e.revision!==c.revision||!c.evidence.trim()
    ||(c.bucket!==null&&!(c.bucket in QUOTAS)))throw new Error('分类复核已过期或缺证据');}
  const sourceGroups=groupBy(input.sources.filter(s=>s.entity_id!==null),s=>resolve(s.entity_id!).entity_id);
  const ranked:RankedPlace[]=[];
  const excluded:Array<{id:string;city:string;name:string;reason:string}>=[];
  for(const [id,members] of sourceGroups){
    const e=entities.get(id)!,p=down.get(id);
    const valid=members.filter(s=>s.is_active&&s.recommend_score!==null&&Number.isFinite(s.recommend_score)&&s.quality_score>=0);
    const s=valid.find(s=>s.id===e.primary_place_id)??[...valid].sort((a,b)=>(b.recommend_score??0)-(a.recommend_score??0)||a.id-b.id)[0];
    const lat=Object.hasOwn(e.overrides,'lat')?e.overrides.lat:p?.lat;
    const lng=Object.hasOwn(e.overrides,'lng')?e.overrides.lng:p?.lng;
    if(e.status!=='ACTIVE'||!s||!p?.verified||p.payload?.canonicalRedirectTo||p.payload?.identityWithdrawal||!validCoordinate(lat,lng)){
      excluded.push({id,city:e.city,name:e.canonical_name,reason:'未满足当前身份、来源、可用性或有效坐标'});continue;
    }
    const category=e.overrides.category;
    let bucket:Bucket|null=typeBuckets[s.place_type]??null,bucketBasis='原始地点类型';
    if(typeof category==='string'&&Object.hasOwn(categoryBuckets,category)){
      bucket=categoryBuckets[category]??null;
      if(bucket==='food'&&s.place_type==='cafe')bucket='cafe';
      if(bucket==='attraction'&&s.place_type==='photo_spot')bucket='photo_spot';
      bucketBasis='现行实体已治理类别';
    }
    const correction=correctionById.get(id);
    if(correction){bucket=correction.bucket;bucketBasis=correction.evidence;}
    const controlled=Array.isArray(p.payload?.mentionSources);
    const score=controlled&&typeof p.payload?.recommendScore==='number'?p.payload.recommendScore:s.recommend_score!;
    ranked.push({id,city:e.city,name:e.canonical_name,revision:e.revision,sourceIds:members.map(m=>m.id).sort((a,b)=>a-b),
      rawType:s.place_type,bucket,bucketBasis,score,sources:s.source_count??0,quality:s.quality_score,
      lat,lng:lng as number,address:typeof e.overrides.address==='string'?e.overrides.address:s.address});
  }
  // 必去参考使用现行完整目录解析；不把相似字串或旧normalized_name当同义证据。
  const index=createPlaceIdentityIndex(input.downstream.places.filter(p=>p.verified||p.payload?.identityWithdrawal));
  const references=[...input.golden.filter(a=>['文化','自然','娱乐','美食','购物'].includes(a.category)).map(a=>({...a,reason:`金集参考：${a.file}`})),
    {city:'济南',name:'大明湖',reason:'用户原始反馈地点'},
    {city:'济南',name:'融汇老商埠',reason:'用户原始反馈地点'}];
  const uniqueReferences=[...new Map(references.map(r=>[`${r.city}:${placeNameKey(r.name)}`,r])).values()];
  const selected=new Map<string,{place:RankedPlace;reasons:string[]}>();
  const add=(place:RankedPlace,reason:string)=>{const row=selected.get(place.id);if(row){if(!row.reasons.includes(reason))row.reasons.push(reason);}
    else selected.set(place.id,{place,reasons:[reason]});};
  const groups=groupBy(ranked.filter(p=>p.bucket!==null),p=>`${p.city}:${p.bucket}`);
  const quotaGroups=[];
  for(const [key,list] of [...groups].sort(([a],[b])=>a.localeCompare(b))){
    const quota=QUOTAS[list[0]!.bucket!],remaining=[...list].sort((a,b)=>byEvidence(a,b)||a.id.localeCompare(b.id));
    const chosen:RankedPlace[]=[],cells=new Map<string,number>();
    while(remaining.length&&chosen.length<quota){
      const first=remaining[0]!;
      const tied=remaining.filter(p=>byEvidence(first,p)===0).sort((a,b)=>(cells.get(cell(a))??0)-(cells.get(cell(b))??0)||a.id.localeCompare(b.id));
      const next=tied[0]!;remaining.splice(remaining.indexOf(next),1);chosen.push(next);cells.set(cell(next),(cells.get(cell(next))??0)+1);
    }
    chosen.forEach((p,i)=>add(p,`配额：${p.bucket} 第${i+1}/${quota}`));
    quotaGroups.push({key,city:list[0]!.city,bucket:list[0]!.bucket,available:list.length,quota,selectedIds:chosen.map(p=>p.id),
      tieAtBoundary:chosen.length===quota&&remaining.some(p=>p.score===chosen.at(-1)!.score)});
  }
  const referenceNeedsReview=[];
  const preservedReferences=[];
  const upstreamCities=new Set(input.entities.map(e=>e.city));
  for(const ref of uniqueReferences){
    if(!upstreamCities.has(ref.city)){preservedReferences.push({...ref,reason:'本城无上游提取数据，保留原金集兼容'});continue;}
    const result=index.resolve(ref.city,ref.name);
    if(result.status==='resolved'){
      const target=ranked.find(p=>p.id===result.canonicalPlaceId);
      if(target&&target.bucket!==null)add(target,ref.reason);
      else if(!entities.has(result.canonicalPlaceId))preservedReferences.push({...ref,id:result.canonicalPlaceId,
        reason:'下游独立金集/历史行，保留现状；与重点来源发生交叉时另行追溯'});
      else referenceNeedsReview.push({...ref,status:'不在当前合格上游类型集合',candidateIds:[result.canonicalPlaceId]});
    }else referenceNeedsReview.push({...ref,status:result.status,
      candidateIds:result.status==='ambiguous'?result.candidates.map(p=>p.id):[...new Set(input.entities
        .filter(e=>e.city===ref.city&&[e.canonical_name,...e.aliases].some(name=>placeNameKey(name)===placeNameKey(ref.name)))
        .map(e=>resolve(e.entity_id).entity_id))]});
  }
  const dependencies=new Map<string,string[]>();
  const includeDependency=(id:string,reason:string)=>{const e=resolve(id);if(!selected.has(e.entity_id))dependencies.set(e.entity_id,
    [...new Set([...(dependencies.get(e.entity_id)??[]),reason])]);};
  // 成组scope和显式子项必须完整追溯；相似实体只看与重点实体直接相连的审核，不递归整座相似图。
  const coreIds=new Set(selected.keys());
  for(const ref of referenceNeedsReview)for(const id of ref.candidateIds)if(entities.has(id))includeDependency(id,`必去参考待核：${ref.name}`);
  for(const id of coreIds){
    const components=down.get(id)?.payload?.components;
    if(Array.isArray(components))for(const c of components){
      if(c&&typeof c==='object'&&typeof c.canonicalPlaceId==='string'&&entities.has(c.canonicalPlaceId))includeDependency(c.canonicalPlaceId,`组合子项：${id}`);
    }
  }
  for(const scope of input.scopes)if(scope.entity_ids.some(id=>coreIds.has(resolve(id).entity_id)))
    for(const id of scope.entity_ids)includeDependency(id,`共同提及范围：${scope.place_id}`);
  const anchored=new Set([...coreIds,...dependencies.keys()]);
  const pending=input.reviews.filter(r=>r.status==='PENDING');
  const scopedReviews=[],deferredReviews=[];
  for(const review of pending){
    const ids=(review.detail.entityIds??[]).map(id=>resolve(id).entity_id);
    const scopeIds=(review.detail.scopePlaceIds??[]).map(integer);
    const relevant=ids.some(id=>anchored.has(id))||input.scopes.some(s=>scopeIds.includes(s.place_id)
      &&s.entity_ids.some(id=>anchored.has(resolve(id).entity_id)))
      ||(review.detail.reason==='image_scope'&&[...anchored].some(id=>entities.get(id)?.city===review.city));
    if(relevant){scopedReviews.push(review);for(const id of ids)includeDependency(id,`重点地点直接审核：${review.id}`);}
    else deferredReviews.push(review);
  }
  const sourceIds=[...new Set([...coreIds,...dependencies.keys()].flatMap(id=>(sourceGroups.get(id)??[]).map(s=>s.id)))].sort((a,b)=>a-b);
  const reviewCounts=(rows:Review[])=>({rows:rows.length,entityPairs:new Set(rows
    .filter(r=>r.detail.reason==='similar_name')
    .map(r=>[...new Set((r.detail.entityIds??[]).map(id=>resolve(id).entity_id))].sort().join(':'))).size,
    mentions:rows.filter(r=>r.detail.reason==='mention_scope').length,images:rows.filter(r=>r.detail.reason==='image_scope').length});
  const manuallyExcluded=corrections.filter(c=>c.bucket===null).map(c=>({id:c.entityId,
    city:entities.get(c.entityId)!.city,name:entities.get(c.entityId)!.canonical_name,evidence:c.evidence}));
  const withdrawnExclusions=new Set(manuallyExcluded.filter(e=>down.get(e.id)?.payload?.identityWithdrawal).map(e=>e.id));
  const quarantinedReviews=deferredReviews.filter(r=>r.detail.reason==='mention_scope'&&input.scopes.some(s=>
    (r.detail.scopePlaceIds??[]).map(integer).includes(s.place_id)&&s.entity_ids.length>0
    &&s.entity_ids.every(id=>withdrawnExclusions.has(resolve(id).entity_id))));
  const quotaSelected=new Set(quotaGroups.flatMap(g=>g.selectedIds)).size;
  return {version:1,policy:{quotas:QUOTAS,excludedCities,quotaUnit:'每city桶内每类型的稳定实体',
    tieBreak:'推荐分、独立来源数、质量分；均相同后优先较少覆盖的约2km网格，再用稳定ID固定顺序',
    deferredMeaning:'不在本轮主动清洗范围，原始数据/待审状态及现有身份防护保留'},
    selected:[...selected.values()],quotaGroups,skippedCities,
    dependencies:[...dependencies].map(([id,reasons])=>({id,city:entities.get(id)!.city,name:entities.get(id)!.canonical_name,reasons})),
    sourceIds,referenceNeedsReview,preservedReferences,scopedReviews,deferredReviews,ranked,excluded,manuallyExcluded,quarantinedReviews,
    summary:{inputQualified:ranked.length,eligible:ranked.filter(p=>p.bucket!==null).length,
      manuallyExcluded:manuallyExcluded.length,quotaSelected,referenceAdded:selected.size-quotaSelected,
      primary:selected.size,dependencies:dependencies.size,sourceRows:sourceIds.length,
      pendingInScope:scopedReviews.length,pendingDeferred:deferredReviews.length,
      quarantinedReviewRows:quarantinedReviews.length,deferredOtherRows:deferredReviews.length-quarantinedReviews.length,
      inScopeReviews:reviewCounts(scopedReviews),deferredReviews:reviewCounts(deferredReviews),
      referenceNeedsReview:referenceNeedsReview.length,preservedReferences:preservedReferences.length}};
}
