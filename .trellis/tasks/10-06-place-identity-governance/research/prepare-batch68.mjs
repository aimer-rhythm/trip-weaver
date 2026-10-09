// 公园类别修正；文字范围修改在原简介与跨行意见可保全前不应用。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const url=p=>new URL(p,import.meta.url),read=p=>JSON.parse(fs.readFileSync(url(p),'utf8'));
const hash=p=>createHash('sha256').update(fs.readFileSync(url(p))).digest('hex');
const dir='priority-cities/成都/',base=dir+'run-1791504271958861000/';
const pointer=read('cleaning-scope/current.json'),frozen=read(base+'sources.json'),details=read(base+'details.json');
assert.equal(pointer.latestAppliedEntityBatch,67);assert.deepEqual(pointer.pendingVerification,[]);assert.equal(pointer.userAcceptance,false);
assert.equal(hash(base+'sources.json'),'bce267716acbb85759556b8ab51a868d1e32128a8556c66de0b69a39914ffd53');
assert.equal(hash(base+'details.json'),'33f3f291152269e24d58e421452a3ae3ec28f98ba9cc1c060e778d701d022a33');
const sourceIds=[1687,1847],groups=frozen.groups.filter(g=>g.sourceIds.some(id=>sourceIds.includes(id)));
const ids=groups.map(g=>g.entity.entity_id),mids=groups.flatMap(g=>g.mentionIds),mentions=details.mentions.filter(m=>mids.includes(m.id));
const notes=details.noteDetails.filter(n=>mentions.some(m=>m.raw_note_id===n.id)||[877,936].includes(n.id));
const sources=details.sources.filter(s=>sourceIds.includes(s.source.id));
assert.deepEqual([groups.length,sources.length,mentions.length,notes.length],[2,2,25,22]);assert.ok(groups.every(g=>g.entity.revision===1));
const catalog={entities:details.catalog.entities.filter(e=>ids.includes(e.entity_id)),members:details.catalog.members.filter(m=>sourceIds.includes(m.place_id)),reviews:details.catalog.reviews.filter(r=>(r.detail.entityIds??[]).some(id=>ids.includes(id)))};
assert.equal(catalog.reviews.length,0);
const park=groups.find(g=>g.entity.primary_place_id===1687),tea=groups.find(g=>g.entity.primary_place_id===1847);
const old=read('all-cities/batch-67/sync-01/xhs-places-成都.json').places;
assert.equal(old.find(p=>p.id===park.entity.entity_id).category,'文化');
assert.equal(old.find(p=>p.id===park.entity.entity_id).payload.content.method,'web_research_with_model_knowledge');
const reviewFile=dir+'renmin-heming-source-review-01.json';
const note=id=>notes.find(n=>n.id===id);
assert.ok(note(927).desc.includes('城市公共空间')&&note(927).desc.includes('人工湖白鹭景观'));
assert.ok(note(877).images[0].text_content.includes('可以不去\n鹤鸣茶社'));
const reasons={3499:'公园休闲、京剧及相亲角，博物馆的一小时不属公园。',3596:'独立公园路线站；既有分析补充茶社体验，不将公园等同茶社。',3623:'第一日路线明确公园，保持原体验。',3659:'红黑榜优先推荐的公园主体。',3707:'盖碗茶活动，不把茶社经营时间当公园开放时间。',3771:'120分钟紧接鹤鸣茶社采耳、成都博物馆的合游段；拟排除group_duration，原体验保留，尚未应用。',3831:'祠堂街人民公园为包含七站的citywalk标题，现reason横跨民国骑楼、公园和银杏长廊；不能据normalized_name认定同义名。拟待审及排除路线别名，尚未应用。',3881:'路线明确人民公园，与草堂等相邻不合并。',3900:'原文及分析同时有正面慢生活和纯打卡可能失望的意见；完整scope前需保全后者。',3957:'上午喝茶与避开正午高温的原建议有效。',3988:'路线明确公园，分析含公园茶社体验及流动采耳摊贩警示，意见不升级为医疗或安全结论。',4019:'人民公园段落明确园内鹤鸣茶楼体验，公园与茶楼独立。',4055:'note927公园专篇明确慢逛2小时，独立120分钟建议有效；不是旁边串联路线合计。',4058:'10:00–11:30标题指人民公园站，以茶社休闲为体验，90分钟为该站原计划，不再给茶社复制90分钟。',4107:'第三日明确公园路线站，原理由保留。',4150:'原文必冲列表及路线明确公园，9.0+是作者主观评分。',4161:'开篇想留2–3小时虽实际因茶社拥挤放弃，后文建议游玩仍明确2–3h；150分钟只能作为作者建议，不能称实际完成时长。茶社08:30–18:00不归公园。',4198:'公园傍晚夜景体验，不由此推导全天开放。',4206:'两条路线均明确公园，既有分析含茶社难求座与嘈杂限定。',3564:'下午公园鹤鸣喝茶嗑瓜子；茶社身份明确。',3772:'茶社采耳体验，不继承同段含博物馆的合计时长。',4059:'原路线公园站内茶社体验，缺独立茶社时长。',4162:'周末无位、吵热、10点前到是有效负面体验及建议，保持。',4199:'夜景灯光正面评价保持，不据其判断当前夜间营业。',4200:'餐食普通且不推荐正餐的负面评价保持。'};
assert.deepEqual(Object.keys(reasons).map(Number).sort((a,b)=>a-b),mids.toSorted((a,b)=>a-b));
const decisions=[{key:'all-cities-20261009-batch-68-renmin-park-category',city:'成都',entityId:park.entity.entity_id,expectedRevisions:{[park.entity.entity_id]:1},mergeEntityIds:[],canonicalName:'人民公园',aliases:park.entity.aliases,overrides:{category:'自然'},evidence:[{kind:'reviewed_original_public_park_identity',file:reviewFile,noteId:927,quote:note(927).desc,conclusion:'城市公共园林，以湖面、园林绿植和市民休闲为主体，粗类修正自然；历史纪念碑和茶社是园内组成，不使整园成为单栋文化建筑或餐饮店。保留attraction，原名、别名、位置、简介及全部意见保持。'}]}];
const source={readOnly:true,capturedAt:new Date().toISOString(),city:'成都',entityBatch:67,originalSourceFile:base+'sources.json',originalSourceSha256:hash(base+'sources.json'),originalDetailsFile:base+'details.json',originalDetailsSha256:hash(base+'details.json'),groups,sources,mentions,noteDetails:notes,notes:notes.map(n=>({id:n.id,city:n.city,title:n.title,desc:n.desc})),catalog,reviews:[],images:frozen.images.filter(i=>sourceIds.includes(i.source_place_id)),imageComparison:'deferred_by_user',businessMutations:false};
const holds=[{entityId:park.entity.entity_id,name:'人民公园',sourceId:1687,status:'unapplied_scope_preserve_web_profile_and_original_opinions',mentionIds:[3771,3831],reason:'完整scope会使现有网页引文简介失效；需要保全有效网页来源与原分析中正负评价后，才应用组合时长排除、路线提及待审、别名边界及混合tips清洗。当前120分钟聚合值保持，不代表全部样本已正确。'},
 {entityId:tea.entity.entity_id,name:'鹤鸣茶社',sourceId:1847,status:'unapplied_scope_preserve_multiline_original_warning',noteId:877,imageIndex:0,quote:'可以不去\n鹤鸣茶社',reason:'旧tips中的可不去有既有分析逐字依据，但评价与名称分处两行。现textWarnings仅允许完整单行；不拼写新句、不借其他笔记同类批评替换该作者意见、不让该意见退出消费。'}];
