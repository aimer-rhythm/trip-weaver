// 实库只读验证整个导出、桥及门洞、既有分配、SQL/名称边界及真实向量报告。
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Client} from 'pg';
import {parse} from 'dotenv';
import {placeNameKey} from '@tripweaver/shared';
import {createPlaceIdentityIndex} from '../../../../apps/server/src/lib/placeIdentity';
import {createPlaceRetriever} from '../../../../apps/server/src/generation/placeRetrieval';
import {placeEmbeddingText} from '../../../../apps/server/src/lib/placeEmbeddingText';
import type {PlaceRow} from '../../../../apps/server/src/generation/retrievalRanking';
import {assertBridgeTextRow,GATE_ID,GATE_NAME} from './bridge-text-assertions';
const read=async(p:string)=>JSON.parse(await readFile(new URL(p,import.meta.url),'utf8'));
const folder='all-cities/batch-65/sync-01/',city='济南';
const out=new URL('priority-cities/济南/bridge-text-downstream-check-01.json',import.meta.url);
await readFile(out).then(()=>{throw new Error('证据不得覆盖');},(e:NodeJS.ErrnoException)=>{if(e.code!=='ENOENT')throw e;});
const sync=(await read(folder+'sync-state.json')).cities[city];assert.ok(sync.importedAt&&sync.relationsImportedAt&&sync.embeddingRunAt);
const bytes=await readFile(new URL(folder+'xhs-places-济南.json',import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),sync.exportHash);
const exported=JSON.parse(bytes.toString('utf8')).places as PlaceRow[];
const library=await read(folder+'preview-济南/library-before.json'),source=await read('priority-cities/济南/bridge-text-source-packet-01.json');
const scopes=(await Promise.all([36,40,41,42,43,44,45,46,47,48,49,52,53,54,'55-v2','56-v2',57,58,59,60,61,62,63,64,65].map(n=>read(`all-cities/batch-${n}-scope-decisions.json`)))).flat();
const latest=new Map<number,any>();for(const s of scopes)for(const a of s.assignments)latest.set(a.mentionId,{...a,scope:s});
const currentScopes=await read('all-cities/batch-65-scope-decisions.json');
const vectors=await read(folder+'verification-vectors.json');assert.deepEqual(vectors.failures,[]);
assert.equal(vectors.cities[0].vectorProbes.length,2);assert.ok(vectors.cities[0].vectorProbes.every((p:any)=>p.diagnostics.vector==='used')); 
const config=parse(await readFile('apps/server/.env')),upConfig=parse(await readFile('D:/Project/xhs-travel-pipeline/.env'));
const db=new Client({connectionString:config.DATABASE_URL,connectionTimeoutMillis:10000});
const up=new Client({connectionString:upConfig.DATABASE_URL!.replace('postgresql+asyncpg:','postgresql:'),connectionTimeoutMillis:10000});
try {
  await db.connect();await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await up.connect();await up.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const rows=(await db.query<PlaceRow>('SELECT id,city,name,category,lat,lng,verified,source,payload FROM canonical_places WHERE city=$1',[city])).rows;
  const byId=new Map(rows.map(p=>[p.id,p]));
  const fields=['identity','aliases','xhsPlaceType','content','topReasons','openHours','reservation','reservationNote','reservationEvidence','reservationConflict','typicalVisitMinutes','mentionSources','themes','address','geoStatus','price','tips'];
  for(const expected of exported) {
    const actual=byId.get(expected.id);assert.ok(actual);
    for(const k of ['name','category','lat','lng','verified'] as const)assert.equal(actual[k],expected[k]);
    for(const k of fields) {
      let value=expected.payload?.[k]??null;
      if(k==='identity'&&value){const identity=value as {memberNames:string[]};value={...identity,nameKeys:[...new Set([...identity.memberNames,...(expected.payload?.aliases as string[]??[])].map(placeNameKey))]};}
      assert.deepEqual(actual.payload?.[k]??null,value,`${actual.name}/${k}`);
    }
  }
  const targetIds=source.groups.map((g:any)=>g.entity.entity_id);
  const index=createPlaceIdentityIndex(rows.filter(p=>p.verified||p.payload?.identityWithdrawal));
  const retrieve=createPlaceRetriever({query:(sql,args)=>db.query(sql,args),embed:async()=>null});
  let sqlProbes=0,boundaryProbes=0;
  for(const g of source.groups) {
    const eid=g.entity.entity_id,sid=g.entity.primary_place_id,p=byId.get(eid),old=library.tables.canonical_places.find((r:any)=>r.id===eid);assert.ok(p&&old);
    const evidence=(await db.query('SELECT kind,content FROM research_evidence WHERE place_id=$1 AND kind LIKE $2',[eid,'xhs_%'])).rows;
    const prior=library.tables.research_evidence.filter((e:any)=>e.place_id===eid&&e.kind.startsWith('xhs_')).map((e:any)=>({kind:e.kind,content:e.content}));
    assertBridgeTextRow(p,old,sid,evidence,prior);
    const stored=(await db.query("SELECT embedding IS NOT NULL embedded,payload->>'embeddedText' text FROM canonical_places WHERE id=$1",[eid])).rows[0];
    assert.equal(stored.embedded,true);assert.equal(stored.text,placeEmbeddingText(p));
    const ids=[undefined,...(p.payload!.identity as any).memberIds];
    for(const name of p.payload!.aliases as string[]) {
      const hits=await retrieve([name],{city,vector:'off',limit:24});assert.equal(hits[0]?.canonicalPlaceId,eid);sqlProbes++;
      for(const id of ids){const r=index.resolve(city,name,id);assert.ok(r.status==='resolved');assert.equal(r.canonicalPlaceId,eid);}
    }
    for(const id of ids)for(const name of ['起凤桥','起凤桥街','起凤桥八号','起凤桥8号','起凤桥八号餐厅',GATE_NAME,'西侧灯笼亭子','起凤泉'].filter(name=>!(p.payload!.aliases as string[]).includes(name))) {
      const r=index.resolve(city,name,id);assert.ok(r.status!=='resolved'||r.canonicalPlaceId!==eid);boundaryProbes++;
    }
  }
  for(const original of library.tables.canonical_places)if(!targetIds.includes(original.id)) {
    const current=byId.get(original.id);assert.ok(current);
    for(const k of ['name','category','lat','lng','verified'] as const)assert.equal(current[k],original[k]);
    for(const k of fields.filter(k=>k!=='content'))assert.deepEqual(current.payload?.[k],original.payload?.[k]);
    if(original.payload?.content) {
      const expected=structuredClone(original.payload.content),actual=current.payload?.content as any;
      assert.ok(actual);assert.deepEqual(actual.highlights,expected.highlights);
      expected.compiledAt=actual.compiledAt;assert.deepEqual(actual,expected);
    }
  }
  const assignments=(await up.query('SELECT mention_id,entity_id,input_hash,revision,change_key,fact_exclusions FROM place_mention_assignment WHERE mention_id=ANY($1::int[])',[[...latest.keys()]])).rows;
  assert.equal(assignments.length,358);
  for(const actual of assignments){const a=latest.get(Number(actual.mention_id));assert.ok(a);assert.equal(actual.entity_id,a.entityId);assert.equal(actual.input_hash,a.inputHash);assert.equal(actual.revision,a.scope.sourcePlaceId===5352?2:1);assert.equal(actual.change_key,a.scope.key);assert.deepEqual(actual.fact_exclusions,a.factExclusions??null);}
  for(const scope of currentScopes) {
    const row=(await up.query('SELECT source_hash,revision,change_key,text_warnings FROM place_identity_scope WHERE place_id=$1',[scope.sourcePlaceId])).rows[0];
    assert.equal(row.source_hash,scope.expectedSourceHash);assert.equal(row.revision,1);assert.equal(row.change_key,scope.key);assert.equal(row.text_warnings,null);
  }
  const graph=(await db.query('SELECT manifest,relations FROM place_relation_snapshots WHERE city=$1',[city])).rows[0];assert.equal(graph.manifest.revision,39);
  assert.equal(graph.relations.length,18);assert.equal(graph.relations.filter((r:any)=>r.strength==='direct').length,3);
  assert.equal(graph.manifest.sourceState.supplementalSources.length,1);assert.equal(graph.manifest.sourceState.supplementalSources[0].scopePlaceId,5353);
  assert.deepEqual(graph.relations,library.tables.place_relation_snapshots[0].relations);
  const pending=graph.manifest.sourceState.mentions.filter((m:any)=>m.status==='review');assert.equal(pending.length,133);
  assert.deepEqual(pending,library.tables.place_relation_snapshots[0].manifest.sourceState.mentions.filter((m:any)=>m.status==='review'));
  for(const name of [GATE_NAME,'起凤桥八号']) {
    assert.ok(!(await retrieve([name],{city,category:'food',vector:'off',limit:48})).some(p=>p.canonicalPlaceId===GATE_ID));
  }
  const priorAudit=await read('all-cities/audit/run-63/snapshot.json'),audit=await read('all-cities/audit/run-64/snapshot.json');
  assert.deepEqual(audit.reviews,priorAudit.reviews);
  assert.deepEqual(audit.scopes.filter((r:any)=>Number(r.place_id)!==5392),priorAudit.scopes);assert.deepEqual(audit.scopeSources,priorAudit.scopeSources);
  const trips=(await db.query("SELECT count(*)::int count,md5(COALESCE(string_agg(h,'' ORDER BY h),'')) digest FROM (SELECT md5(to_jsonb(t)::text) h FROM trips t) x")).rows[0];assert.deepEqual(trips,(await read(folder+'pre-import-check.json')).trips);
  const report={batch:65,readOnly:true,at:new Date().toISOString(),consumedFieldsVerified:exported.length,fields,assignmentRows:358,pendingMentions:133,
    scopesAdded:1,confirmed:2,pendingAdded:0,readOnlySources:1,coordinatesCleared:0,newPreciseLocations:0,sqlProbes,boundaryProbes,
    realVectorProbes:2,realVectors:vectors.cities[0].vectorProbes,foodExclusionProbes:2,graph:18,directEdges:3,priorReviewRowsPreserved:true,allOtherFieldsAndDatesPreserved:true,
    validOldOpinionsAndHighlightsPreserved:true,trips,imageComparison:'deferred_by_user',fullReviewPassed:false,failures:[]};
  await writeFile(out,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
} finally {await db.query('ROLLBACK').catch(()=>{});await up.query('ROLLBACK').catch(()=>{});await db.end();await up.end();}
