// 第67批仅清理四个缺乏具体地点依据的共同坐标，不改变名称、分配或观点。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const url=p=>new URL(p,import.meta.url),read=p=>JSON.parse(fs.readFileSync(url(p),'utf8'));
const hash=p=>createHash('sha256').update(fs.readFileSync(url(p))).digest('hex');
const dir='priority-cities/成都/',base=dir+'run-1791504271958861000/';
const pointer=read('cleaning-scope/current.json'),frozen=read(base+'sources.json'),details=read(base+'details.json');
assert.equal(pointer.latestAppliedEntityBatch,66);assert.equal(pointer.userAcceptance,false);assert.equal(pointer.cityReviewLedgers['成都'],'../'+dir+'review-02.json');
assert.equal(hash(base+'sources.json'),'bce267716acbb85759556b8ab51a868d1e32128a8556c66de0b69a39914ffd53');
const targets=[1829,1873,2017,2030],all=[...targets,1868,1869];
const groups=frozen.groups.filter(g=>g.sourceIds.some(id=>all.includes(id))),ids=groups.map(g=>g.entity.entity_id),mids=groups.flatMap(g=>g.mentionIds);
const mentions=details.mentions.filter(m=>mids.includes(m.id)),notes=details.noteDetails.filter(n=>mentions.some(m=>m.raw_note_id===n.id));
const sources=details.sources.filter(s=>all.includes(s.source.id));
assert.deepEqual([groups.length,sources.length,mentions.length,notes.length],[6,6,12,5]);assert.ok(groups.every(g=>g.entity.revision===1));
const catalog={entities:details.catalog.entities.filter(e=>ids.includes(e.entity_id)),members:details.catalog.members.filter(m=>all.includes(m.place_id)),reviews:details.catalog.reviews.filter(r=>(r.detail.entityIds??[]).some(id=>ids.includes(id)))};
assert.equal(catalog.reviews.length,0);
const reviewFile=dir+'common-point-source-review-01.json';
const reasons={
  1829:'原文为成都麻布食堂体验，只含成都万象城标签，没有门牌或可核对的分店位置；不得凭标签指定万象城店。旧坐标与另三处无关主体完全相同，地址仅四川省成都市且无POI ID，缺乏具体店址依据。清空点、泛地址和adcode；原名与体验保留，门店范围仍待核。',
  1873:'两篇原文的四大会馆为洛带古镇内湖广、江西、广东、川北四处会馆的合称，不是单栋建筑。旧点与市区商户共用、只有市级地址，不能定位这组会馆；清点和adcode，仅记洛带古镇概略地址。不拆分创建会馆，也不把其他会馆名新增为同义别名。',
  2017:'原文明确真茶屋（天府广场店），但无具体门牌。旧坐标与洛带会馆等三处无关主体完全一致、只有四川省成都市泛地址且无POI ID；清空点、泛地址和adcode，不借天府广场中心定位门店，原分店名称保留。',
  2030:'一街七巷为洛带古镇街巷格局的集合称呼，原文没有单一街巷起点或门牌。旧点与市区商户共用、仅市级地址，不能定位该街巷范围；清点和adcode，仅记洛带古镇。主体范围和现有古镇主街消费边界仍待核，不拆分或合并。'
};
const decisions=targets.map(sid=>{
  const raw=sources.find(s=>s.source.id===sid),g=groups.find(g=>g.sourceIds.includes(sid));
  assert.deepEqual([raw.source.latitude,raw.source.longitude,raw.source.address,raw.source.amap_poi_id,raw.supplement.adcode],[30.572961,104.066301,'四川省成都市','','510100']);
  return {key:`all-cities-20261009-batch-67-common-point-${sid}`,city:'成都',entityId:g.entity.entity_id,expectedRevisions:{[g.entity.entity_id]:1},mergeEntityIds:[],canonicalName:g.entity.canonical_name,aliases:g.entity.aliases,
    overrides:{lat:null,lng:null,adcode:'',geoStatus:'unresolvable',address:[1873,2030].includes(sid)?'洛带古镇':''},
    evidence:[{kind:'reviewed_full_original_and_existing_position',file:reviewFile,sourcePlaceId:sid,sourceHash:raw.sourceHash,mentionIds:g.mentionIds,original:{lat:raw.source.latitude,lng:raw.source.longitude,address:raw.source.address,adcode:raw.supplement.adcode,poiId:raw.source.amap_poi_id},
      notes:notes.filter(n=>mentions.some(m=>g.mentionIds.includes(m.id)&&m.raw_note_id===n.id)).map(n=>({noteId:n.id,quote:n.desc,rawJsonSha256:n.rawJsonSha256,analysisSha256:n.analysisSha256})),conclusion:reasons[sid]}]};
});
const source={readOnly:true,capturedAt:new Date().toISOString(),city:'成都',entityBatch:66,originalSourceFile:base+'sources.json',originalSourceSha256:hash(base+'sources.json'),originalDetailsFile:base+'details.json',originalDetailsSha256:hash(base+'details.json'),groups,sources,mentions,noteDetails:notes,notes:notes.map(n=>({id:n.id,city:n.city,title:n.title,desc:n.desc})),catalog,reviews:[],images:frozen.images.filter(i=>all.includes(i.source_place_id)),imageComparison:'deferred_by_user',businessMutations:false};
const review={batch:67,city:'成都',state:'prepared_not_applied',sourceFile:'all-cities/batch-67-source.json',sourcesRead:6,sourcesGoverned:4,mentionsRead:12,fullNotes:5,scopeChanges:0,assignmentChanges:0,coordinatesToClear:4,preciseLocationsResolved:0,newEntities:0,merges:0,withdrawals:0,
  rows:targets.map(sid=>({sourceId:sid,entityId:groups.find(g=>g.sourceIds.includes(sid)).entity.entity_id,action:'clear_unsupported_shared_point',conclusion:reasons[sid]})),
  readOnly:[{sourceId:1868,conclusion:'洛带古镇3提及原正负体验保留。现行complex中memberNames含洛带古镇主街，但实际components为空，主街4178被聚合；母项与主街粒度仍待核。3836的240分钟来自半日整镇路线且含可选金龙长城，单点与组合边界未定，本批不改时长、不声明通过。'},
    {sourceId:1869,conclusion:'博客楼4提及保留3条正向体验及周一闭馆负向提醒；openHours目前unknown，原门牌三峨街999号99未经公共正文核实。既有分析将同篇部分土楼图片描述为福建，不凭分析摘要断定图片身份，也不查看图片。'}],
  searchEvidence:[{file:dir+'luodai-search-01.json',adopted:false,reason:'沙箱内60秒超时'}, {file:dir+'luodai-search-02.json',adopted:false,reason:'沙箱外同查询重试仍60秒超时'}, {file:dir+'luodai-search-03.json',adopted:false,reason:'ZHIPU_API_KEY未配置；不以未执行的搜索当核验'}],
  decisionBoundary:'四组原文与现有库字段足以否定把共同通用点当作已核实地点坐标，但未取得历史地理编码响应，不能确定原始错误产生过程。只修位置，不新增scope、不改变类别、名称、别名、原事实或评价；身份与事实后续继续核查。',
  imageComparison:'deferred_by_user',newImageViews:0,fullReviewPassed:false,userAcceptance:false};
const files=new Map([[reviewFile,review],['all-cities/batch-67-source.json',source],['all-cities/batch-67-catalog.json',catalog],['all-cities/batch-67-decisions.json',decisions],['all-cities/batch-67-export-expectations.json',decisions.map(d=>({city:'成都',id:d.entityId,name:d.canonicalName,revision:2,verified:true}))]]);
for(const p of files.keys())assert.ok(!fs.existsSync(url(p)),p+'不可覆盖');for(const [p,value]of files)fs.writeFileSync(url(p),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({batch:67,prepared:true,sources:6,mentions:12,notes:5,decisions:4,scopeChanges:0,sourceSha256:hash('all-cities/batch-67-source.json')}));
