// 第54批实际消费：同名多位置范围、明确提及保留、旧分配和来源日期保持。
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
const folder='all-cities/batch-54/sync-01/',city='济南';
const output=new URL('priority-cities/济南/beverage-branches-downstream-check-01.json',import.meta.url);
await readFile(output).then(()=>{throw new Error('证据不能覆盖');},(e:NodeJS.ErrnoException)=>{if(e.code!=='ENOENT')throw e;});
const sync=(await read(folder+'sync-state.json')).cities[city];assert.ok(sync.importedAt&&sync.relationsImportedAt&&sync.embeddingRunAt);
const bytes=await readFile(new URL(folder+'xhs-places-济南.json',import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),sync.exportHash);
const exported=JSON.parse(bytes.toString('utf8')).places as PlaceRow[];
const library=await read(folder+'preview-济南/library-before.json'),source=await read('all-cities/batch-54-source.json');
const decisions=await read('all-cities/batch-54-decisions.json');
const targets=source.groups.map((g:any)=>g.entity.entity_id);
const scopes=(await Promise.all([36,40,41,42,43,44,45,46,47,48,49,52,53,54].map(n=>read(`all-cities/batch-${n}-scope-decisions.json`)))).flat();
const latest=new Map<number,any>();for(const s of scopes)for(const a of s.assignments)latest.set(a.mentionId,{...a,scope:s});
const vectors=await read(folder+'verification-vectors.json');assert.deepEqual(vectors.failures,[]);
assert.equal(vectors.cities[0].vectorProbes.length,2);assert.ok(vectors.cities[0].vectorProbes.every((v:any)=>v.diagnostics.vector==='used'));
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
    const decision=decisions.find((d:any)=>d.entityId===eid);
    const expectedMentions=g.mentionIds;
    assert.equal((p.payload?.identity as any).revision,3);assert.equal(p.name,decision.canonicalName);
    assert.equal(p.category,'美食');assert.equal(p.payload?.xhsPlaceType,'cafe');assert.equal(p.verified,true);
    assert.ok(old.lat&&old.lng);assert.equal(p.lat,null);assert.equal(p.lng,null);assert.equal(p.payload?.address,'融汇济南老商埠');assert.equal(p.payload?.geoStatus,'unresolvable');
    assert.deepEqual([...(p.payload?.aliases as string[])].sort(),[...decision.aliases].sort());
    assert.equal(old.payload.mentionCount,g.mentionIds.length);assert.equal(p.payload?.mentionCount,expectedMentions.length);
    assert.deepEqual((p.payload?.mentionSources as any[]).map(m=>m.mentionId).sort((a,b)=>a-b),expectedMentions);
    assert.equal(p.payload?.typicalVisitMinutes,undefined);assert.deepEqual(p.payload?.themes,[]);assert.deepEqual((p.payload?.imageIdentity as any).approved,[]);
    assert.doesNotMatch(JSON.stringify(p.payload),/雕塑|老爷车|天桥|恒隆广场/);
    assert.match(JSON.stringify(old.payload.topReasons),eid==='9626de365121d40b3565b4a7dbc5be1a'?/雕塑|老爷车/:/天桥/);
    assert.equal(old.payload.content.intro,'');assert.deepEqual(old.payload.content.highlights,[]);
    assert.equal(source.mentions.find((m:any)=>m.id===g.mentionIds[0]).fact_value.placeContent.highlights.length,1);
    assert.deepEqual(p.payload?.topReasons,[]);
    const content=p.payload?.content as any;assert.equal(content.intro,'');assert.deepEqual(content.highlights,[]);
    const evidence=(await db.query('SELECT kind,content FROM research_evidence WHERE place_id=$1 AND kind LIKE $2',[eid,'xhs_%'])).rows;
    assert.deepEqual(evidence,[]);
    const boundaries=eid==='9626de365121d40b3565b4a7dbc5be1a'?['喜茶（恒隆广场店）','喜茶(济南融汇老商埠店)旁','爱心雕塑','老爷车','山耶云耶(融汇济南老商埠店)']:['山耶云耶（泉城路店）','山耶云耶(融汇济南老商埠店)旁','马力欧像素天桥','爱心天桥','喜茶(济南融汇老商埠店)'];
    for(const name of p.payload?.aliases as string[]) {
      const hits=await retrieve([name],{city,vector:'off',limit:24});assert.equal(hits[0]?.canonicalPlaceId,eid);sqlProbes++;
      for(const id of [undefined,...(p.payload?.identity as any).memberIds]) {
        const resolved=index.resolve(city,name,id);assert.equal(resolved.status,'resolved');if(resolved.status==='resolved')assert.equal(resolved.canonicalPlaceId,eid);
      }
    }
    for(const id of [undefined,...(p.payload?.identity as any).memberIds])for(const name of boundaries) {
      const result=index.resolve(city,name,id);assert.ok(result.status!=='resolved'||result.canonicalPlaceId!==eid);boundaryProbes++;
    }
    results.push({entityId:eid,name:p.name,oldName:old.name,category:p.category,type:p.payload?.xhsPlaceType,confirmed:expectedMentions.length,pending:g.mentionIds.length-expectedMentions.length,wrongPointClearedPreciseLocationPending:true});
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
  assert.equal(assignments.length,280);
  for(const actual of assignments) {
    const a=latest.get(Number(actual.mention_id));assert.ok(a);assert.equal(actual.entity_id,a.entityId);assert.equal(actual.input_hash,a.inputHash);
    assert.equal(actual.revision,a.scope.sourcePlaceId===5352?2:1);assert.equal(actual.change_key,a.scope.key);assert.deepEqual(actual.fact_exclusions,a.factExclusions??null);
  }
  const graph=(await db.query('SELECT manifest,relations FROM place_relation_snapshots WHERE city=$1',[city])).rows[0];assert.equal(graph.manifest.revision,28);
  assert.deepEqual(graph.relations,library.tables.place_relation_snapshots[0].relations);
  const pending=graph.manifest.sourceState.mentions.filter((m:any)=>m.status==='review');assert.equal(pending.length,112);
  assert.deepEqual(pending,library.tables.place_relation_snapshots[0].manifest.sourceState.mentions.filter((m:any)=>m.status==='review'));
  const priorAudit=await read('all-cities/audit/run-52/snapshot.json'),audit=await read('all-cities/audit/run-53/snapshot.json');
  assert.deepEqual(audit.reviews,priorAudit.reviews);
  const sourceIds=source.sources.map((g:any)=>g.source.id);
  assert.deepEqual(audit.scopes.filter((r:any)=>!sourceIds.includes(Number(r.place_id))),priorAudit.scopes);
  assert.deepEqual(audit.scopeSources,priorAudit.scopeSources);
  for(const g of source.groups) {
    const sid=g.entity.primary_place_id,scope=audit.scopes.find((r:any)=>Number(r.place_id)===sid);
    assert.ok(scope);assert.equal(scope.revision,1);assert.deepEqual(scope.entity_ids,[g.entity.entity_id]);assert.deepEqual(scope.name_keys,g.nameKeys);
    const row=(await up.query('SELECT source_hash,revision,change_key FROM place_identity_scope WHERE place_id=$1',[sid])).rows[0];
    assert.equal(row.source_hash,g.sources[0].sourceHash);assert.equal(row.revision,1);assert.equal(row.change_key,`all-cities-20261009-batch-54-source-${sid}-scope`);
  }
  const trips=(await db.query("SELECT count(*)::int count,md5(COALESCE(string_agg(h,'' ORDER BY h),'')) digest FROM (SELECT md5(to_jsonb(t)::text) h FROM trips t) x")).rows[0];
  assert.deepEqual(trips,(await read(folder+'pre-import-check.json')).trips);
  const report={batch:54,readOnly:true,at:new Date().toISOString(),consumedFieldsVerified:exported.length,fields,results,assignmentRows:280,pendingMentions:112,
    scopesAdded:2,confirmed:2,pendingAdded:0,coordinatesCleared:2,newPreciseLocations:0,categoriesCorrected:0,addressesCorrected:2,sqlProbes,boundaryProbes,realVectorProbes:2,graph:18,directEdges:3,
    relationEvidenceAndStrengthPreserved:true,priorReviewRowsPreserved:true,rawDerivedCachesPreserved:true,navigationFactsExcluded:true,confirmedIdentityPreserved:true,
    fallbackObservedAtChanges,fallbackObservedAtMeaning:'非本批看点来源日期保持；本批隔离装置描述，原资料保留，compiledAt随导出更新。',trips,
    imageComparison:'deferred_by_user',fullReviewPassed:false,failures:[]};
  await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...report,fallbackObservedAtChanges:fallbackObservedAtChanges.length}));
} finally {await db.query('ROLLBACK').catch(()=>{});await up.query('ROLLBACK').catch(()=>{});await db.end();await up.end();}
