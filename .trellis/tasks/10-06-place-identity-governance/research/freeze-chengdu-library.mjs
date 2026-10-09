// 成都固定重点范围的实库消费基线与初始台账；不导入、不迁移、不改任务完成状态。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Client} from 'pg';
import {parse} from 'dotenv';
const url=p=>new URL(p,import.meta.url),read=p=>JSON.parse(fs.readFileSync(url(p),'utf8'));
const dir='priority-cities/成都/',folder=dir+'run-1791504271958861000/';
const source=read(folder+'sources.json'),pointer=read('cleaning-scope/current.json');
assert.equal(pointer.latestAppliedEntityBatch,65);assert.equal(pointer.imageComparisonPolicy.status,'deferred_by_user');
const scope=read('cleaning-scope/'+pointer.scopeFile),primary=scope.selected.filter(r=>r.place.city==='成都'),dependencies=scope.dependencies.filter(r=>r.city==='成都');
assert.equal(primary.length,113);assert.equal(dependencies.length,3);
const targets=[folder+'library-before.json',folder+'library-manifest.json',dir+'review-01.json',dir+'review-01.md'];
for(const p of targets)assert.ok(!fs.existsSync(url(p)),p+'不能覆盖');
const db=new Client({connectionString:parse(fs.readFileSync('apps/server/.env')).DATABASE_URL,connectionTimeoutMillis:10000});
const tables={};let trips;
try {
  await db.connect();await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await db.query("SET LOCAL statement_timeout='30s'");
  for(const name of ['canonical_places','research_evidence','place_relation','data_import','independent_photo_assignments','place_relation_snapshots'])
    tables[name]=(await db.query(`SELECT to_jsonb(t) value FROM ${name} t WHERE city=$1 ORDER BY to_jsonb(t)::text`,['成都'])).rows.map(r=>r.value);
  trips=(await db.query("SELECT count(*)::int count,md5(COALESCE(string_agg(h,'' ORDER BY h),'')) digest FROM (SELECT md5(to_jsonb(t)::text) h FROM trips t) x")).rows[0];
} finally {await db.query('ROLLBACK').catch(()=>{});await db.end();}
const createdAt=new Date().toISOString(),rows=primary.map(({place,reasons})=>{
  const g=source.groups.find(g=>g.entity.entity_id===place.id),actual=tables.canonical_places.find(p=>p.id===place.id);
  assert.ok(g&&actual);assert.equal(actual.payload.identity.entityId,place.id);assert.equal(actual.payload.identity.revision,g.entity.revision);assert.equal(g.entity.revision,place.revision);
  const mentions=source.mentions.filter(m=>g.mentionIds.includes(m.id));
  const reviews=source.reviews.filter(r=>(r.detail.entityIds??[]).includes(place.id));
  return {entityId:place.id,name:place.name,currentName:actual.name,baselineRevision:place.revision,currentRevision:g.entity.revision,
    sourceIds:g.sourceIds,relatedSourceIds:g.relatedSourceIds,mentionIds:g.mentionIds,noteIds:[...new Set(mentions.map(m=>m.raw_note_id))],selectionReasons:reasons,
    status:'pending',dimensions:{identity:'pending',category:'pending',location:'current_point_not_newly_verified',media:'deferred_by_user',consumedFacts:'pending'},
    currentCategory:actual.category,currentPlaceType:actual.payload.xhsPlaceType??null,currentLat:actual.lat,currentLng:actual.lng,
    upstreamImageCount:source.images.filter(i=>g.sourceIds.includes(i.source_place_id)).length,
    previousReviewIds:reviews.map(r=>r.id),previousReviewVerdicts:reviews.map(r=>({id:r.id,status:r.status,verdict:r.detail.assessment?.verdict??null})),
    followup:reviews.some(r=>r.status==='PENDING')?'原实体对仍待审，须逐全文核对主体边界；历史审核不是完整验收。':'按固定范围核对完整原文、类别、位置、消费事实及历史引用；图片暂缓。'};
});
const dependencyRows=dependencies.map(d=>({ ...d,group:source.groups.find(g=>g.entity.entity_id===d.id)}));
assert.ok(dependencyRows.every(d=>d.group));
const library=JSON.stringify({readOnly:true,city:'成都',capturedAt:createdAt,tables,trips})+'\n';
const manifest={file:'library-before.json',sha256:createHash('sha256').update(library).digest('hex'),readOnly:true,entityBatch:65,
  counts:Object.fromEntries(Object.entries(tables).map(([k,v])=>[k,v.length])),trips,relationRevision:tables.place_relation_snapshots[0].manifest.revision,
  graph:tables.place_relation_snapshots[0].relations.length,direct:tables.place_relation_snapshots[0].relations.filter(r=>r.strength==='direct').length};
const ledger={city:'成都',createdAt,sourceFile:folder+'sources.json',sourceSha256:'bce267716acbb85759556b8ab51a868d1e32128a8556c66de0b69a39914ffd53',
  scopeFile:pointer.scopeFile,scopeSha256:pointer.scopeSha256,libraryFile:folder+'library-before.json',librarySha256:manifest.sha256,
  basis:'保留113个原入选主体和3个必要依赖，历史已修版本不等于完整核查；本台账不表示验收。',
  summary:{primary:113,dependencies:3,fullyReviewed:0,remainingPrimaryToReview:113,partiallyReviewedScopeRows:0,imageComparisonPolicy:'deferred_by_user'},rows,dependencyRows,userAcceptance:false};
const markdown='# 成都113项重点清单核查台账\n\n保留scope06原入选集合，3项依赖另列；本次只建立现行消费与历史审核基线，不把旧合并或检索通过当作整项验收。\n\n| 原名称 | 当前名称 | 版本 | 来源 | 提及 | 进度 |\n| --- | --- | ---: | --- | ---: | --- |\n'+rows.map(r=>`| ${r.name} | ${r.currentName} | ${r.currentRevision} | ${r.sourceIds.join(',')} | ${r.mentionIds.length} | ${r.status} |`).join('\n')+'\n\n依赖：'+dependencies.map(d=>d.name).join('、')+'。\n';
for(const [p,v]of [[targets[0],library],[targets[1],JSON.stringify(manifest,null,2)+'\n'],[targets[2],JSON.stringify(ledger,null,2)+'\n'],[targets[3],markdown]])fs.writeFileSync(url(p),v,{flag:'wx'});
console.log(JSON.stringify({ledger:'review-01',primary:113,dependencies:3,fullyReviewed:0,...manifest}));
