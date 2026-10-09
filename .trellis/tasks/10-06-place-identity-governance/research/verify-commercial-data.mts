// 第45批只读检查：实际城市消费、原提及分配、未应用三主体与图片字段保全。
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
const folder='all-cities/batch-45/sync-01/',city='济南';
const output=new URL('priority-cities/济南/commercial-downstream-check-01.json',import.meta.url);
await readFile(output).then(()=>{throw new Error('证据不能覆盖');},(e:NodeJS.ErrnoException)=>{if(e.code!=='ENOENT')throw e;});
const sync=(await read(folder+'sync-state.json')).cities[city];assert.ok(sync.importedAt&&sync.relationsImportedAt&&sync.embeddingRunAt);
const bytes=await readFile(new URL(folder+'xhs-places-济南.json',import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),sync.exportHash);
const exported=JSON.parse(bytes.toString('utf8')).places as PlaceRow[];
const library=await read(folder+'preview-济南/library-before.json'),source=await read('all-cities/batch-45-source.json');
const packet=await read('priority-cities/济南/commercial-source-packet-01.json');
const scopes=(await Promise.all([36,40,41,42,43,44,45].map(n=>read(`all-cities/batch-${n}-scope-decisions.json`)))).flat();
const vectors=await read(folder+'verification-vectors.json');assert.deepEqual(vectors.failures,[]);
assert.equal(vectors.cities[0].probes.length,2);assert.equal(vectors.cities[0].vectorProbes.length,2);
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
  const results=[];let sqlProbes=0;
  for(const g of source.groups) {
    const eid=g.entity.entity_id,p=byId.get(eid);assert.ok(p);
    const old=library.tables.canonical_places.find((r:PlaceRow)=>r.id===eid);assert.ok(old);
    const s=scopes.find((s:any)=>s.sourcePlaceId===g.entity.primary_place_id);
    assert.equal((p.payload?.identity as any).revision,3);assert.equal(p.category,'文化');assert.equal(p.verified,true);
    assert.deepEqual(p.payload?.aliases,g.entity.aliases);
    assert.deepEqual((p.payload?.mentionSources as any[]).map(m=>m.mentionId).sort((a,b)=>a-b),s.assignments.map((a:any)=>a.mentionId).sort((a:number,b:number)=>a-b));
    assert.equal(p.payload?.typicalVisitMinutes??null,null);assert.deepEqual((p.payload?.imageIdentity as any).approved,[]);
    for(const k of ['imageIdentity','imageGallery','coverImage','amapPhoto'])assert.equal(old.payload[k],undefined);
    const boundaries=p.name==='大观园'?['融汇老商埠','经三路','大观园街道','欧亚大观园商场','大观园入口']:['经三路爱心红绿灯','经三路','纬三路','融汇老商埠','夹心胡同'];
    for(const name of g.entity.aliases) {
      const hits=await retrieve([name],{city,vector:'off',limit:24});assert.ok(hits.some(h=>h.canonicalPlaceId===eid));sqlProbes++;
      for(const id of [undefined,...g.entity.legacy_ids]) {
        const result=index.resolve(city,name,id);assert.equal(result.status,'resolved');if(result.status==='resolved')assert.equal(result.canonicalPlaceId,eid);
        for(const wrong of boundaries) {const r=index.resolve(city,wrong,id);assert.ok(r.status!=='resolved'||r.canonicalPlaceId!==eid);}
      }
    }
    const evidence=(await db.query('SELECT content FROM research_evidence WHERE place_id=$1 AND kind LIKE $2',[eid,'xhs_%'])).rows;
    if(p.name==='大观园') {
      assert.equal(p.lat,null);assert.equal(p.lng,null);assert.equal(p.payload?.geoStatus,'unresolvable');
      assert.equal(p.payload?.address,'山东省济南市市中区经四路与纬二路交汇处');assert.equal(p.payload?.xhsPlaceType,'attraction');
      assert.equal(old.payload.address,'经二路728');assert.ok(evidence.every(e=>!e.content.includes('经二路728')));
    } else {
      assert.equal(p.lat,old.lat);assert.equal(p.lng,old.lng);assert.equal(p.payload?.xhsPlaceType,'photo_spot');
      assert.doesNotMatch(JSON.stringify(p.payload),/爱心红绿灯|夹心胡同/);assert.match(JSON.stringify(p.payload?.content),/爱心斑马线/);
    }
    results.push({entityId:eid,name:p.name,confirmed:s.assignments.length,pending:0,boundaries,category:p.category,lat:p.lat,lng:p.lng});
  }
  const targets=new Set(results.map(r=>r.entityId));
  const deferred=packet.groups.filter((g:any)=>!targets.has(g.entity.entity_id));assert.equal(deferred.length,3);
  const regeneratedContentTimestamps=[];
  for(const g of deferred) {
    const old=library.tables.canonical_places.find((p:PlaceRow)=>p.id===g.entity.entity_id),actual=byId.get(g.entity.entity_id);assert.ok(old&&actual);
    for(const k of ['id','name','category','lat','lng','verified','source'] as const)assert.deepEqual(actual[k],old[k],`未应用主体/${g.entity.canonical_name}/${k}`);
    const actualPayload=structuredClone(actual.payload) as any,oldPayload=structuredClone(old.payload);
    // 全城导出会重建普通提及内容的编译时间，单独报告；事实文本、身份和图库逐字段严格比较。
    if(actualPayload?.content?.compiledAt!==oldPayload?.content?.compiledAt) {
      assert.ok(actualPayload.content&&oldPayload.content);
      regeneratedContentTimestamps.push({name:g.entity.canonical_name,before:oldPayload.content.compiledAt,after:actualPayload.content.compiledAt});
      delete actualPayload.content.compiledAt;delete oldPayload.content.compiledAt;
    }
    assert.deepEqual(actualPayload,oldPayload,`未应用主体事实、身份与图片/${g.entity.canonical_name}`);
    assert.equal((await up.query('SELECT count(*)::int n FROM place_mention_assignment WHERE mention_id=ANY($1::int[])',[g.mentionIds])).rows[0].n,0);
  }
  for(const raw of source.sources) {
    const actual=(await up.query('SELECT typical_visit_minutes,typical_visit_source,theme_tags,content_profile FROM canonical_place WHERE id=$1',[raw.source.id])).rows[0];assert.deepEqual(actual,raw.derivedBefore);
  }
  const assignments=(await up.query('SELECT mention_id,entity_id,input_hash,revision,change_key,fact_exclusions FROM place_mention_assignment WHERE mention_id=ANY($1::int[])',
    [scopes.flatMap((s:any)=>s.assignments.map((a:any)=>a.mentionId))])).rows;assert.equal(assignments.length,253);
  for(const s of scopes)for(const a of s.assignments) {
    const actual=assignments.find(r=>Number(r.mention_id)===a.mentionId);assert.ok(actual);
    assert.equal(actual.entity_id,a.entityId);assert.equal(actual.input_hash,a.inputHash);assert.equal(actual.revision,1);
    assert.equal(actual.change_key,s.key);assert.deepEqual(actual.fact_exclusions,a.factExclusions??null);
  }
  const graph=(await db.query('SELECT manifest,relations FROM place_relation_snapshots WHERE city=$1',[city])).rows[0];
  assert.equal(graph.manifest.revision,19);assert.equal(graph.relations.length,18);assert.equal(graph.relations.filter((r:any)=>r.strength==='direct').length,3);
  assert.deepEqual(graph.relations,library.tables.place_relation_snapshots[0].relations);
  const pending=graph.manifest.sourceState.mentions.filter((m:any)=>m.status==='review');assert.equal(pending.length,108);
  assert.deepEqual(pending,library.tables.place_relation_snapshots[0].manifest.sourceState.mentions.filter((m:any)=>m.status==='review'));
  const trips=(await db.query("SELECT count(*)::int count,md5(COALESCE(string_agg(h,'' ORDER BY h),'')) digest FROM (SELECT md5(to_jsonb(t)::text) h FROM trips t) x")).rows[0];
  assert.deepEqual(trips,(await read(folder+'pre-import-check.json')).trips);
  const report={batch:45,readOnly:true,at:new Date().toISOString(),consumedFieldsVerified:exported.length,fields,results,assignmentRows:253,pendingMentions:108,
    sqlProbes,realVectorProbes:2,graph:18,directEdges:3,relationsUnchanged:true,deferredRootsUnchanged:3,regeneratedContentTimestamps,rawDerivedCachesPreserved:true,trips,
    imageComparison:'deferred_by_user',fullReviewPassed:false,failures:[]};
  await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
} finally {await db.query('ROLLBACK').catch(()=>{});await db.end();await up.query('ROLLBACK').catch(()=>{});await up.end();}
