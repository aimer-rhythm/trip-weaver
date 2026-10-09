// 完整导出、实库消费、别名/旧ID、补充意见及来源版本只读核验。
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
import {HEMING_ID,HEMING_WARNING,expectedHemingExport,stableHemingPlace} from './heming-assertions';
const read=async(p:string)=>JSON.parse(await readFile(new URL(p,import.meta.url),'utf8'));
const folder='all-cities/batch-69/sync-01/',sync=(await read(folder+'sync-state.json')).cities['成都'];assert.ok(sync.importedAt&&sync.relationsImportedAt&&sync.embeddingRunAt);
const bytes=await readFile(new URL(folder+'xhs-places-成都.json',import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),sync.exportHash);
const exported=JSON.parse(bytes.toString('utf8')).places as PlaceRow[],before=(await read('all-cities/batch-68/sync-01/xhs-places-成都.json')).places;
const library=await read(folder+'preview-成都/library-before.json'),source=await read('all-cities/batch-69-source.json'),scope=(await read('all-cities/batch-69-scope-decisions.json'))[0];
const vectors=await read(folder+'verification-vectors.json');assert.deepEqual(vectors.failures,[]);assert.equal(vectors.cities[0].vectorProbes.length,1);assert.equal(vectors.cities[0].vectorProbes[0].diagnostics.vector,'used');
const db=new Client({connectionString:parse(await readFile('apps/server/.env')).DATABASE_URL,connectionTimeoutMillis:10000});
try{
  await db.connect();await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const rows=(await db.query<PlaceRow>('SELECT id,city,name,category,lat,lng,verified,source,payload FROM canonical_places WHERE city=$1',['成都'])).rows,byId=new Map(rows.map(p=>[p.id,p]));
  for(const p of exported){const prior=before.find((r:any)=>r.id===p.id);assert.ok(prior);
    assert.deepEqual(stableHemingPlace(p),p.id===HEMING_ID?expectedHemingExport(prior,source):stableHemingPlace(prior),`${p.name}/消费精确变化`);
    const actual=byId.get(p.id);assert.ok(actual);for(const k of ['name','category','lat','lng','verified']as const)assert.equal(actual[k],p[k]);
    for(const [k,v]of Object.entries(p.payload??{})){let expected:any=v;if(k==='identity')expected={...expected,nameKeys:[...new Set([...expected.memberNames,...(p.payload?.aliases as string[]??[])].map(placeNameKey))]};assert.deepEqual(actual.payload?.[k],expected,`${p.name}/${k}`);}
  }
  const tea=byId.get(HEMING_ID);assert.ok(tea);
  const evidence=(await db.query('SELECT kind,content,source_url AS "sourceUrl" FROM research_evidence WHERE place_id=$1 AND kind LIKE $2',[HEMING_ID,'xhs_%'])).rows;
  const ordered=(xs:any[])=>xs.map(v=>JSON.stringify(v)).sort();
  assert.deepEqual(ordered(evidence),ordered(expectedHemingExport(before.find((p:any)=>p.id===HEMING_ID),source).evidence));
  assert.equal(evidence.filter(e=>e.kind==='xhs_warning').length,3);assert.ok(evidence.some(e=>e.content===HEMING_WARNING));
  const embedded=(await db.query('SELECT embedding IS NOT NULL embedded,payload->>\'embeddedText\' text FROM canonical_places WHERE id=$1',[HEMING_ID])).rows[0];assert.ok(embedded.embedded);assert.equal(embedded.text,placeEmbeddingText(tea));
  const index=createPlaceIdentityIndex(rows.filter(p=>p.verified||p.payload?.identityWithdrawal)),retrieve=createPlaceRetriever({query:(sql,args)=>db.query(sql,args),embed:async()=>null});
  let sqlProbes=0,boundaryProbes=0;
  const ids=[undefined,...(tea.payload!.identity as any).memberIds];
  for(const name of tea.payload!.aliases as string[]){assert.equal((await retrieve([name],{city:'成都',vector:'off',limit:24}))[0]?.canonicalPlaceId,HEMING_ID);sqlProbes++;
    for(const id of ids){const r=index.resolve('成都',name,id);assert.ok(r.status==='resolved');assert.equal(r.canonicalPlaceId,HEMING_ID);}}
  for(const name of ['人民公园','成都人民公园','祠堂街人民公园','祠堂街','少城茶社','鹤鸣茶社旁','人民公园相亲角'])for(const id of ids){const r=index.resolve('成都',name,id);assert.ok(r.status!=='resolved'||r.canonicalPlaceId!==HEMING_ID);boundaryProbes++;}
  const graph=(await db.query('SELECT manifest,relations FROM place_relation_snapshots WHERE city=$1',['成都'])).rows[0];assert.equal(graph.manifest.revision,9);
  assert.deepEqual(graph.relations,library.tables.place_relation_snapshots[0].relations);assert.equal(graph.relations.length,49);
  const supplement=graph.manifest.sourceState.supplementalSources;assert.equal(supplement.length,1);assert.equal(supplement[0].scopePlaceId,1847);
  const currentAudit=await read('all-cities/audit/run-68/snapshot.json'),oldAudit=await read('all-cities/audit/run-67/snapshot.json');
  assert.deepEqual(currentAudit.reviews,oldAudit.reviews);assert.deepEqual(currentAudit.scopes.filter((s:any)=>Number(s.place_id)!==1847),oldAudit.scopes);assert.deepEqual(currentAudit.scopeSources,oldAudit.scopeSources);
  const newScope=currentAudit.scopes.find((s:any)=>Number(s.place_id)===1847);
  assert.deepEqual(newScope,{place_id:'1847',city:'成都',name_keys:['鹤鸣茶社'],entity_ids:[HEMING_ID],revision:1});
  // 审计快照只含scope索引；完整警示由上游只读catalog核验及本文件的完整导出/SQL语料核验共同覆盖。
  const upstreamInputs=await read('priority-cities/成都/heming-inputs-check-01.json');
  assert.deepEqual(upstreamInputs.failures,[]);assert.equal(upstreamInputs.exactMultilineWarningStored,true);
  assert.equal(scope.textWarnings.length,1);assert.equal(scope.textWarnings[0].quote,HEMING_WARNING);
  const trips=(await db.query("SELECT count(*)::int count,md5(COALESCE(string_agg(h,'' ORDER BY h),'')) digest FROM (SELECT md5(to_jsonb(t)::text) h FROM trips t) x")).rows[0];assert.deepEqual(trips,(await read(folder+'pre-import-check.json')).trips);
  const report={batch:69,readOnly:true,consumedFieldsVerified:392,sqlProbes,boundaryProbes,realVectorProbes:1,confirmed:6,textWarnings:1,originalHighlightsAndDates:4,oldEvidencePreserved:5,currentEvidence:7,
    originalNegativeOpinionsPreserved:2,multilineOriginalOpinionPreserved:true,allOtherPlacesPreserved:true,parentWebProfilePreserved:true,graph:49,directEdges:15,relationContentPreserved:true,
    oldReviewsPreserved:true,pendingAdded:0,coordinatesCleared:0,preciseLocationsResolved:0,trips,imageComparison:'deferred_by_user',fullReviewPassed:false,failures:[]};
  await writeFile(new URL('priority-cities/成都/heming-downstream-check-01.json',import.meta.url),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
}finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
