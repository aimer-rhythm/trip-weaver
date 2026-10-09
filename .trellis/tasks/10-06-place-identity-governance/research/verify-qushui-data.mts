// 第49批全城实际消费、已有scope升版及关系精确版本变化核对。
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
const folder='all-cities/batch-49/sync-01/',city='济南',eid='c9c9ce7c33c95b71b859f0ab30bf7136';
const output=new URL('priority-cities/济南/qushui-downstream-check-01.json',import.meta.url);
await readFile(output).then(()=>{throw new Error('证据不能覆盖');},(e:NodeJS.ErrnoException)=>{if(e.code!=='ENOENT')throw e;});
const sync=(await read(folder+'sync-state.json')).cities[city];assert.ok(sync.importedAt&&sync.relationsImportedAt&&sync.embeddingRunAt);
const bytes=await readFile(new URL(folder+'xhs-places-济南.json',import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),sync.exportHash);
const exported=JSON.parse(bytes.toString('utf8')).places as PlaceRow[];
const library=await read(folder+'preview-济南/library-before.json'),source=await read('all-cities/batch-49-source.json');
const history=await read('all-cities/batch-49-catalog.json');
const scopes=(await Promise.all([36,40,41,42,43,44,45,46,47,48,49].map(n=>read(`all-cities/batch-${n}-scope-decisions.json`)))).flat();
const latest=new Map<number,any>();for(const s of scopes)for(const a of s.assignments)latest.set(a.mentionId,{...a,scope:s});
const vectors=await read(folder+'verification-vectors.json');assert.deepEqual(vectors.failures,[]);
assert.equal(vectors.cities[0].vectorProbes.length,1);assert.equal(vectors.cities[0].vectorProbes[0].diagnostics.vector,'used');
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
  const p=byId.get(eid),old=library.tables.canonical_places.find((r:PlaceRow)=>r.id===eid);assert.ok(p&&old);
  assert.equal((p.payload?.identity as any).revision,4);assert.equal(p.category,'文化');assert.equal(p.payload?.xhsPlaceType,old.payload.xhsPlaceType);
  assert.equal(p.verified,true);assert.equal(p.lat,old.lat);assert.equal(p.lng,old.lng);assert.equal(p.payload?.address,old.payload.address);
  assert.deepEqual(p.payload?.aliases,old.payload.aliases);assert.equal(p.payload?.mentionCount,46);assert.equal(old.payload.mentionCount,44);
  assert.equal(p.payload?.typicalVisitMinutes,50);assert.equal(old.payload.typicalVisitMinutes,50);
  assert.deepEqual((p.payload?.mentionSources as any[]).map(m=>m.mentionId).sort((a,b)=>a-b),
    [...old.payload.mentionSources.map((m:any)=>m.mentionId),11369,12610].sort((a,b)=>a-b));
  assert.doesNotMatch(JSON.stringify(p.payload),/起凤桥/);assert.match(JSON.stringify(p.payload?.content),/小桥流水、青石板路/);
  const evidence=(await db.query('SELECT kind,content FROM research_evidence WHERE place_id=$1 AND kind LIKE $2',[eid,'xhs_%'])).rows;
  assert.ok(evidence.every(e=>!e.content.includes('起凤桥')));
  const boundaries=['百花洲','起凤桥','起凤泉','曲水亭街北口','曲水亭茶馆','百花洲历史文化街区'];
  let sqlProbes=0,boundaryProbes=0;
  for(const name of ['曲水亭街','曲水亭']) {
    const hits=await retrieve([name],{city,vector:'off',limit:24});assert.equal(hits[0]?.canonicalPlaceId,eid);sqlProbes++;
    for(const id of [undefined,...source.groups[0].entity.legacy_ids]) {
      const r=index.resolve(city,name,id);assert.equal(r.status,'resolved');if(r.status==='resolved')assert.equal(r.canonicalPlaceId,eid);
      for(const wrong of boundaries){const r=index.resolve(city,wrong,id);assert.ok(r.status!=='resolved'||r.canonicalPlaceId!==eid);boundaryProbes++;}
    }
  }
  for(const original of library.tables.canonical_places)if(original.id!==eid) {
    const current=byId.get(original.id);assert.ok(current);
    for(const field of ['identity','aliases','mentionSources','topReasons','typicalVisitMinutes','xhsPlaceType'])assert.deepEqual(current.payload?.[field],original.payload?.[field]);
  }
  for(const g of source.sources)assert.deepEqual((await up.query('SELECT typical_visit_minutes,typical_visit_source,theme_tags,content_profile FROM canonical_place WHERE id=$1',[g.source.id])).rows[0],g.derivedBefore);
  const assignments=(await up.query('SELECT mention_id,entity_id,input_hash,revision,change_key,fact_exclusions FROM place_mention_assignment WHERE mention_id=ANY($1::int[])',[ [...latest.keys()] ])).rows;
  assert.equal(assignments.length,268);
  for(const actual of assignments) {
    const a=latest.get(Number(actual.mention_id));assert.ok(a);
    assert.equal(actual.entity_id,a.entityId);assert.equal(actual.input_hash,a.inputHash);
    assert.equal(actual.revision,a.scope.sourcePlaceId===5352?2:1);
    assert.equal(actual.change_key,a.scope.key);assert.deepEqual(actual.fact_exclusions,a.factExclusions??null);
  }
  const reviewRows=(await up.query('SELECT id,city,fingerprint,status,detail FROM place_entity_review WHERE id=ANY($1::int[]) ORDER BY id',[history.reviews.map((r:any)=>r.id)])).rows.map(r=>({...r,id:Number(r.id)}));
  const expectedReviews=structuredClone(history.reviews);for(const r of expectedReviews)if([11369,12610].includes(r.detail.mentionId))r.status='RESOLVED';
  assert.deepEqual(reviewRows,expectedReviews);
  const graph=(await db.query('SELECT manifest,relations FROM place_relation_snapshots WHERE city=$1',[city])).rows[0];assert.equal(graph.manifest.revision,23);
  const expectedGraph=structuredClone(library.tables.place_relation_snapshots[0].relations);let revisedEdges=0;
  for(const edge of expectedGraph) {
    if(edge.fromEntityId===eid||edge.toEntityId===eid)revisedEdges++;
    for(const side of ['from','to'])if(edge[side+'EntityId']===eid){assert.equal(edge[side+'Revision'],3);edge[side+'Revision']=4;}
    for(const item of edge.evidence)for(const side of ['from','to'])if(item[side].entityId===eid){assert.equal(item[side].revision,3);item[side].revision=4;}
  }
  assert.equal(revisedEdges,6);assert.deepEqual(graph.relations,expectedGraph);
  const pending=graph.manifest.sourceState.mentions.filter((m:any)=>m.status==='review');assert.equal(pending.length,107);
  const oldPending=library.tables.place_relation_snapshots[0].manifest.sourceState.mentions.filter((m:any)=>m.status==='review');
  assert.equal(oldPending.length,109);assert.deepEqual(pending,oldPending.filter((m:any)=>![11369,12610].includes(m.mentionId)));
  const trips=(await db.query("SELECT count(*)::int count,md5(COALESCE(string_agg(h,'' ORDER BY h),'')) digest FROM (SELECT md5(to_jsonb(t)::text) h FROM trips t) x")).rows[0];
  assert.deepEqual(trips,(await read(folder+'pre-import-check.json')).trips);
  const report={batch:49,readOnly:true,at:new Date().toISOString(),consumedFieldsVerified:exported.length,fields,confirmed:46,pending:10,pendingResolved:[11369,12610],
    assignmentRows:268,priorAssignmentsUnchanged:54,pendingMentions:107,sqlProbes,boundaryProbes,realVectorProbes:1,graph:18,directEdges:3,
    partialHighlightExclusions:2,descriptionFieldExclusions:2,relationVersionOnlyChanges:6,relationEvidenceAndStrengthPreserved:true,
    historicalReviewsPreserved:13,rawDerivedCachesPreserved:true,trips,imageComparison:'deferred_by_user',fullReviewPassed:false,failures:[]};
  await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
} finally {await db.query('ROLLBACK').catch(()=>{});await up.query('ROLLBACK').catch(()=>{});await db.end();await up.end();}
