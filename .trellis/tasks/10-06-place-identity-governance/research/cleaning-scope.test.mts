import assert from 'node:assert/strict';
import test from 'node:test';
import {buildCleaningScope,type ScopeInput} from './cleaning-scope.mjs';

const fixture=(count=55):ScopeInput=>{
  const sources=Array.from({length:count},(_,i)=>({id:i+1,city:'测试城',name:`地点${i}`,normalized_name:`地点${i}`,
    entity_id:`e${i}`,place_type:'attraction',latitude:30+i*.001,longitude:120,is_active:true,quality_score:10,
    recommend_score:100-i,mention_count_30d:10,source_count:2,address:'测试地址',top_reasons:[]}));
  return {sources,entities:sources.map(s=>({entity_id:s.entity_id,city:s.city,canonical_name:s.name,primary_place_id:s.id,
    aliases:[],legacy_ids:[s.entity_id],revision:1,status:'ACTIVE',redirect_to:null,overrides:{}})),reviews:[],scopes:[],scopeSources:[],
    downstream:{places:sources.map(s=>({id:s.entity_id,city:s.city,name:s.name,category:'文化',source:'xhs',verified:true,
      lat:s.latitude,lng:s.longitude,payload:{identity:{version:2,entityId:s.entity_id,memberIds:[s.entity_id],memberNames:[s.name]}}}))},golden:[]};
};
test('用户排除城市不进入主体、依赖、参考或待审，不影响其他城市配额',()=>{
  const data=fixture();const excluded=structuredClone(data.sources[0]!);
  data.sources.push({...excluded,id:999,entity_id:'excluded',city:'云南',name:'排除地点'});
  data.entities.push({...data.entities[0]!,entity_id:'excluded',primary_place_id:999,city:'云南',canonical_name:'排除地点'});
  data.downstream.places.push({...data.downstream.places[0]!,id:'excluded',city:'云南',name:'排除地点'});
  data.golden.push({city:'云南',name:'排除地点',category:'自然',file:'golden.json'});
  data.reviews.push({id:999,city:'云南',status:'PENDING',detail:{reason:'similar_name',entityIds:['excluded']}});
  const before=structuredClone(data),result=buildCleaningScope(data,[],{excludedCities:['云南']});
  assert.equal(result.selected.length,50);assert.ok(result.selected.every(p=>p.place.city!=='云南'));
  assert.ok(result.preservedReferences.every(p=>p.city!=='云南'));
  assert.equal(result.deferredReviews.length,0);assert.equal(result.skippedCities[0]!.sourceRows,1);
  assert.deepEqual(data,before);assert.deepEqual(result.policy.excludedCities,['云南']);
});
test('稳定身份先去重，旧别名不重复占50个名额',()=>{
  const data=fixture();data.sources.push({...data.sources[0]!,id:100,name:'别名',recommend_score:999});
  const result=buildCleaningScope(data);
  assert.equal(result.selected.length,50);assert.equal(new Set(result.selected.map(p=>p.place.id)).size,50);
  assert.equal(result.ranked.find(p=>p.id==='e0')!.score,100);
  assert.deepEqual(result.ranked.find(p=>p.id==='e0')!.sourceIds,[1,100]);
});
test('旧源有坐标但实体已清空或撤回，不进入重点配额',()=>{
  const data=fixture();data.entities[0]!.overrides={lat:null,lng:null};
  data.downstream.places[1]!.payload!.identityWithdrawal={version:1};
  data.downstream.places[2]!.verified=false;
  data.downstream.places[3]!.lat=null;data.downstream.places[3]!.lng=null;
  const result=buildCleaningScope(data);
  assert.ok(['e0','e1','e2','e3'].every(id=>!result.selected.some(p=>p.place.id===id)));
  assert.equal(result.selected.length,50);
});
test('错城人工排除单列治理，审核行与实体对分别计数',()=>{
  const data=fixture(60);
  data.reviews=[{id:1,city:'测试城',status:'PENDING',detail:{reason:'similar_name',entityIds:['e0','e58']}},
    {id:2,city:'测试城',status:'PENDING',detail:{reason:'similar_name',entityIds:['e58','e0']}}];
  const result=buildCleaningScope(data,[{entityId:'e59',revision:1,bucket:null,evidence:'已证实错城来源，另行隔离'}]);
  assert.equal(result.summary.inputQualified,60);assert.equal(result.summary.eligible,59);
  assert.equal(result.summary.manuallyExcluded,1);assert.equal(result.manuallyExcluded[0]!.id,'e59');
  assert.equal(result.summary.inScopeReviews.rows,2);assert.equal(result.summary.inScopeReviews.entityPairs,1);
  assert.equal(result.summary.quotaSelected,50);assert.equal(result.summary.referenceAdded,0);
});
test('类别修正先于排名，修正过期整次拒绝',()=>{
  const data=fixture();data.entities[0]!.overrides={category:'美食'};
  const changes=[{entityId:'e1',revision:1,bucket:'food' as const,evidence:'冻结原文明确餐饮'}];
  const result=buildCleaningScope(data,changes);
  assert.equal(result.quotaGroups.find(g=>g.bucket==='food')!.selectedIds.length,2);
  assert.equal(result.quotaGroups.find(g=>g.bucket==='attraction')!.selectedIds.length,50);
  assert.throws(()=>buildCleaningScope(data,[{...changes[0]!,revision:2}]),/过期/);
  assert.throws(()=>buildCleaningScope(data,[changes[0]!,changes[0]!]),/重复/);
});
test('同分地理覆盖可复现且不被输入顺序改变',()=>{
  const data=fixture(60);data.sources.forEach(s=>{s.recommend_score=10;s.source_count=1;});
  data.sources[59]!.latitude=31;data.downstream.places[59]!.lat=31;
  const before=structuredClone(data),first=buildCleaningScope(data);
  const second=buildCleaningScope({...data,sources:[...data.sources].reverse(),entities:[...data.entities].reverse(),
    downstream:{places:[...data.downstream.places].reverse()}});
  assert.ok(first.selected.some(p=>p.place.id==='e59'));
  assert.deepEqual(first.selected.map(p=>p.place.id),second.selected.map(p=>p.place.id));assert.deepEqual(data,before);
});
test('金集精确必去可超配额，相似名字不直接认领',()=>{
  const data=fixture();data.golden=[{city:'测试城',name:'地点54',category:'文化',file:'golden.json'},
    {city:'测试城',name:'地点53公园',category:'文化',file:'golden.json'}];
  const result=buildCleaningScope(data);
  assert.equal(result.selected.length,51);assert.ok(result.selected.some(p=>p.place.id==='e54'));
  assert.equal(result.referenceNeedsReview.find(r=>r.name==='地点53公园')!.status,'unresolved');
  assert.ok(!result.selected.some(p=>p.place.id==='e53'));
});
test('必去精确同名源无分数时保留为核查依赖，不能丢失或补造分数',()=>{
  const data=fixture();data.sources[54]!.recommend_score=null;data.downstream.places[54]!.verified=false;
  data.golden=[{city:'测试城',name:'地点54',category:'美食',file:'golden.json'}];
  const result=buildCleaningScope(data);
  assert.ok(!result.selected.some(p=>p.place.id==='e54'));
  assert.deepEqual(result.referenceNeedsReview.find(r=>r.name==='地点54')!.candidateIds,['e54']);
  assert.deepEqual(result.dependencies.map(p=>p.id),['e54']);
});
test('已隔离错城提及与普通长尾待审分别计数，原状态保持PENDING',()=>{
  const data=fixture(60);data.downstream.places[59]!.payload!.identityWithdrawal={version:1};
  data.scopes=[{place_id:60,city:'测试城',entity_ids:['e59'],name_keys:['地点59']}];
  data.reviews=[{id:1,city:'测试城',status:'PENDING',detail:{reason:'mention_scope',scopePlaceIds:[60]}}];
  const result=buildCleaningScope(data,[{entityId:'e59',revision:1,bucket:null,evidence:'已证实错城并撤回'}]);
  assert.equal(result.summary.pendingDeferred,1);assert.equal(result.summary.quarantinedReviewRows,1);
  assert.equal(result.summary.deferredOtherRows,0);assert.equal(result.summary.pendingInScope,0);
  assert.equal(result.quarantinedReviews[0]!.status,'PENDING');
});
test('直接待审依赖保留，长尾相似图不递归扩张或伪装成已解决',()=>{
  const data=fixture(60);
  data.reviews=[{id:1,city:'测试城',status:'PENDING',detail:{reason:'similar_name',entityIds:['e0','e58']}},
    {id:2,city:'测试城',status:'PENDING',detail:{reason:'similar_name',entityIds:['e58','e59']}}];
  const result=buildCleaningScope(data);
  assert.equal(result.scopedReviews[0]!.id,1);assert.equal(result.deferredReviews[0]!.id,2);
  assert.deepEqual(result.dependencies.map(p=>p.id),['e58']);
  assert.equal(data.reviews[1]!.status,'PENDING');
});
test('共同提及范围和明确子项不遗漏，无定位图片待审保守纳入',()=>{
  const data=fixture(60);data.scopes=[{place_id:1,city:'测试城',entity_ids:['e0','e59'],name_keys:['地点0']}];
  data.downstream.places[0]!.payload!.components=[{canonicalPlaceId:'e58',name:'地点58'}];
  data.reviews=[{id:1,city:'测试城',status:'PENDING',detail:{reason:'image_scope',imageKey:'note_image:1'}}];
  const result=buildCleaningScope(data);
  assert.deepEqual(result.dependencies.map(p=>p.id).sort(),['e58','e59']);assert.equal(result.scopedReviews.length,1);
});
test('PG bigint字符串恢复主源顺序，悬空跨城或环不静默排除',()=>{
  const data=fixture();const strings=JSON.parse(JSON.stringify(data)) as ScopeInput;
  (strings.sources[0] as unknown as {id:string}).id='1';
  (strings.entities[0] as unknown as {primary_place_id:string}).primary_place_id='1';
  assert.deepEqual(buildCleaningScope(strings),buildCleaningScope(data));
  data.entities[0]!.redirect_to='e1';data.entities[1]!.redirect_to='e0';assert.throws(()=>buildCleaningScope(data),/环/);
});
