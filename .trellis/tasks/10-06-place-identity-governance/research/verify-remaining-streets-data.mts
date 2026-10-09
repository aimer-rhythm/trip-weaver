import {assertRemainingStreetRow} from './remaining-streets-assertions';
// 第62批实际库核对：街道廊道类别、30分钟街道停留、分店撤回及负面意见保全。
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Client} from 'pg';
import {parse} from 'dotenv';
import {placeNameKey} from '@tripweaver/shared';
import {createPlaceIdentityIndex} from '../../../../apps/server/src/lib/placeIdentity';
import {createPlaceRetriever} from '../../../../apps/server/src/generation/placeRetrieval';
import {createQueryEmbedder} from '../../../../apps/server/src/integrations/queryEmbedding';
import {placeEmbeddingText} from '../../../../apps/server/src/lib/placeEmbeddingText';
import type {PlaceRow} from '../../../../apps/server/src/generation/retrievalRanking';
const read=async(p:string)=>JSON.parse(await readFile(new URL(p,import.meta.url),'utf8'));
const folder='all-cities/batch-62/sync-01/',city='济南';
const output=new URL('priority-cities/济南/remaining-streets-downstream-check-01.json',import.meta.url);
await readFile(output).then(()=>{throw new Error('证据不能覆盖');},(e:NodeJS.ErrnoException)=>{if(e.code!=='ENOENT')throw e;});
const sync=(await read(folder+'sync-state.json')).cities[city];assert.ok(sync.importedAt&&sync.relationsImportedAt&&sync.embeddingRunAt);
const bytes=await readFile(new URL(folder+'xhs-places-济南.json',import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),sync.exportHash);
const exported=JSON.parse(bytes.toString('utf8')).places as PlaceRow[];
const library=await read(folder+'preview-济南/library-before.json'),source=await read('priority-cities/济南/remaining-streets-source-packet-01.json');
const decisions=await read('all-cities/batch-62-decisions.json');
const targets=source.groups.map((g:any)=>g.entity.entity_id);
const scopes=(await Promise.all([36,40,41,42,43,44,45,46,47,48,49,52,53,54,"55-v2","56-v2",57,58,59,60,61,62].map(n=>read(`all-cities/batch-${n}-scope-decisions.json`)))).flat();
const latest=new Map<number,any>();for(const s of scopes)for(const a of s.assignments)latest.set(a.mentionId,{...a,scope:s});
const vectors=await read(folder+'verification-vectors-positive.json');assert.deepEqual(vectors.failures,[]);
assert.equal(vectors.cities[0].vectorProbes.length,3);assert.ok(vectors.cities[0].vectorProbes.every((v:any)=>v.diagnostics.vector==='used'));
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
      if(k==='identity'&&value) {
        const identity=value as {memberNames:string[]};value={...identity,nameKeys:[...new Set([...identity.memberNames,...(expected.payload?.aliases as string[]??[])].map(placeNameKey))]};
      }
      assert.deepEqual(actual.payload?.[k]??null,value,`${actual.name}/${k}`);
    }
  }
  const index=createPlaceIdentityIndex(rows.filter(p=>p.verified||p.payload?.identityWithdrawal));
  const embed=createQueryEmbedder({baseUrl:config.EMBEDDING_BASE_URL||config.SITE_LLM_BASE_URL||'',apiKey:config.EMBEDDING_API_KEY||config.SITE_LLM_API_KEY||'',model:config.EMBEDDING_MODEL||'cf/bge-m3',dims:Number(config.EMBEDDING_DIMS||1024)});
  const retrieve=createPlaceRetriever({query:(sql,args)=>db.query(sql,args),embed});
  const realVectors:unknown[]=[];

  let sqlProbes=0,boundaryProbes=0;const results=[];
  for(const g of source.groups) {
    const eid=g.entity.entity_id,p=byId.get(eid),old=library.tables.canonical_places.find((r:PlaceRow)=>r.id===eid);assert.ok(p&&old);
    const sid=g.entity.primary_place_id,street=sid===5393,withdrawn=sid===5382,ordinary=!street&&!withdrawn;
    assert.equal((p.payload?.identity as any).revision,g.entity.revision+(street?2:sid===6002?0:1));
    const evidence=(await db.query('SELECT kind,content FROM research_evidence WHERE place_id=$1 AND kind LIKE $2',[eid,'xhs_%'])).rows;
    const prior=library.tables.research_evidence.filter((e:any)=>e.place_id===eid&&e.kind.startsWith('xhs_')).map((e:any)=>({kind:e.kind,content:e.content}));
    assertRemainingStreetRow(p,old,sid,evidence,prior);
    const stored=(await db.query("SELECT embedding IS NOT NULL embedded,payload->>'embeddedText' text FROM canonical_places WHERE id=$1",[eid])).rows[0];
    assert.equal(stored.embedded,!withdrawn);if(!withdrawn)assert.equal(stored.text,placeEmbeddingText(p));
    let used='';const hits=await retrieve([p.name],{city,vector:'force',limit:8,onDiagnostics:d=>{used=d.vector;}});assert.equal(used,'used');
    if(withdrawn)assert.ok(hits.every(h=>h.canonicalPlaceId!==eid));else assert.equal(hits[0]?.canonicalPlaceId,eid);
    realVectors.push({name:p.name,entityId:eid,vector:used,withdrawn});
    for(const name of p.payload?.aliases as string[]) {
      const hits=await retrieve([name],{city,vector:'off',limit:24});sqlProbes++;
      if(withdrawn)assert.ok(hits.every(h=>h.canonicalPlaceId!==eid));else assert.equal(hits[0]?.canonicalPlaceId,eid);
      for(const id of [undefined,...(p.payload?.identity as any).memberIds]) {
        const result=index.resolve(city,name,id);
        if(withdrawn){assert.equal(result.status,'unresolved');if(result.status==='unresolved')assert.equal(result.reason,'withdrawn');}
        else{assert.equal(result.status,'resolved');if(result.status==='resolved')assert.equal(result.canonicalPlaceId,eid);}
      }
    }
    const boundaries=street?['济南墙','簪花济南文字墙','后宰门街大字墙']:withdrawn?['油旋张（大观园店）','油旋张（纬三路店）','油旋张油旋']:sid===5353?['芙蓉街鲁菜馆','宽厚里','芙蓉街西更道餐馆']:sid===5403?['腊山河','腊山河西路南延','济南森林公园']:['泉城之眼','泉城之眼·高空观景台','沃德酒店'];
    for(const id of [undefined,...(p.payload?.identity as any).memberIds])for(const name of boundaries){const resolved=index.resolve(city,name,id);assert.ok(resolved.status!=='resolved'||resolved.canonicalPlaceId!==eid);boundaryProbes++;}
    results.push({entityId:eid,name:p.name,withdrawn,ordinaryFactsPreserved:ordinary,confirmed:street?3:0,pending:withdrawn?3:0,preciseLocationNewlyVerified:false});
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
  for(const g of source.groups.flatMap((g:any)=>g.sources))assert.deepEqual((await up.query('SELECT typical_visit_minutes,typical_visit_source,theme_tags,content_profile FROM canonical_place WHERE id=$1',[g.source.id])).rows[0],g.derivedBefore);
  const assignments=(await up.query('SELECT mention_id,entity_id,input_hash,revision,change_key,fact_exclusions FROM place_mention_assignment WHERE mention_id=ANY($1::int[])',[ [...latest.keys()] ])).rows;
  assert.equal(assignments.length,318);
  for(const actual of assignments) {
    const a=latest.get(Number(actual.mention_id));assert.ok(a);assert.equal(actual.entity_id,a.entityId);assert.equal(actual.input_hash,a.inputHash);
    assert.equal(actual.revision,a.scope.sourcePlaceId===5352?2:1);assert.equal(actual.change_key,a.scope.key);assert.deepEqual(actual.fact_exclusions,a.factExclusions??null);
  }
  const graph=(await db.query('SELECT manifest,relations FROM place_relation_snapshots WHERE city=$1',[city])).rows[0];assert.equal(graph.manifest.revision,36);
  const expectedRelations=structuredClone(library.tables.place_relation_snapshots[0].relations);let relationEndpointRevisionsUpdated=0;
  for(const r of expectedRelations)for(const end of ['from','to'])if(r[end+'EntityId']==='747792d1b5834255f5feaa6c2dc62925') {
    assert.equal(r[end+'Revision'],2);r[end+'Revision']=3;relationEndpointRevisionsUpdated++;
    for(const e of r.evidence){assert.equal(e[end].revision,2);e[end].revision=3;}
  }
  assert.equal(relationEndpointRevisionsUpdated,2);assert.deepEqual(graph.relations,expectedRelations);
  const pending=graph.manifest.sourceState.mentions.filter((m:any)=>m.status==='review');assert.equal(pending.length,130);
  const newPending=[11478,11528,12738];
  assert.deepEqual(pending.filter((m:any)=>!newPending.includes(m.mentionId)),library.tables.place_relation_snapshots[0].manifest.sourceState.mentions.filter((m:any)=>m.status==='review'));
  const priorAudit=await read('all-cities/audit/run-60/snapshot.json'),audit=await read('all-cities/audit/run-61/snapshot.json');
  const added=audit.reviews.filter((r:any)=>!priorAudit.reviews.some((p:any)=>p.id===r.id));
  assert.equal(added.length,3);assert.ok(added.every((r:any)=>r.status==='PENDING'));
  assert.deepEqual(added.map((r:any)=>r.detail.mentionId).sort((a:number,b:number)=>a-b),[...newPending].sort((a,b)=>a-b));
  assert.deepEqual(audit.reviews.filter((r:any)=>!added.some((a:any)=>a.id===r.id)),priorAudit.reviews);
  const sourceIds=[5393,5382];
  assert.deepEqual(audit.scopes.filter((r:any)=>!sourceIds.includes(Number(r.place_id))),priorAudit.scopes);
  assert.deepEqual(audit.scopeSources,priorAudit.scopeSources);
  for(const g of source.groups.filter((g:any)=>sourceIds.includes(g.entity.primary_place_id))) {
    const sid=g.entity.primary_place_id,scope=audit.scopes.find((r:any)=>Number(r.place_id)===sid);
    assert.ok(scope);assert.equal(scope.revision,1);assert.deepEqual(scope.entity_ids,[g.entity.entity_id]);assert.deepEqual(scope.name_keys,g.nameKeys);
    const row=(await up.query('SELECT source_hash,revision,change_key FROM place_identity_scope WHERE place_id=$1',[sid])).rows[0];
    assert.equal(row.source_hash,g.sources[0].sourceHash);assert.equal(row.revision,1);assert.equal(row.change_key,`all-cities-20261009-batch-62-source-${sid}-scope`);
  }
  const trips=(await db.query("SELECT count(*)::int count,md5(COALESCE(string_agg(h,'' ORDER BY h),'')) digest FROM (SELECT md5(to_jsonb(t)::text) h FROM trips t) x")).rows[0];
  assert.deepEqual(trips,(await read(folder+'pre-import-check.json')).trips);
  const report={batch:62,readOnly:true,at:new Date().toISOString(),consumedFieldsVerified:exported.length,fields,results,assignmentRows:318,pendingMentions:130,
    scopesAdded:2,confirmed:3,pendingAdded:3,coordinatesCleared:0,withdrawals:1,withdrawnCoordinatesRemoved:1,newPreciseLocations:0,categoriesCorrected:3,readOnlyBoundaryPending:1,sqlProbes,boundaryProbes,realVectorProbes:realVectors.length,realVectors,graph:19,directEdges:3,
    relationEvidenceAndStrengthPreserved:true,relationEndpointRevisionsUpdated,priorReviewRowsPreserved:true,rawDerivedCachesPreserved:true,confirmedFactsAndDatesPreserved:true,unresolvedBranchFactsRemoved:true,furongNegativeOpinionsPreserved:true,furongDescriptionGovernanceDeferred:true,
    fallbackObservedAtChanges,trips,imageComparison:'deferred_by_user',fullReviewPassed:false,failures:[]};
  await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...report,fallbackObservedAtChanges:fallbackObservedAtChanges.length}));
} finally {await db.query('ROLLBACK').catch(()=>{});await up.query('ROLLBACK').catch(()=>{});await db.end();await up.end();}
