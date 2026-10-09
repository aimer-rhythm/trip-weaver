// 第51批实际消费：不明坐标清除、两个独立名称与空格形式、既有事实/分配保持。
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
const folder='all-cities/batch-51/sync-01/',city='济南';
const output=new URL('priority-cities/济南/food-address-downstream-check-01.json',import.meta.url);
await readFile(output).then(()=>{throw new Error('证据不能覆盖');},(e:NodeJS.ErrnoException)=>{if(e.code!=='ENOENT')throw e;});
const sync=(await read(folder+'sync-state.json')).cities[city];assert.ok(sync.importedAt&&sync.relationsImportedAt&&sync.embeddingRunAt);
const bytes=await readFile(new URL(folder+'xhs-places-济南.json',import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),sync.exportHash);
const exported=JSON.parse(bytes.toString('utf8')).places as PlaceRow[];
const library=await read(folder+'preview-济南/library-before.json'),source=await read('all-cities/batch-51-source.json');
const targets=source.groups.map((g:any)=>g.entity.entity_id);
const scopes=(await Promise.all([36,40,41,42,43,44,45,46,47,48,49].map(n=>read(`all-cities/batch-${n}-scope-decisions.json`)))).flat();
const latest=new Map<number,any>();for(const s of scopes)for(const a of s.assignments)latest.set(a.mentionId,{...a,scope:s});
const vectors=await read(folder+'verification-vectors.json');assert.deepEqual(vectors.failures,[]);
assert.equal(vectors.cities[0].vectorProbes.length,6);assert.ok(vectors.cities[0].vectorProbes.every((v:any)=>v.diagnostics.vector==='used'));
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
  let sqlProbes=0,boundaryProbes=0;const results=[];
  for(const g of source.groups) {
    const eid=g.entity.entity_id,p=byId.get(eid),old=library.tables.canonical_places.find((r:PlaceRow)=>r.id===eid);assert.ok(p&&old);
    const reviewed=(await read('priority-cities/济南/food-address-source-review-01.json')).rows.find((r:any)=>r.entityId===eid);assert.ok(reviewed);
    assert.equal((p.payload?.identity as any).revision,2);assert.equal(p.category,'美食');assert.equal(old.category,'美食');
    assert.equal(p.payload?.xhsPlaceType,'food');assert.equal(p.verified,true);assert.equal(p.lat,null);assert.equal(p.lng,null);
    assert.equal(old.lat,Number(reviewed.priorPoint.lat.toFixed(6)));assert.equal(old.lng,Number(reviewed.priorPoint.lng.toFixed(6)));assert.equal(p.payload?.geoStatus,'unresolvable');
    assert.equal(p.payload?.address,reviewed.address);
    for(const k of ['aliases','mentionCount','topReasons','themes','typicalVisitMinutes','mentionSources','reservation','reservationEvidence','openHours'])assert.deepEqual(p.payload?.[k],old.payload[k]);
    assert.equal(p.payload?.mentionCount,2);assert.equal(p.payload?.mentionSources,undefined);
    for(const k of ['intro','highlights'])assert.deepEqual((p.payload?.content as any)[k],old.payload.content[k]);
    const evidence=(await db.query('SELECT kind,content FROM research_evidence WHERE place_id=$1 AND kind LIKE $2 ORDER BY kind,content',[eid,'xhs_%'])).rows;
    const previous=library.tables.research_evidence.filter((r:any)=>r.place_id===eid&&r.kind.startsWith('xhs_')).map((r:any)=>({kind:r.kind,content:r.content}));
    assert.deepEqual(evidence,previous.sort((a:any,b:any)=>a.kind.localeCompare(b.kind)||a.content.localeCompare(b.content)));
    const names=[g.entity.canonical_name,...g.entity.aliases];
    const boundaries=[...source.groups.filter((v:any)=>v.entity.entity_id!==eid).map((v:any)=>v.entity.canonical_name),reviewed.address];
    assert.equal(g.mentionIds.length,2);assert.deepEqual([...new Set(source.mentions.filter((m:any)=>g.mentionIds.includes(m.id)).map((m:any)=>m.raw_note_id))],[2585]);
    for(const name of names) {
      const hits=await retrieve([name],{city,vector:'off',limit:24});assert.equal(hits[0]?.canonicalPlaceId,eid);sqlProbes++;
      for(const id of [undefined,...g.entity.legacy_ids]) {
        const r=index.resolve(city,name,id);assert.equal(r.status,'resolved');if(r.status==='resolved')assert.equal(r.canonicalPlaceId,eid);
        for(const wrong of boundaries){const r=index.resolve(city,wrong,id);assert.ok(r.status!=='resolved'||r.canonicalPlaceId!==eid);boundaryProbes++;}
      }
    }
    results.push({entityId:eid,name:p.name,category:p.category,type:p.payload?.xhsPlaceType,coordinates:null,address:p.payload?.address,sourceFactsPreserved:true});
  }
  const fallbackObservedAtChanges:{entityId:string;name:string;highlightIndex:number}[]=[];
  for(const original of library.tables.canonical_places)if(!targets.includes(original.id)) {
    const current=byId.get(original.id);assert.ok(current);
    for(const k of ['name','category','lat','lng','verified'] as const)assert.equal(current[k],original[k]);
    for(const k of fields.filter(k=>k!=='content'))assert.deepEqual(current.payload?.[k],original.payload?.[k]);
    if(original.payload?.content) {
      const expectedContent=structuredClone(original.payload.content),actualContent=current.payload?.content as any;
      assert.ok(actualContent);assert.equal(actualContent.highlights.length,expectedContent.highlights.length);
      assert.deepEqual(actualContent.highlights,expectedContent.highlights,'metadata01修复后来源日期必须稳定');
      expectedContent.compiledAt=actualContent.compiledAt;assert.deepEqual(actualContent,expectedContent);
    }
  }
  for(const g of source.sources)assert.deepEqual((await up.query('SELECT typical_visit_minutes,typical_visit_source,theme_tags,content_profile FROM canonical_place WHERE id=$1',[g.source.id])).rows[0],g.derivedBefore);
  const assignments=(await up.query('SELECT mention_id,entity_id,input_hash,revision,change_key,fact_exclusions FROM place_mention_assignment WHERE mention_id=ANY($1::int[])',[ [...latest.keys()] ])).rows;
  assert.equal(assignments.length,268);
  for(const actual of assignments) {
    const a=latest.get(Number(actual.mention_id));assert.ok(a);assert.equal(actual.entity_id,a.entityId);assert.equal(actual.input_hash,a.inputHash);
    assert.equal(actual.revision,a.scope.sourcePlaceId===5352?2:1);assert.equal(actual.change_key,a.scope.key);assert.deepEqual(actual.fact_exclusions,a.factExclusions??null);
  }
  const graph=(await db.query('SELECT manifest,relations FROM place_relation_snapshots WHERE city=$1',[city])).rows[0];assert.equal(graph.manifest.revision,25);
  assert.deepEqual(graph.relations,library.tables.place_relation_snapshots[0].relations);
  const pending=graph.manifest.sourceState.mentions.filter((m:any)=>m.status==='review');assert.equal(pending.length,107);
  assert.deepEqual(pending,library.tables.place_relation_snapshots[0].manifest.sourceState.mentions.filter((m:any)=>m.status==='review'));
  const priorAudit=await read('all-cities/audit/run-49/snapshot.json'),audit=await read('all-cities/audit/run-50/snapshot.json');
  for(const k of ['reviews','scopes','scopeSources'])assert.deepEqual(audit[k],priorAudit[k]);
  const trips=(await db.query("SELECT count(*)::int count,md5(COALESCE(string_agg(h,'' ORDER BY h),'')) digest FROM (SELECT md5(to_jsonb(t)::text) h FROM trips t) x")).rows[0];
  assert.deepEqual(trips,(await read(folder+'import-audit-baseline.json')).trips);
  const report={batch:51,readOnly:true,at:new Date().toISOString(),consumedFieldsVerified:exported.length,fields,results,assignmentRows:268,pendingMentions:107,
    scopesAdded:0,coordinatesCleared:6,newPreciseLocations:0,categoriesCorrected:0,addressesAdded:6,sqlProbes,boundaryProbes,realVectorProbes:6,graph:18,directEdges:3,
    relationEvidenceAndStrengthPreserved:true,allReviewRowsPreserved:true,rawDerivedCachesPreserved:true,sourceFactsPreserved:true,
    fallbackObservedAtChanges,fallbackObservedAtMeaning:'metadata01后148旧看点来源日期保持；仅compiledAt随本次导出更新。',trips,
    imageComparison:'deferred_by_user',fullReviewPassed:false,failures:[]};
  await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...report,fallbackObservedAtChanges:fallbackObservedAtChanges.length}));
} finally {await db.query('ROLLBACK').catch(()=>{});await up.query('ROLLBACK').catch(()=>{});await db.end();await up.end();}
