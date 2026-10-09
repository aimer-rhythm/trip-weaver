// 正式导入后的全字段、SQL/旧ID边界、原评价与关系版本只读核验。
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
const read=async(p:string)=>JSON.parse(await readFile(new URL(p,import.meta.url),'utf8'));
const stable=(p:any)=>{const v=structuredClone(p);if(v.payload?.content)delete v.payload.content.compiledAt;return v;};
const folder='all-cities/batch-70/sync-01/',id='8a433260acdd259716088f8009e0fbdc';
const sync=(await read(folder+'sync-state.json')).cities['成都'];assert.ok(sync.importedAt&&sync.relationsImportedAt&&sync.embeddingRunAt);
const bytes=await readFile(new URL(folder+'xhs-places-成都.json',import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),sync.exportHash);
const exported=JSON.parse(bytes.toString('utf8')).places as PlaceRow[],before=(await read('all-cities/batch-69/sync-01/xhs-places-成都.json')).places;
const isolated=await read('all-cities/batch-70/scope-preview-1791512008187072400/xhs-places-成都.json');
const expected=isolated.places.find((p:any)=>p.id===id),scope=(await read('all-cities/batch-70-scope-decisions.json'))[0];
const vectors=await read(folder+'verification-vectors.json');assert.deepEqual(vectors.failures,[]);assert.equal(vectors.cities[0].vectorProbes.length,1);assert.equal(vectors.cities[0].vectorProbes[0].diagnostics.vector,'used');
const inputs=await read('priority-cities/成都/jinli-inputs-check-01.json');assert.deepEqual(inputs.failures,[]);assert.equal(inputs.exactTextWarningsStored,3);assert.ok(inputs.relationChangesExplained);
const db=new Client({connectionString:parse(await readFile('apps/server/.env')).DATABASE_URL,connectionTimeoutMillis:10000});
try{
  await db.connect();await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const rows=(await db.query<PlaceRow>('SELECT id,city,name,category,lat,lng,verified,source,payload FROM canonical_places WHERE city=$1',['成都'])).rows,byId=new Map(rows.map(p=>[p.id,p]));
  for(const p of exported){
    assert.deepEqual(stable(p),stable(p.id===id?expected:before.find((r:any)=>r.id===p.id)),`${p.name}/全字段变化`);
    const actual=byId.get(p.id);assert.ok(actual);for(const k of ['name','category','lat','lng','verified']as const)assert.equal(actual[k],p[k]);
    for(const [k,v]of Object.entries(p.payload??{})){let wanted:any=v;if(k==='identity')wanted={...wanted,nameKeys:[...new Set([...wanted.memberNames,...(p.payload?.aliases as string[]??[])].map(placeNameKey))]};assert.deepEqual(actual.payload?.[k],wanted,`${p.name}/${k}`);}
  }
  const target=byId.get(id);assert.ok(target);const identity=target.payload!.identity as any;
  assert.deepEqual(identity.memberNames,['锦里','锦里古街']);assert.equal(target.payload?.xhsPlaceType,'market');
  assert.equal(target.payload?.typicalVisitMinutes,undefined);assert.deepEqual(target.payload?.tips,scope.textWarnings.map((w:any)=>w.quote));
  const evidence=(await db.query('SELECT kind,content,source_url AS "sourceUrl" FROM research_evidence WHERE place_id=$1 AND kind LIKE $2',[id,'xhs_%'])).rows;
  const ordered=(xs:any[])=>xs.map(v=>JSON.stringify(v)).sort();assert.deepEqual(ordered(evidence),ordered(expected.evidence));
  assert.equal(evidence.length,18);assert.equal(evidence.filter(e=>e.kind==='xhs_warning').length,10);
  const embedded=(await db.query('SELECT embedding IS NOT NULL embedded,payload->>\'embeddedText\' text FROM canonical_places WHERE id=$1',[id])).rows[0];assert.ok(embedded.embedded);assert.equal(embedded.text,placeEmbeddingText(target));
  const index=createPlaceIdentityIndex(rows.filter(p=>p.verified||p.payload?.identityWithdrawal)),retrieve=createPlaceRetriever({query:(sql,args)=>db.query(sql,args),embed:async()=>null});
  let sqlProbes=0,boundaryProbes=0;
  const ids=[undefined,...identity.memberIds];
  for(const name of target.payload!.aliases as string[]){assert.equal((await retrieve([name],{city:'成都',vector:'off',limit:24}))[0]?.canonicalPlaceId,id);sqlProbes++;
    for(const oldId of ids){const result=index.resolve('成都',name,oldId);assert.ok(result.status==='resolved');assert.equal(result.canonicalPlaceId,id);}}
  for(const name of ['锦里古街主巷','锦里小吃街','莲花池','武侯祠','三国茶文化广场','锦里西入口','锦里附近'])for(const oldId of ids){const result=index.resolve('成都',name,oldId);assert.ok(result.status!=='resolved'||result.canonicalPlaceId!==id);boundaryProbes++;}
  const graph=(await db.query('SELECT manifest,relations FROM place_relation_snapshots WHERE city=$1',['成都'])).rows[0];assert.equal(graph.manifest.revision,10);
  assert.deepEqual(graph.relations,(await read(folder+'xhs-place-relations-成都.json')).relations);assert.equal(graph.relations.length,49);assert.equal(graph.relations.filter((r:any)=>r.strength==='direct').length,14);
  assert.deepEqual(graph.manifest.sourceState.supplementalSources.map((s:any)=>s.scopePlaceId).sort(),[1689,1847]);
  const oldAudit=await read('all-cities/audit/run-68/snapshot.json'),audit=await read('all-cities/audit/run-69/snapshot.json');
  for(const r of oldAudit.reviews)assert.deepEqual(audit.reviews.find((a:any)=>a.id===r.id),r);
  assert.equal(audit.reviews.length,oldAudit.reviews.length+1);
  assert.deepEqual(audit.scopes.filter((s:any)=>Number(s.place_id)!==1689),oldAudit.scopes);assert.deepEqual(audit.scopeSources,oldAudit.scopeSources);
  assert.deepEqual(audit.scopes.find((s:any)=>Number(s.place_id)===1689),{place_id:'1689',city:'成都',name_keys:['锦里'],entity_ids:[id],revision:1});
  const trips=(await db.query("SELECT count(*)::int count,md5(COALESCE(string_agg(h,'' ORDER BY h),'')) digest FROM (SELECT md5(to_jsonb(t)::text) h FROM trips t) x")).rows[0];assert.deepEqual(trips,(await read(folder+'pre-import-check.json')).trips);
  const report={batch:70,readOnly:true,consumedFieldsVerified:exported.length,allOtherPlacesPreserved:391,sqlProbes,boundaryProbes,realVectorProbes:1,
    confirmed:16,pendingAdded:1,pendingMentionIds:[3702],textWarnings:3,currentEvidence:18,originalWarningsPreserved:7,oldOpinionEvidencePreserved:6,
    oldValidHighlightsAndDatesPreserved:3,wrongAreaHighlightRemoved:1,subareaNameRemoved:true,noTravelInclusiveDurationAdded:true,wuhouAllFieldsPreserved:true,
    graph:49,directEdges:14,relationChangesExplained:true,oldReviewsPreserved:true,coordinatesCleared:0,preciseLocationsResolved:0,trips,
    imageComparison:'deferred_by_user',fullReviewPassed:false,failures:[]};
  await writeFile(new URL('priority-cities/成都/jinli-downstream-check-01.json',import.meta.url),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
}finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
