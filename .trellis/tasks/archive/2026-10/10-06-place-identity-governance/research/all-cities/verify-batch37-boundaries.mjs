// 正式实库只读核验：分类升版保留原scope、事实排除和泉体/邻近设施边界。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {Client} from 'pg';
import {parse} from 'dotenv';
import {createPlaceIdentityIndex} from '../../../../../apps/server/src/lib/placeIdentity.ts';
import {validateRelationManifest,validateBoundRelations} from '../../../../../apps/server/src/services/placeRelationIdentity.ts';
const url=f=>new URL(f,import.meta.url),read=f=>JSON.parse(fs.readFileSync(url(f),'utf8'));
const folder='batch-37/sync-01/';
const expectations=read('batch-37-export-expectations.json');
const oldScopes=read('batch-36-scope-decisions.json');
const before=read(folder+'preview-济南/library-before.json');
const published=read(folder+'xhs-places-济南.json');
const client=new Client({connectionString:parse(fs.readFileSync('apps/server/.env')).DATABASE_URL,connectionTimeoutMillis:10000});
const upSettings=parse(fs.readFileSync('D:/Project/xhs-travel-pipeline/.env'));
const upstream=new Client({connectionString:upSettings.DATABASE_URL.replace('postgresql+asyncpg:','postgresql:'),connectionTimeoutMillis:10000});
const report={readOnly:true,batch:'batch-37',checked:[],failures:[]};
try {
  await client.connect();await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await upstream.connect();await upstream.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const assignments=(await upstream.query('SELECT mention_id,scope_place_id,entity_id,input_hash,revision,change_key,fact_exclusions FROM place_mention_assignment WHERE mention_id=ANY($1::int[]) ORDER BY mention_id',[oldScopes.flatMap(s=>s.assignments.map(a=>a.mentionId))])).rows.map(row=>{
    assert.ok(Number.isSafeInteger(Number(row.mention_id))&&Number.isSafeInteger(Number(row.scope_place_id)));
    return {...row,mention_id:Number(row.mention_id),scope_place_id:Number(row.scope_place_id)};
  });
  assert.equal(assignments.length,11);
  for(const scope of oldScopes) for(const expected of scope.assignments) {
    const actual=assignments.find(a=>a.mention_id===expected.mentionId);assert.ok(actual);
    assert.equal(actual.scope_place_id,scope.sourcePlaceId);assert.equal(actual.entity_id,expected.entityId);
    assert.equal(actual.input_hash,expected.inputHash);assert.equal(actual.change_key,scope.key);assert.equal(actual.revision,1);
    assert.deepEqual(actual.fact_exclusions,expected.factExclusions??null);
  }
  assert.equal(assignments.filter(a=>a.fact_exclusions).length,4);
  const rows=(await client.query('SELECT id,city,name,category,lat,lng,verified,payload FROM canonical_places WHERE city=$1',['济南'])).rows;
  const index=createPlaceIdentityIndex(rows);
  const negative={
    '王府池子':['王府池子街','小王府池子','王府池子四号院','濯缨池'],
    '腾蛟泉':['腾蛟泉旁餐馆','王府池子'],
    '起凤泉':['起凤桥','起凤桥八号'],
    '刘氏泉':['刘氏泉簪花摄影店','曲水亭街'],
    '玛瑙泉':['银匠世家泉城老店','黑虎泉','解放阁'],
  };
  for(const e of expectations) {
    const now=rows.find(r=>r.id===e.id),old=before.tables.canonical_places.find(r=>r.id===e.id);assert.ok(now&&old);
    assert.equal(now.verified,true);assert.equal(now.category,'自然');assert.equal(old.category,'文化');
    assert.equal(now.payload.identity.revision,e.revision);
    assert.deepEqual(now.payload.identity.memberIds,old.payload.identity.memberIds);
    assert.deepEqual(now.payload.aliases,old.payload.aliases);
    assert.equal(now.lat,old.lat);assert.equal(now.lng,old.lng);
    assert.equal(now.payload.typicalVisitMinutes,undefined);
    assert.equal(now.payload.identityWithdrawal,undefined);assert.equal(now.payload.canonicalRedirectTo,undefined);
    assert.equal(now.payload.content.intro,old.payload.content.intro);
    assert.deepEqual(now.payload.content,published.places.find(p=>p.id===e.id).payload.content);
    // 受控来源以本次导出时间生成observedAt；原文/引用/强度必须完整保留。
    const contentEvidence=items=>items.map(({observedAt,...rest})=>rest);
    assert.deepEqual(contentEvidence(now.payload.content.highlights),contentEvidence(old.payload.content.highlights));
    assert.equal(now.payload.mentionCount,old.payload.mentionCount);
    assert.ok(!JSON.stringify(now.payload).includes('簪花少女'));
    for(const field of ['coverImage','amapPhoto','imageGallery']) assert.ok(now.payload[field]==null||Array.isArray(now.payload[field])&&now.payload[field].length===0);
    if(e.mentionIds) {
      assert.deepEqual(now.payload.mentionSources,old.payload.mentionSources);
      assert.deepEqual(now.payload.mentionSources.map(m=>m.mentionId).sort((a,b)=>a-b),e.mentionIds);
      assert.equal(now.payload.imageIdentity.revision,e.revision);assert.deepEqual(now.payload.imageIdentity.approved,[]);
    } else {assert.equal(now.payload.mentionSources,undefined);assert.equal(now.payload.imageIdentity,undefined);}
    for(const name of negative[e.name]) {
      const resolved=index.resolve('济南',name);assert.ok(resolved.status!=='resolved'||resolved.canonicalPlaceId!==e.id,name);
    }
    report.checked.push({id:e.id,name:e.name,category:now.category,revision:e.revision,mentions:now.payload.mentionCount,
      originalPositionPreserved:true,originalDescriptionPreserved:true,negativeNames:negative[e.name]});
  }
  const snapshot=(await client.query('SELECT manifest,relations FROM place_relation_snapshots WHERE city=$1',['济南'])).rows[0];
  const manifest=validateRelationManifest(snapshot.manifest,'济南'),graph=validateBoundRelations(snapshot.relations,manifest);
  assert.equal(manifest.revision,11);assert.equal(graph.length,20);assert.equal(graph.filter(e=>e.strength==='direct').length,9);
  const oldManifest=validateRelationManifest(before.tables.place_relation_snapshots[0].manifest,'济南');
  const pending=oldManifest.sourceState.mentions.filter(m=>m.status==='review');assert.equal(pending.length,60);
  for(const m of pending)assert.deepEqual(manifest.sourceState.mentions.find(x=>x.mentionId===m.mentionId),m);
  const sourceReview=read('../priority-cities/济南/spring-upstream-check-01.json');
  for(const g of sourceReview.groups) for(const id of g.mentionIds.filter(id=>id!==12692)) {
    const actual=manifest.sourceState.mentions.find(m=>m.mentionId===id);assert.ok(actual);
    assert.equal(actual.status,'resolved');assert.equal(actual.entityId,g.entity.entity_id);
    assert.equal(actual.revision,expectations.find(e=>e.id===g.entity.entity_id).revision);
  }
  const media=read('../priority-cities/济南/spring-photo-sources-03.json');
  assert.equal(media.inputDigest,read('../priority-cities/济南/spring-photo-sources-02.json').inputDigest);
  assert.equal(media.sourceImages,123);assert.equal(media.reviewedCatalogs,12);assert.deepEqual(media.warnings,[]);
  assert.ok(media.entities.every(e=>e.independentSources.length===0&&e.assignments.length===0));
  const trips=(await client.query("SELECT count(*)::int count,md5(COALESCE(string_agg(h,'' ORDER BY h),'')) digest FROM (SELECT md5(to_jsonb(t)::text) h FROM trips t) x")).rows[0];
  assert.deepEqual(trips,read(folder+'pre-import-check.json').trips);assert.equal(trips.count,201);
  Object.assign(report,{priorAssignmentsPreserved:11,priorFactExclusionsPreserved:4,pendingMentionsPreserved:60,
    managedMentions:10,ordinaryMentions:1,relationSnapshotRevision:11,relations:20,strongRelations:9,
    independentPhotoCatalogs:12,independentPhotoSources:123,trips});
  fs.writeFileSync(url(folder+'boundary-check.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(report));
} finally {await client.query('ROLLBACK').catch(()=>{});await client.end();await upstream.query('ROLLBACK').catch(()=>{});await upstream.end();}
