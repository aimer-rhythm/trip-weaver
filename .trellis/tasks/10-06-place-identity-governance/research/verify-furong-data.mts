// 实库只读验证整个导出、既有分配、芙蓉街SQL/名称边界及真实向量报告。
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
import {assertFurongRow,FURONG_ID} from './furong-assertions';
const read=async(p:string)=>JSON.parse(await readFile(new URL(p,import.meta.url),'utf8'));
const folder='all-cities/batch-63/sync-01/',city='济南';
const out=new URL('priority-cities/济南/furong-downstream-check-01.json',import.meta.url);
await readFile(out).then(()=>{throw new Error('证据不得覆盖');},(e:NodeJS.ErrnoException)=>{if(e.code!=='ENOENT')throw e;});
const sync=(await read(folder+'sync-state.json')).cities[city];assert.ok(sync.importedAt&&sync.relationsImportedAt&&sync.embeddingRunAt);
const bytes=await readFile(new URL(folder+'xhs-places-济南.json',import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),sync.exportHash);
const exported=JSON.parse(bytes.toString('utf8')).places as PlaceRow[];
const library=await read(folder+'preview-济南/library-before.json'),source=await read('priority-cities/济南/furong-source-packet-01.json');
const scopes=(await Promise.all([36,40,41,42,43,44,45,46,47,48,49,52,53,54,'55-v2','56-v2',57,58,59,60,61,62,63].map(n=>read(`all-cities/batch-${n}-scope-decisions.json`)))).flat();
const latest=new Map<number,any>();for(const s of scopes)for(const a of s.assignments)latest.set(a.mentionId,{...a,scope:s});
const currentScope=(await read('all-cities/batch-63-scope-decisions.json'))[0];
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
  const p=byId.get(FURONG_ID),old=library.tables.canonical_places.find((r:any)=>r.id===FURONG_ID);assert.ok(p&&old);
  const evidence=(await db.query('SELECT kind,content FROM research_evidence WHERE place_id=$1 AND kind LIKE $2',[FURONG_ID,'xhs_%'])).rows;
  const prior=library.tables.research_evidence.filter((e:any)=>e.place_id===FURONG_ID&&e.kind.startsWith('xhs_')).map((e:any)=>({kind:e.kind,content:e.content}));
  assertFurongRow(p,old,5353,evidence,prior);
  assert.deepEqual((p.payload!.mentionSources as any[]).map(m=>m.mentionId).sort((a,b)=>a-b),currentScope.assignments.filter((a:any)=>a.entityId).map((a:any)=>a.mentionId).sort((a:number,b:number)=>a-b));
  const stored=(await db.query("SELECT embedding IS NOT NULL embedded,payload->>'embeddedText' text FROM canonical_places WHERE id=$1",[FURONG_ID])).rows[0];
  assert.equal(stored.embedded,true);assert.equal(stored.text,placeEmbeddingText(p));
  const index=createPlaceIdentityIndex(rows.filter(p=>p.verified||p.payload?.identityWithdrawal));
  const retrieve=createPlaceRetriever({query:(sql,args)=>db.query(sql,args),embed:async()=>null});
  let sqlProbes=0,boundaryProbes=0;
  const ids=[undefined,...(p.payload!.identity as any).memberIds];
  for(const name of p.payload!.aliases as string[]) {
    const hits=await retrieve([name],{city,vector:'off',limit:24});assert.equal(hits[0]?.canonicalPlaceId,FURONG_ID);sqlProbes++;
    for(const id of ids){const r=index.resolve(city,name,id);assert.ok(r.status==='resolved');assert.equal(r.canonicalPlaceId,FURONG_ID);}
  }
  for(const id of ids)for(const name of ['芙蓉街鲁菜馆','芙蓉街西更道餐馆','宽厚里','曲水亭街','芙蓉泉','李长久萃华楼','鲁宴·八不食味道(大明湖总店)','恒隆广场']) {
    const r=index.resolve(city,name,id);assert.ok(r.status!=='resolved'||r.canonicalPlaceId!==FURONG_ID);boundaryProbes++;
  }
  for(const original of library.tables.canonical_places)if(original.id!==FURONG_ID) {
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
  assert.equal(assignments.length,348);
  for(const actual of assignments){const a=latest.get(Number(actual.mention_id));assert.ok(a);assert.equal(actual.entity_id,a.entityId);assert.equal(actual.input_hash,a.inputHash);assert.equal(actual.revision,a.scope.sourcePlaceId===5352?2:1);assert.equal(actual.change_key,a.scope.key);assert.deepEqual(actual.fact_exclusions,a.factExclusions??null);}
  const row=(await up.query('SELECT source_hash,revision,change_key,text_warnings FROM place_identity_scope WHERE place_id=5353')).rows[0];
  assert.equal(row.source_hash,source.groups[0].sources[0].sourceHash);assert.equal(row.revision,1);assert.equal(row.change_key,currentScope.key);assert.deepEqual(row.text_warnings,currentScope.textWarnings);
  const graph=(await db.query('SELECT manifest,relations FROM place_relation_snapshots WHERE city=$1',[city])).rows[0];assert.equal(graph.manifest.revision,37);
  assert.equal(graph.relations.length,18);assert.equal(graph.relations.filter((r:any)=>r.strength==='direct').length,3);
  assert.equal(graph.manifest.sourceState.supplementalSources.length,1);assert.equal(graph.manifest.sourceState.supplementalSources[0].scopePlaceId,5353);
  const pending=graph.manifest.sourceState.mentions.filter((m:any)=>m.status==='review');assert.equal(pending.length,132);
  assert.deepEqual(pending.filter((m:any)=>![12904,12948].includes(m.mentionId)),library.tables.place_relation_snapshots[0].manifest.sourceState.mentions.filter((m:any)=>m.status==='review'));
  const priorAudit=await read('all-cities/audit/run-61/snapshot.json'),audit=await read('all-cities/audit/run-62/snapshot.json');
  const added=audit.reviews.filter((r:any)=>!priorAudit.reviews.some((p:any)=>p.id===r.id));assert.equal(added.length,2);assert.ok(added.every((r:any)=>r.status==='PENDING'));
  assert.deepEqual(added.map((r:any)=>r.detail.mentionId).sort((a:number,b:number)=>a-b),[12904,12948]);
  assert.deepEqual(audit.reviews.filter((r:any)=>!added.some((a:any)=>a.id===r.id)),priorAudit.reviews);
  assert.deepEqual(audit.scopes.filter((r:any)=>Number(r.place_id)!==5353),priorAudit.scopes);assert.deepEqual(audit.scopeSources,priorAudit.scopeSources);
  const trips=(await db.query("SELECT count(*)::int count,md5(COALESCE(string_agg(h,'' ORDER BY h),'')) digest FROM (SELECT md5(to_jsonb(t)::text) h FROM trips t) x")).rows[0];assert.deepEqual(trips,(await read(folder+'pre-import-check.json')).trips);
  const report={batch:63,readOnly:true,at:new Date().toISOString(),consumedFieldsVerified:exported.length,fields,assignmentRows:348,pendingMentions:132,
    scopesAdded:1,confirmed:28,pendingAdded:2,textWarnings:1,fieldExcludedMentionIds:[11699],coordinatesCleared:0,newPreciseLocations:0,sqlProbes,boundaryProbes,
    realVectorProbes:1,realVectors:vectors.cities[0].vectorProbes,graph:18,directEdges:3,priorReviewRowsPreserved:true,allOtherFieldsAndDatesPreserved:true,
    validOldOpinionsAndHighlightsPreserved:true,trips,imageComparison:'deferred_by_user',fullReviewPassed:false,failures:[]};
  await writeFile(out,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
} finally {await db.query('ROLLBACK').catch(()=>{});await up.query('ROLLBACK').catch(()=>{});await db.end();await up.end();}
