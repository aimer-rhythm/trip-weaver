// 第60批实际库核对：未定位品牌撤回、济南西提及保留、陈氏只读。
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
const folder='all-cities/batch-60/sync-01/',city='济南';
const output=new URL('priority-cities/济南/remaining-food-downstream-check-01.json',import.meta.url);
await readFile(output).then(()=>{throw new Error('证据不能覆盖');},(e:NodeJS.ErrnoException)=>{if(e.code!=='ENOENT')throw e;});
const sync=(await read(folder+'sync-state.json')).cities[city];assert.ok(sync.importedAt&&sync.relationsImportedAt&&sync.embeddingRunAt);
const bytes=await readFile(new URL(folder+'xhs-places-济南.json',import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),sync.exportHash);
const exported=JSON.parse(bytes.toString('utf8')).places as PlaceRow[];
const library=await read(folder+'preview-济南/library-before.json'),source=await read('priority-cities/济南/remaining-food-source-packet-01.json');
const decisions=await read('all-cities/batch-60-decisions.json');
const targets=source.groups.map((g:any)=>g.entity.entity_id);
const scopes=(await Promise.all([36,40,41,42,43,44,45,46,47,48,49,52,53,54,"55-v2","56-v2",57,58,59,60].map(n=>read(`all-cities/batch-${n}-scope-decisions.json`)))).flat();
const latest=new Map<number,any>();for(const s of scopes)for(const a of s.assignments)latest.set(a.mentionId,{...a,scope:s});
const vectors=await read(folder+'verification-vectors.json');assert.deepEqual(vectors.failures,[]);
assert.equal(vectors.cities[0].vectorProbes.length,1);assert.ok(vectors.cities[0].vectorProbes.every((v:any)=>v.diagnostics.vector==='used'));
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
    const west=eid==='b8880b34d9a4e56942c76ea7a4e5555c',ordinary=eid==='d342ff3eb8d541f17253786d0dd148fa',withdrawn=!west&&!ordinary;
    assert.equal(p.name,g.entity.canonical_name);assert.equal((p.payload?.identity as any).revision,west?3:ordinary?1:2);
    assert.deepEqual(p.payload?.aliases,g.entity.aliases);assert.equal((p.payload?.identity as any).memberIds.length,1);
    const evidence=(await db.query('SELECT kind,content FROM research_evidence WHERE place_id=$1 AND kind LIKE $2',[eid,'xhs_%'])).rows;
    const stored=(await db.query("SELECT embedding IS NOT NULL embedded,payload->>'embeddedText' text FROM canonical_places WHERE id=$1",[eid])).rows[0];
    if(withdrawn) {
      assert.equal(p.verified,false);assert.equal(p.category,'其他');assert.equal(p.payload?.xhsPlaceType,undefined);assert.equal(p.lat,null);assert.equal(p.lng,null);
      assert.deepEqual(p.payload?.identityWithdrawal,{version:1,revision:2,reason:'unavailable_source',candidateIds:[]});
      assert.deepEqual(p.payload?.mentionSources,[]);assert.deepEqual((p.payload?.imageIdentity as any).approved,[]);assert.equal(evidence.length,0);assert.equal(stored.embedded,false);
      for(const field of ['content','topReasons','address','openHours','reservation','reservationNote','price','tips','typicalVisitMinutes'])assert.ok(!p.payload?.[field],p.name+'/'+field);
    } else {
      assert.equal(p.verified,true);assert.equal(p.category,'美食');assert.equal(p.payload?.xhsPlaceType,'food');
      assert.equal(stored.embedded,true);assert.equal(stored.text,placeEmbeddingText(p));
      if(west) {
        assert.equal(p.lat,null);assert.equal(p.lng,null);assert.equal(p.payload?.address,'济南西周边');assert.equal(p.payload?.geoStatus,'unresolvable');
        assert.deepEqual((p.payload?.mentionSources as any[]).map(m=>m.mentionId),[11375]);assert.equal(p.payload?.mentionCount,1);
        assert.deepEqual((p.payload?.content as any).highlights,old.payload.content.highlights.slice(0,2));
        assert.deepEqual(evidence,[{kind:'xhs_reason',content:'20年老店，本地人推荐，菜品美味分量足'}]);
        assert.ok(!JSON.stringify(p.payload).includes('本地人私藏20年老牌鲁菜馆，家常菜地道入味，分量实在性价比高'));
        for(const field of ['openHours','reservation','reservationNote','reservationEvidence','reservationConflict','price','tips','typicalVisitMinutes'])assert.deepEqual(p.payload?.[field],old.payload[field]);
      } else {
        assert.equal(p.lat,old.lat);assert.equal(p.lng,old.lng);assert.equal(p.payload?.address,old.payload.address);assert.equal(p.payload?.mentionSources,undefined);
        for(const field of fields.filter(f=>f!=='identity'&&f!=='content'))assert.deepEqual(p.payload?.[field],old.payload[field]);
        const content=structuredClone(old.payload.content);content.compiledAt=(p.payload?.content as any).compiledAt;assert.deepEqual(p.payload?.content,content);
        const prior=library.tables.research_evidence.filter((e:any)=>e.place_id===eid&&e.kind.startsWith('xhs_')).map((e:any)=>({kind:e.kind,content:e.content}));
        assert.deepEqual(new Set(evidence.map(e=>JSON.stringify(e))),new Set(prior.map((e:any)=>JSON.stringify(e))));
      }
    }
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
    const boundaries=west?['天天过年（梁庄店）','天天过年（沂蒙路店）','天天过年停车场']:ordinary?['陈氏鲁菜','陈氏肥蛤停车场','老船长小海鲜']:
      [p.name+'（总店）',p.name+'（大明湖店）',p.name+'停车场'];
    for(const id of [undefined,...(p.payload?.identity as any).memberIds])for(const name of boundaries){const resolved=index.resolve(city,name,id);assert.ok(resolved.status!=='resolved'||resolved.canonicalPlaceId!==eid);boundaryProbes++;}
    results.push({entityId:eid,name:p.name,withdrawn,ordinaryUnchanged:ordinary,confirmed:west?1:ordinary?2:0,pending:ordinary?0:west?1:g.mentionIds.length,preciseLocationNewlyVerified:false});
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
  assert.equal(assignments.length,310);
  for(const actual of assignments) {
    const a=latest.get(Number(actual.mention_id));assert.ok(a);assert.equal(actual.entity_id,a.entityId);assert.equal(actual.input_hash,a.inputHash);
    assert.equal(actual.revision,a.scope.sourcePlaceId===5352?2:1);assert.equal(actual.change_key,a.scope.key);assert.deepEqual(actual.fact_exclusions,a.factExclusions??null);
  }
  const graph=(await db.query('SELECT manifest,relations FROM place_relation_snapshots WHERE city=$1',[city])).rows[0];assert.equal(graph.manifest.revision,34);
  assert.deepEqual(graph.relations,library.tables.place_relation_snapshots[0].relations);
  const pending=graph.manifest.sourceState.mentions.filter((m:any)=>m.status==='review');assert.equal(pending.length,126);
  const newPending=[11391,11477,11524,12737,11384,11526,11480,12740,12806];
  assert.deepEqual(pending.filter((m:any)=>!newPending.includes(m.mentionId)),library.tables.place_relation_snapshots[0].manifest.sourceState.mentions.filter((m:any)=>m.status==='review'));
  const priorAudit=await read('all-cities/audit/run-58/snapshot.json'),audit=await read('all-cities/audit/run-59/snapshot.json');
  const added=audit.reviews.filter((r:any)=>!priorAudit.reviews.some((p:any)=>p.id===r.id));
  assert.equal(added.length,9);assert.ok(added.every((r:any)=>r.status==='PENDING'));
  assert.deepEqual(added.map((r:any)=>r.detail.mentionId).sort((a:number,b:number)=>a-b),[...newPending].sort((a,b)=>a-b));
  assert.deepEqual(audit.reviews.filter((r:any)=>!added.some((a:any)=>a.id===r.id)),priorAudit.reviews);
  const sourceIds=[5378,5377,5384,5401];
  assert.deepEqual(audit.scopes.filter((r:any)=>!sourceIds.includes(Number(r.place_id))),priorAudit.scopes);
  assert.deepEqual(audit.scopeSources,priorAudit.scopeSources);
  for(const g of source.groups.filter((g:any)=>sourceIds.includes(g.entity.primary_place_id))) {
    const sid=g.entity.primary_place_id,scope=audit.scopes.find((r:any)=>Number(r.place_id)===sid);
    assert.ok(scope);assert.equal(scope.revision,1);assert.deepEqual(scope.entity_ids,[g.entity.entity_id]);assert.deepEqual(scope.name_keys,g.nameKeys);
    const row=(await up.query('SELECT source_hash,revision,change_key FROM place_identity_scope WHERE place_id=$1',[sid])).rows[0];
    assert.equal(row.source_hash,g.sources[0].sourceHash);assert.equal(row.revision,1);assert.equal(row.change_key,`all-cities-20261009-batch-60-source-${sid}-scope`);
  }
  const trips=(await db.query("SELECT count(*)::int count,md5(COALESCE(string_agg(h,'' ORDER BY h),'')) digest FROM (SELECT md5(to_jsonb(t)::text) h FROM trips t) x")).rows[0];
  assert.deepEqual(trips,(await read(folder+'pre-import-check.json')).trips);
  const report={batch:60,readOnly:true,at:new Date().toISOString(),consumedFieldsVerified:exported.length,fields,results,assignmentRows:310,pendingMentions:126,
    scopesAdded:4,confirmed:1,pendingAdded:9,coordinatesCleared:1,withdrawals:3,withdrawnCoordinatesRemoved:3,newPreciseLocations:0,categoriesCorrected:0,ordinaryReviewed:1,sqlProbes,boundaryProbes,realVectorProbes:realVectors.length,realVectors,graph:19,directEdges:3,
    relationEvidenceAndStrengthPreserved:true,priorReviewRowsPreserved:true,rawDerivedCachesPreserved:true,confirmedFactsAndDatesPreserved:true,unresolvedBranchFactsRemoved:true,
    fallbackObservedAtChanges,trips,imageComparison:'deferred_by_user',fullReviewPassed:false,failures:[]};
  await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...report,fallbackObservedAtChanges:fallbackObservedAtChanges.length}));
} finally {await db.query('ROLLBACK').catch(()=>{});await up.query('ROLLBACK').catch(()=>{});await db.end();await up.end();}
