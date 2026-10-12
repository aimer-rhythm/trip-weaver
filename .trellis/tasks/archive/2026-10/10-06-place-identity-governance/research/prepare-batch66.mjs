// 基于已读取全文及实际图库预检生成成都园内分区决定；不应用业务变更。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const url=p=>new URL(p,import.meta.url),read=p=>JSON.parse(fs.readFileSync(url(p),'utf8'));
const sha=p=>createHash('sha256').update(fs.readFileSync(url(p))).digest('hex');
const dir='priority-cities/成都/',folder=dir+'run-1791504271958861000/';
const frozen=read(folder+'sources.json'),details=read(folder+'details.json'),pointer=read('cleaning-scope/current.json');
assert.equal(pointer.latestAppliedEntityBatch,65);assert.equal(pointer.userAcceptance,false);
assert.equal(sha(folder+'sources.json'),'bce267716acbb85759556b8ab51a868d1e32128a8556c66de0b69a39914ffd53');
assert.equal(sha(folder+'details.json'),'33f3f291152269e24d58e421452a3ae3ec28f98ba9cc1c060e778d701d022a33');
const pre=read(dir+'park-zones-photo-preflight-01.json'),photo=read(dir+'park-zones-photo-metadata-01.json');
assert.ok(pre.existingPhotoConsumptionPreserved);assert.equal(pre.mockEnqueues,3);assert.deepEqual(pre.failures,[]);
assert.ok(photo.entities.every(e=>!e.independentSources.length&&!e.assignments.length));
const referenceFile=dir+'park-zones-reference-02.json',page=read(referenceFile);assert.ok(page.ok);
assert.ok(page.content.includes('黄龙溪欢乐田园（双流区农博路1号）')&&page.content.includes('长颈鹿'));
const sourceIds=[1998,2011,2013],groups=frozen.groups.filter(g=>g.sourceIds.some(id=>sourceIds.includes(id)));
const entityIds=groups.map(g=>g.entity.entity_id),mentionIds=groups.flatMap(g=>g.mentionIds);
const mentions=details.mentions.filter(m=>mentionIds.includes(m.id)),notes=details.noteDetails.filter(n=>mentions.some(m=>m.raw_note_id===n.id));
assert.deepEqual([...mentionIds].sort((a,b)=>a-b),[4121,4139,4141]);assert.equal(notes.length,2);
const note=notes.find(n=>n.id===1013);assert.ok(note.desc.includes('上午天气没有那么热可以先逛萌宠🦒片区')&&note.desc.includes('龙溪谷大型野趣戏水区')&&note.desc.includes('#黄龙溪欢乐田园[话题]#'));
const sources=details.sources.filter(s=>sourceIds.includes(s.source.id));assert.equal(sources.length,3);
const history=details.catalog.entities.filter(e=>entityIds.includes(e.entity_id));assert.equal(history.length,3);
const catalog={entities:history,members:details.catalog.members.filter(m=>sourceIds.includes(m.place_id)),reviews:details.catalog.reviews.filter(r=>(r.detail.entityIds??[]).some(id=>entityIds.includes(id)))};
assert.equal(catalog.reviews.length,0);assert.ok(groups.every(g=>g.entity.revision===1));
assert.ok(frozen.images.every(i=>!sourceIds.includes(i.source_place_id)));
const reviewFile=dir+'park-zones-source-review-01.json',scopes=[],decisions=[];
const names={2011:'萌宠片区（黄龙溪欢乐田园）',2013:'龙溪谷大型野趣戏水区（黄龙溪欢乐田园）'};
for(const sid of [2011,2013]) {
  const g=groups.find(g=>g.sourceIds.includes(sid)),raw=sources.find(s=>s.source.id===sid),eid=g.entity.entity_id;
  assert.equal(g.mentionIds.length,1);const m=mentions.find(m=>m.id===g.mentionIds[0]);assert.equal(m.raw_note_id,1013);
  assert.equal(m.fact_type,null);assert.equal(m.fact_value,null);
  const evidence=[{kind:'full_original_park_context',file:reviewFile,noteId:1013,mentionIds:g.mentionIds,
    quote:note.desc,conclusion:'同篇黄龙溪游记明示园内萌宠与龙溪谷戏水活动，标签具名黄龙溪欢乐田园；保留原作者体验，不将新都商户或都江堰龙溪点位认作该园区分区。'},
    {kind:'fetched_public_park_address_and_animal_context',file:referenceFile,sha256:sha(referenceFile),url:page.url,
      quote:'地址：黄龙溪欢乐田园（双流区农博路1号）',conclusion:'2022公开游记补证园区地址与长颈鹿等萌宠活动；不凭此将泛称萌宠片区直接改成鹿溪牧场，不用于精确坐标、营业、票价或开放状态。'}];
  scopes.push({key:`all-cities-20261009-batch-66-source-${sid}-scope`,city:'成都',sourcePlaceId:sid,expectedSourceHash:raw.sourceHash,expectedScopeRevision:0,
    expectedRevisions:{[eid]:1},assignments:[{mentionId:m.id,inputHash:m.inputHash,entityId:eid}],evidence});
  decisions.push({key:`all-cities-20261009-batch-66-zone-${sid}`,city:'成都',entityId:eid,expectedRevisions:{[eid]:2},mergeEntityIds:[],
    canonicalName:names[sid],aliases:sid===2011?[names[sid]]:[names[sid],g.entity.canonical_name],
    ...(sid===2011?{excludeNames:['萌宠片区']}:{}),
    overrides:{lat:null,lng:null,adcode:'',geoStatus:'unresolvable',address:'黄龙溪欢乐田园内',category:'文化'},evidence});
}
const source={readOnly:true,capturedAt:new Date().toISOString(),city:'成都',entityBatch:65,
  originalSourceFile:folder+'sources.json',originalSourceSha256:sha(folder+'sources.json'),
  originalDetailsFile:folder+'details.json',originalDetailsSha256:sha(folder+'details.json'),groups,sources,mentions,noteDetails:notes,
  notes:notes.map(n=>({id:n.id,city:n.city,title:n.title,desc:n.desc})),catalog,reviews:catalog.reviews,images:[],imageComparison:'deferred_by_user',businessMutations:false};
