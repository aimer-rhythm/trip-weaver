// 第57批实际消费：同名多位置范围、明确提及保留、旧分配和来源日期保持。
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
const folder='all-cities/batch-57/sync-01/',city='济南';
const output=new URL('priority-cities/济南/restaurant-branches-downstream-check-01.json',import.meta.url);
await readFile(output).then(()=>{throw new Error('证据不能覆盖');},(e:NodeJS.ErrnoException)=>{if(e.code!=='ENOENT')throw e;});
const sync=(await read(folder+'sync-state.json')).cities[city];assert.ok(sync.importedAt&&sync.relationsImportedAt&&sync.embeddingRunAt);
const bytes=await readFile(new URL(folder+'xhs-places-济南.json',import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),sync.exportHash);
const exported=JSON.parse(bytes.toString('utf8')).places as PlaceRow[];
const library=await read(folder+'preview-济南/library-before.json'),source=await read('all-cities/batch-57-source.json');
const decisions=await read('all-cities/batch-57-decisions.json');
const targets=source.groups.map((g:any)=>g.entity.entity_id);
const scopes=(await Promise.all([36,40,41,42,43,44,45,46,47,48,49,52,53,54,"55-v2","56-v2",57].map(n=>read(`all-cities/batch-${n}-scope-decisions.json`)))).flat();
const latest=new Map<number,any>();for(const s of scopes)for(const a of s.assignments)latest.set(a.mentionId,{...a,scope:s});
const vectors=await read(folder+'verification-vectors.json');assert.deepEqual(vectors.failures,[]);
assert.equal(vectors.cities[0].vectorProbes.length,3);assert.ok(vectors.cities[0].vectorProbes.every((v:any)=>v.diagnostics.vector==='used'));
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
    const expectedMentions=g.mentionIds.filter((id:number)=>![11481,11525,12741,12798].includes(id));
    assert.equal((p.payload?.identity as any).revision,3);assert.equal(p.name,decision.canonicalName);
    assert.equal(p.category,'美食');assert.equal(p.payload?.xhsPlaceType,'food');assert.equal(p.verified,true);
    assert.ok(old.lat&&old.lng);assert.equal(p.lat,null);assert.equal(p.lng,null);assert.equal(p.payload?.address,decision.overrides.address);assert.equal(p.payload?.geoStatus,'unresolvable');assert.equal((p.payload?.identity as any).memberIds.length,2);
    assert.deepEqual([...(p.payload?.aliases as string[])].sort(),[...decision.aliases].sort());
    assert.equal(old.payload.mentionCount,g.mentionIds.length);assert.equal(p.payload?.mentionCount,expectedMentions.length);
    assert.deepEqual((p.payload?.mentionSources as any[]).map(m=>m.mentionId).sort((a,b)=>a-b),expectedMentions);
    assert.equal(p.payload?.typicalVisitMinutes,undefined);assert.deepEqual(p.payload?.themes,[]);assert.deepEqual((p.payload?.imageIdentity as any).approved,[]);
    assert.doesNotMatch(JSON.stringify(p.payload),/位于Day2路线中，是济南鲁菜代表|济南特色美食店铺推荐|骨汤浓郁，拉面劲道牛肉大块/);
    const expected=exported.find(e=>e.id===eid)!;
    const content=p.payload?.content as any;
    const observed=source.mentions.filter((m:any)=>expectedMentions.includes(m.id)).map((m:any)=>m.observed_at);
    assert.ok(content.highlights.every((h:any)=>observed.includes(h.observedAt)));
    assert.equal(content.highlights.length,1);
    const evidence=(await db.query('SELECT kind,content FROM research_evidence WHERE place_id=$1 AND kind LIKE $2',[eid,'xhs_%'])).rows;
    assert.deepEqual(evidence.map(e=>e.content).sort(),source.mentions.filter((m:any)=>expectedMentions.includes(m.id)).map((m:any)=>m.reason).sort());
    const priorEvidence=library.tables.research_evidence.filter((e:any)=>e.place_id===eid&&e.kind.startsWith('xhs_'));
    assert.equal(priorEvidence.length,eid==='92a39f8f2d95070cc627828807686bac'?2:1);
    const pendingReason=eid==='84929fb3085880c48c0cebb71aae3ad4'?'位于Day2路线中，是济南鲁菜代表':eid==='58d542ebe18a1dd3505b7cdc60db030c'?'济南特色美食店铺推荐':'骨汤浓郁，拉面劲道牛肉大块';
    assert.ok(priorEvidence.some((e:any)=>e.content===pendingReason));assert.ok(!evidence.some(e=>e.content===pendingReason));
    const isolated=(await read('all-cities/batch-57/scope-preview-1791495417422987800/xhs-places-济南.json')).places.find((r:any)=>r.id===eid);
    const isolatedContent=structuredClone(isolated.payload.content);isolatedContent.compiledAt=content.compiledAt;assert.deepEqual(content,isolatedContent);
    const boundaries=eid==='84929fb3085880c48c0cebb71aae3ad4'?['燕喜堂（金菊巷店）','燕喜堂（CBD店）旁','燕喜堂（泉城路店）']:
      eid==='58d542ebe18a1dd3505b7cdc60db030c'?['刘小忙把子肉（馆驿街店）','刘小忙把子肉（联四路）旁','刘小忙把子肉（制锦市店）']:
      ['亮亮拉面（经六路店）','亮亮拉面（小纬十一路）','亮亮拉面（经十一路）旁'];
    for(const name of p.payload?.aliases as string[]) {
      const hits=await retrieve([name],{city,vector:'off',limit:24});assert.equal(hits[0]?.canonicalPlaceId,eid);sqlProbes++;
      for(const id of [undefined,...(p.payload?.identity as any).memberIds]) {
        const resolved=index.resolve(city,name,id);assert.equal(resolved.status,'resolved');if(resolved.status==='resolved')assert.equal(resolved.canonicalPlaceId,eid);
      }
    }
    for(const id of [undefined,...(p.payload?.identity as any).memberIds])for(const name of boundaries) {
      const result=index.resolve(city,name,id);assert.ok(result.status!=='resolved'||result.canonicalPlaceId!==eid);boundaryProbes++;
    }
    results.push({entityId:eid,name:p.name,oldName:old.name,category:p.category,type:p.payload?.xhsPlaceType,confirmed:expectedMentions.length,pending:g.mentionIds.length-expectedMentions.length,unsupportedBranchPointClearedPreciseLocationPending:true});
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
  assert.equal(assignments.length,293);
  for(const actual of assignments) {
    const a=latest.get(Number(actual.mention_id));assert.ok(a);assert.equal(actual.entity_id,a.entityId);assert.equal(actual.input_hash,a.inputHash);
    assert.equal(actual.revision,a.scope.sourcePlaceId===5352?2:1);assert.equal(actual.change_key,a.scope.key);assert.deepEqual(actual.fact_exclusions,a.factExclusions??null);
  }
  const graph=(await db.query('SELECT manifest,relations FROM place_relation_snapshots WHERE city=$1',[city])).rows[0];assert.equal(graph.manifest.revision,31);
  const previousGraph=library.tables.place_relation_snapshots[0].relations;
  for(const r of previousGraph)assert.ok(graph.relations.some((n:any)=>JSON.stringify(n)===JSON.stringify(r)));
  const added=graph.relations.filter((r:any)=>!previousGraph.some((n:any)=>JSON.stringify(n)===JSON.stringify(r)));
  assert.equal(added.length,1);assert.equal(added[0].strength,'weak');assert.equal(added[0].noteCount,1);
  assert.deepEqual([added[0].fromEntityId,added[0].toEntityId].sort(),['6ed737543bd4e4f550f0fd357c9e8c71','84929fb3085880c48c0cebb71aae3ad4'].sort());
  assert.equal(added[0].evidence[0].noteId,2830);assert.equal(added[0].evidence[0].quote,'燕喜堂（CBD店）→山东博物馆');
  const pending=graph.manifest.sourceState.mentions.filter((m:any)=>m.status==='review');assert.equal(pending.length,116);
  assert.deepEqual(pending.filter((m:any)=>![11481,11525,12741,12798].includes(m.mentionId)),library.tables.place_relation_snapshots[0].manifest.sourceState.mentions.filter((m:any)=>m.status==='review'));
  const priorAudit=await read('all-cities/audit/run-55/snapshot.json'),audit=await read('all-cities/audit/run-56/snapshot.json');
  const newReviews=audit.reviews.filter((r:any)=>!priorAudit.reviews.some((old:any)=>old.id===r.id));
  assert.equal(newReviews.length,4);assert.deepEqual(newReviews.map((r:any)=>r.detail.mentionId).sort((a:number,b:number)=>a-b),[11481,11525,12741,12798]);
  assert.ok(newReviews.every((r:any)=>r.status==='PENDING'));
  assert.deepEqual(audit.reviews.filter((r:any)=>!newReviews.some((n:any)=>n.id===r.id)),priorAudit.reviews);
  const sourceIds=source.sources.map((g:any)=>g.source.id);
  assert.deepEqual(audit.scopes.filter((r:any)=>!sourceIds.includes(Number(r.place_id))),priorAudit.scopes);
  assert.deepEqual(audit.scopeSources,priorAudit.scopeSources);
  for(const g of source.groups) {
    const sid=g.entity.primary_place_id,scope=audit.scopes.find((r:any)=>Number(r.place_id)===sid);
    assert.ok(scope);assert.equal(scope.revision,1);assert.deepEqual(scope.entity_ids,[g.entity.entity_id]);assert.deepEqual(scope.name_keys,g.nameKeys);
    const row=(await up.query('SELECT source_hash,revision,change_key FROM place_identity_scope WHERE place_id=$1',[sid])).rows[0];
    assert.equal(row.source_hash,g.sources[0].sourceHash);assert.equal(row.revision,1);assert.equal(row.change_key,`all-cities-20261009-batch-57-source-${sid}-scope`);
  }
  const trips=(await db.query("SELECT count(*)::int count,md5(COALESCE(string_agg(h,'' ORDER BY h),'')) digest FROM (SELECT md5(to_jsonb(t)::text) h FROM trips t) x")).rows[0];
  assert.deepEqual(trips,(await read(folder+'pre-import-check.json')).trips);
  const report={batch:57,readOnly:true,at:new Date().toISOString(),consumedFieldsVerified:exported.length,fields,results,assignmentRows:293,pendingMentions:116,
    scopesAdded:3,confirmed:4,pendingAdded:4,coordinatesCleared:3,newPreciseLocations:0,categoriesCorrected:0,addressesCorrected:3,sqlProbes,boundaryProbes,realVectorProbes:3,graph:19,directEdges:3,
    priorRelationEvidenceAndStrengthPreserved:true,weakRelationAdded:1,priorReviewRowsPreserved:true,rawDerivedCachesPreserved:true,confirmedFactsPreserved:true,
    fallbackObservedAtChanges,fallbackObservedAtMeaning:'保留看点的来源日期保持；本批隔离四条未确认分店提及的内容，compiledAt随导出更新。',trips,
    imageComparison:'deferred_by_user',fullReviewPassed:false,failures:[]};
  await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...report,fallbackObservedAtChanges:fallbackObservedAtChanges.length}));
} finally {await db.query('ROLLBACK').catch(()=>{});await up.query('ROLLBACK').catch(()=>{});await db.end();await up.end();}
