// 第47批实库只读：街道与市场、原始审核、待审增量与其他主体保全。
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Client} from 'pg';
import {parse} from 'dotenv';
import {placeNameKey} from '@tripweaver/shared';
import {createPlaceIdentityIndex} from '../../../../apps/server/src/lib/placeIdentity';
import {createPlaceRetriever} from '../../../../apps/server/src/generation/placeRetrieval';
import type {PlaceRow} from '../../../../apps/server/src/generation/retrievalRanking';
const read=async(p:string)=>JSON.parse(await readFile(new URL(p,import.meta.url),'utf8'));
const folder='all-cities/batch-47/sync-01/',city='济南';
const output=new URL('priority-cities/济南/minzu-downstream-check-01.json',import.meta.url);
await readFile(output).then(()=>{throw new Error('证据不能覆盖');},(e:NodeJS.ErrnoException)=>{if(e.code!=='ENOENT')throw e;});
const sync=(await read(folder+'sync-state.json')).cities[city];assert.ok(sync.importedAt&&sync.relationsImportedAt&&sync.embeddingRunAt);
const bytes=await readFile(new URL(folder+'xhs-places-济南.json',import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),sync.exportHash);
const exported=JSON.parse(bytes.toString('utf8')).places as PlaceRow[];
const library=await read(folder+'preview-济南/library-before.json'),source=await read('all-cities/batch-47-source.json');
const scopes=(await Promise.all([36,40,41,42,43,44,45,46,47].map(n=>read(`all-cities/batch-${n}-scope-decisions.json`)))).flat();
const vectors=await read(folder+'verification-vectors.json');assert.deepEqual(vectors.failures,[]);
assert.equal(vectors.cities[0].probes.length,1);assert.equal(vectors.cities[0].vectorProbes.length,2);
assert.ok(vectors.cities[0].vectorProbes.every((p:any)=>p.diagnostics.vector==='used'));
const config=parse(await readFile('apps/server/.env')),upConfig=parse(await readFile('D:/Project/xhs-travel-pipeline/.env'));
const db=new Client({connectionString:config.DATABASE_URL,connectionTimeoutMillis:10000});
const up=new Client({connectionString:upConfig.DATABASE_URL!.replace('postgresql+asyncpg:','postgresql:'),connectionTimeoutMillis:10000});
try {
  await db.connect();await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await up.connect();await up.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const rows=(await db.query<PlaceRow>('SELECT id,city,name,category,lat,lng,verified,source,payload FROM canonical_places WHERE city=$1',[city])).rows;
  const byId=new Map(rows.map(p=>[p.id,p]));
  const fields=['identity','aliases','xhsPlaceType','content','topReasons','openHours','reservation','reservationNote','reservationEvidence','reservationConflict','typicalVisitMinutes','mentionSources','themes','address','geoStatus'];
  for(const expected of exported) {
    const actual=byId.get(expected.id);assert.ok(actual);
    for(const k of ['name','category','lat','lng','verified'] as const)assert.equal(actual[k],expected[k]);
    for(const k of fields) {
      let value=expected.payload?.[k]??null;
      if(k==='identity'&&value) {
        const identity=value as {memberNames:string[]};value={...identity,nameKeys:[...new Set([...identity.memberNames,...(expected.payload?.aliases as string[]??[])].map(placeNameKey))]};
      }
      assert.deepEqual(actual.payload?.[k]??null,value,`${actual.name}/${k}`);
    }
  }
  const index=createPlaceIdentityIndex(rows.filter(p=>p.verified||p.payload?.identityWithdrawal));
  const retrieve=createPlaceRetriever({query:(sql,args)=>db.query(sql,args),embed:async()=>{throw new Error('本探针只允许SQL检索');}});
  const targets=source.groups.map((g:any)=>g.entity.entity_id);const results=[];let sqlProbes=0;
  for(const g of source.groups) {
    const eid=g.entity.entity_id,p=byId.get(eid),old=library.tables.canonical_places.find((r:PlaceRow)=>r.id===eid);assert.ok(p&&old);
    const road=p.name==='民族大街';
    assert.equal((p.payload?.identity as any).revision,road?3:2);assert.equal(p.category,road?'文化':'购物');assert.equal(p.payload?.xhsPlaceType,road?'other':'market');
    assert.equal(p.verified,true);assert.equal(p.lat,old.lat);assert.equal(p.lng,old.lng);assert.equal(p.payload?.address,old.payload.address);
    assert.deepEqual(p.payload?.aliases,old.payload.aliases);
    assert.deepEqual((p.payload?.mentionSources as any[]).map(m=>m.mentionId).sort((a,b)=>a-b),road?[11501,12754]:[12643]);
    assert.equal(p.payload?.mentionCount,road?2:1);assert.equal(p.payload?.typicalVisitMinutes,undefined);
    assert.deepEqual(p.payload?.themes,[]);assert.deepEqual((p.payload?.imageIdentity as any).approved,[]);
    assert.doesNotMatch(JSON.stringify(p.payload),/C区|稍远|住宿选择/);
    const evidence=(await db.query('SELECT kind,content FROM research_evidence WHERE place_id=$1 AND kind LIKE $2',[eid,'xhs_%'])).rows;
    assert.equal(evidence.length,1);assert.ok(evidence.every(e=>e.kind==='xhs_reason'));
    if(road) {
      assert.equal(old.payload.xhsPlaceType,'food');assert.equal(old.category,'美食');assert.equal(old.payload.mentionCount,3);
      const prior=library.tables.research_evidence.filter((r:any)=>r.place_id===eid&&r.kind==='xhs_warning');
      assert.ok(prior.some((r:any)=>r.content.includes('C区')));
      assert.equal(evidence[0].content,'早餐人均20元，性价比高');assert.deepEqual(p.payload?.topReasons,[]);assert.equal((p.payload?.content as any).intro,'');
    } else assert.match(JSON.stringify(p.payload?.content),/烤鸡腿/);
    const boundaries=road?['民族大街市场','民族大街早餐店','民族大街C区']:['民族大街','民族大街早餐店','民族大街市场烤鸡腿店'];
    const hits=await retrieve([p.name],{city,vector:'off',limit:24});assert.equal(hits[0]?.canonicalPlaceId,eid);sqlProbes++;
    for(const id of [undefined,...g.entity.legacy_ids]) {
      const r=index.resolve(city,p.name,id);assert.equal(r.status,'resolved');if(r.status==='resolved')assert.equal(r.canonicalPlaceId,eid);
      for(const wrong of boundaries){const r=index.resolve(city,wrong,id);assert.ok(r.status!=='resolved'||r.canonicalPlaceId!==eid);}
    }
    results.push({entityId:eid,name:p.name,revision:(p.payload?.identity as any).revision,category:p.category,type:p.payload?.xhsPlaceType,boundaries});
  }
  for(const original of library.tables.canonical_places)if(!targets.includes(original.id)) {
    const current=byId.get(original.id);assert.ok(current);
    for(const field of ['identity','aliases','mentionSources','topReasons','typicalVisitMinutes','xhsPlaceType'])assert.deepEqual(current.payload?.[field],original.payload?.[field]);
  }
  for(const g of source.sources)assert.deepEqual((await up.query('SELECT typical_visit_minutes,typical_visit_source,theme_tags,content_profile FROM canonical_place WHERE id=$1',[g.source.id])).rows[0],g.derivedBefore);
  const history=await read('all-cities/batch-47-catalog.json');
  assert.deepEqual((await up.query('SELECT id::int id,city,fingerprint,status,detail FROM place_entity_review WHERE id=369')).rows,history.reviews);
  const assignments=(await up.query('SELECT mention_id,entity_id,input_hash,revision,change_key,fact_exclusions FROM place_mention_assignment WHERE mention_id=ANY($1::int[])',
    [scopes.flatMap((s:any)=>s.assignments.map((a:any)=>a.mentionId))])).rows;assert.equal(assignments.length,258);
  for(const s of scopes)for(const a of s.assignments) {
    const actual=assignments.find(r=>Number(r.mention_id)===a.mentionId);assert.ok(actual);
    assert.equal(actual.entity_id,a.entityId);assert.equal(actual.input_hash,a.inputHash);assert.equal(actual.revision,1);
    assert.equal(actual.change_key,s.key);assert.deepEqual(actual.fact_exclusions,a.factExclusions??null);
  }
  const graph=(await db.query('SELECT manifest,relations FROM place_relation_snapshots WHERE city=$1',[city])).rows[0];
  assert.equal(graph.manifest.revision,21);assert.deepEqual(graph.relations,library.tables.place_relation_snapshots[0].relations);
  const pending=graph.manifest.sourceState.mentions.filter((m:any)=>m.status==='review');assert.equal(pending.length,109);
  assert.deepEqual(pending.filter((m:any)=>m.mentionId!==11608),library.tables.place_relation_snapshots[0].manifest.sourceState.mentions.filter((m:any)=>m.status==='review'));
  assert.ok(pending.some((m:any)=>m.mentionId===11608));
  const trips=(await db.query("SELECT count(*)::int count,md5(COALESCE(string_agg(h,'' ORDER BY h),'')) digest FROM (SELECT md5(to_jsonb(t)::text) h FROM trips t) x")).rows[0];
  assert.deepEqual(trips,(await read(folder+'pre-import-check.json')).trips);
  const report={batch:47,readOnly:true,at:new Date().toISOString(),consumedFieldsVerified:exported.length,fields,results,confirmed:3,
    pendingAdded:1,assignmentRows:258,pendingMentions:109,sqlProbes,realVectorProbes:2,graph:18,directEdges:3,historicalReviewPreserved:369,
    relationsUnchanged:true,rawDerivedCachesPreserved:true,trips,imageComparison:'deferred_by_user',fullReviewPassed:false,failures:[]};
  await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
} finally {await db.query('ROLLBACK').catch(()=>{});await db.end();await up.query('ROLLBACK').catch(()=>{});await up.end();}