const review={batch:66,city:'成都',state:'prepared_not_applied',sourceFile:'all-cities/batch-66-source.json',sourcesRead:3,sourcesGoverned:2,mentionsRead:3,fullNotes:2,
  confirmed:2,pendingAdded:0,newEntities:0,merges:0,withdrawals:0,coordinatesToClear:2,preciseLocationsResolved:0,
  rows:[{mentionId:4139,noteId:1013,sourceId:2011,action:'confirm_park_scoped_zone',conclusion:'黄龙溪欢乐田园内萌宠片区；园区限定展示名，不宣称官方分区名。新都区萌宠商户地址/坐标/adcode不支持原文，清除；不借用园区点或直接改名鹿溪牧场。'},
    {mentionId:4141,noteId:1013,sourceId:2013,action:'confirm_park_scoped_zone',conclusion:'黄龙溪欢乐田园内龙溪谷大型野趣戏水区；清除都江堰龙溪的旧地址/点/adcode。原特定长名称可保留别名，不把短名龙溪或龙溪谷认作别名。'},
    {mentionId:4121,noteId:910,sourceId:1998,action:'read_only_parent',conclusion:'园区主体及其教师节原文只读保留，9.10–9.20的有条件免票不代表当前普遍免票；本批不验证旧票价/营业时间。'}],
  publicEvidence:[{file:referenceFile,sha256:sha(referenceFile),url:page.url,kind:'historical_user_travelogue',published:'2022-05-06',adopted:'园区双流区农博路1号及萌宠互动背景',limits:'非官方当前运营公告，不证明精确机位；不把鹿溪牧场直接认作现有萌宠片区的严格同义名。'}],
  unusedEvidence:[{file:dir+'park-zones-search-01.json',reason:'60秒超时，终态保留；沙箱外重试search02成功'},
    {file:dir+'park-zones-reference-01.json',reason:'去哪儿提取失败，摘要中的龙溪谷介绍不作为正文证据'},
    {file:dir+'park-zones-reference-03.json',reason:'本地宝提取失败，摘要不作为正文证据'}],
  originalOpinionsPolicy:'动物互动与戏水体验字面值保留；水浅安全是原作者意见，不能升级为安全保证。',
  durationPolicy:'太阳鸟剧场约半小时只归剧场，两个目标原无独立分钟数，继续未知。',
  categoryPolicy:'本批保持文化/attraction兼容值，园内分区类别与完整媒体验收另核，不将保持类别说成已核实。',
  dateRefreshBoundary:'成都旧库245主体314看点仍用旧导出时刻；当前生产导出已按原来源日期修复。须独立验证日期变化及全部非日期内容不变，再同步本批。',
  imageComparison:'deferred_by_user',newImageViews:0,fullReviewPassed:false,userAcceptance:false};
const expectations=decisions.map(d=>({city:'成都',id:d.entityId,name:d.canonicalName,revision:3,verified:true,mentionIds:scopes.find(s=>s.expectedRevisions[d.entityId]).assignments.map(a=>a.mentionId)}));
const files=new Map([[reviewFile,review],['all-cities/batch-66-source.json',source],['all-cities/batch-66-catalog.json',catalog],['all-cities/batch-66-scope-decisions.json',scopes],['all-cities/batch-66-decisions.json',decisions],['all-cities/batch-66-export-expectations.json',expectations]]);
for(const p of files.keys())assert.ok(!fs.existsSync(url(p)),p+'禁止覆盖');
for(const [p,v]of files)fs.writeFileSync(url(p),JSON.stringify(v,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({batch:66,prepared:true,applied:false,scopes:2,confirmed:2,pending:0,sourceSha256:sha('all-cities/batch-66-source.json')}));