const review={batch:68,city:'成都',state:'prepared_not_applied',sourceFile:'all-cities/batch-68-source.json',sourcesRead:2,sourcesGoverned:1,mentionsRead:25,fullNotes:20,supplementalFullNotes:2,scopeChanges:0,assignmentChanges:0,categoryChanges:1,coordinatesToClear:0,preciseLocationsResolved:0,newEntities:0,merges:0,withdrawals:0,rows:mentions.map(m=>({mentionId:m.id,noteId:m.raw_note_id,conclusion:reasons[m.id],scopeActionApplied:false})),unappliedFindings:holds,
  hoursReview:{park:'现有06:30–22:00与全天开放来源相冲突，尚未核实当前园方时段；先保持原消费。',tea:'note929有08:30–18:00社区说法，现行unknown保持；不能借夜景评价证明当前夜间开放。'},
  supplementalOpinions:[{noteId:877,imageIndex:0,quote:'可以不去\n鹤鸣茶社',status:'original_multiline_warning_must_preserve'},{noteId:936,imageIndex:0,quote:'✅ 人民公园 NPC 别去鹤鸣茶社人挤人',status:'distinct_author_opinion_not_replacement_for_note877'}],
  publicEvidenceRevalidated:false,originalSourcesRetained:true,originalOpinionsRetained:true,imageComparison:'deferred_by_user',newImageViews:0,fullReviewPassed:false,userAcceptance:false};
const files=new Map([[reviewFile,review],['all-cities/batch-68-source.json',source],['all-cities/batch-68-catalog.json',catalog],['all-cities/batch-68-decisions.json',decisions],['all-cities/batch-68-export-expectations.json',decisions.map(d=>({city:'成都',id:d.entityId,name:d.canonicalName,revision:2,verified:true}))]]);
for(const p of files.keys())assert.ok(!fs.existsSync(url(p)),p+'不可覆盖');for(const [p,v]of files)fs.writeFileSync(url(p),JSON.stringify(v,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({batch:68,prepared:true,applied:false,sources:2,mentions:25,fullNotes:22,decisions:1,scopeChanges:0,sourceSha256:hash('all-cities/batch-68-source.json')}));
