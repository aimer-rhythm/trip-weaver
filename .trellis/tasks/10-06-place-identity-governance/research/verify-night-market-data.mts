// 第59批实际消费：迁址名称地址、旧导航待审、三条负评保留。
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
const folder='all-cities/batch-59/sync-01/',city='济南';
const output=new URL('priority-cities/济南/night-market-downstream-check-01.json',import.meta.url);
await readFile(output).then(()=>{throw new Error('证据不能覆盖');},(e:NodeJS.ErrnoException)=>{if(e.code!=='ENOENT')throw e;});
const sync=(await read(folder+'sync-state.json')).cities[city];assert.ok(sync.importedAt&&sync.relationsImportedAt&&sync.embeddingRunAt);
const bytes=await readFile(new URL(folder+'xhs-places-济南.json',import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),sync.exportHash);
const exported=JSON.parse(bytes.toString('utf8')).places as PlaceRow[];
const library=await read(folder+'preview-济南/library-before.json'),source=await read('all-cities/batch-59-source.json');
const decisions=await read('all-cities/batch-59-decisions.json');
const targets=source.groups.map((g:any)=>g.entity.entity_id);
const scopes=(await Promise.all([36,40,41,42,43,44,45,46,47,48,49,52,53,54,"55-v2","56-v2",57,58,59].map(n=>read(`all-cities/batch-${n}-scope-decisions.json`)))).flat();
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
  const retrieve=createPlaceRetriever({query:(sql,args)=>db.query(sql,args),embed:async()=>{throw new Error('本探针只允许SQL检索');}});
  let sqlProbes=0,boundaryProbes=0;const results=[];
  for(const g of source.groups) {
    const eid=g.entity.entity_id,p=byId.get(eid),old=library.tables.canonical_places.find((r:PlaceRow)=>r.id===eid);assert.ok(p&&old);
    const decision=decisions.find((d:any)=>d.entityId===eid);
    const expectedMentions=[11571,11607,12647,12825];
    assert.equal((p.payload?.identity as any).revision,3);assert.equal(p.name,decision.canonicalName);
    assert.equal(p.category,'购物');assert.equal(p.payload?.xhsPlaceType,'market');assert.equal(p.verified,true);
    assert.equal(p.lat,old.lat);assert.equal(p.lng,old.lng);assert.equal(p.payload?.address,'祝舜路555号');
    assert.equal(p.payload?.geoStatus,old.payload.geoStatus);assert.equal((p.payload?.identity as any).memberIds.length,2);
    assert.deepEqual([...(p.payload?.aliases as string[])].sort(),[...decision.aliases].sort());
    assert.equal(old.payload.mentionCount,5);assert.equal(p.payload?.mentionCount,4);
    assert.deepEqual((p.payload?.mentionSources as any[]).map(m=>m.mentionId).sort((a,b)=>a-b),expectedMentions);
    assert.equal(p.payload?.typicalVisitMinutes,undefined);assert.deepEqual(p.payload?.themes,[]);assert.deepEqual((p.payload?.imageIdentity as any).approved,[]);
    const staleReason=source.mentions.find((m:any)=>m.id===11464).reason;
    assert.match(old.payload.content.intro,/祝舜路1469号/);assert.match(old.payload.content.intro,/祝甸站B口/);
    assert.doesNotMatch(JSON.stringify(p.payload),/祝舜路1469号|祝甸站/);assert.ok(!JSON.stringify(p.payload).includes(staleReason));
    const content=p.payload?.content as any;
    assert.deepEqual(content.highlights,old.payload.content.highlights.slice(2));assert.equal(content.highlights.length,1);
    const evidence=(await db.query('SELECT kind,content FROM research_evidence WHERE place_id=$1 AND kind LIKE $2',[eid,'xhs_%'])).rows;
    const expectedEvidence=source.mentions.filter((m:any)=>expectedMentions.includes(m.id)).map((m:any)=>({kind:m.sentiment==='negative'?'xhs_warning':'xhs_reason',content:m.reason}));
    assert.deepEqual(new Set(evidence.map(e=>JSON.stringify(e))),new Set(expectedEvidence.map((e:any)=>JSON.stringify(e))));
    assert.equal(evidence.length,4);assert.equal(evidence.filter(e=>e.kind==='xhs_warning').length,3);
    const priorEvidence=library.tables.research_evidence.filter((e:any)=>e.place_id===eid&&e.kind.startsWith('xhs_'));
    assert.equal(priorEvidence.length,5);assert.ok(priorEvidence.some((e:any)=>e.content===staleReason));assert.ok(!evidence.some(e=>e.content===staleReason));
    const isolated=(await read('all-cities/batch-59/scope-preview-1791496913081962100/xhs-places-济南.json')).places.find((r:any)=>r.id===eid);
    const isolatedContent=structuredClone(isolated.payload.content);isolatedContent.compiledAt=content.compiledAt;assert.deepEqual(content,isolatedContent);
    for(const field of ['price','tips','reservation','reservationNote','reservationEvidence','reservationConflict'])assert.deepEqual(p.payload?.[field],old.payload[field]);
    assert.deepEqual(p.payload?.openHours,{...old.payload.openHours,subject:p.name});
    const boundaries=['环联夜市（祝舜路1469号）','环联夜市旧址','环联1904火车夜市停车场','环联夜市公交站','大学城夜市','济南老商埠','八涧堡站'];
    for(const name of p.payload?.aliases as string[]) {
      const hits=await retrieve([name],{city,vector:'off',limit:24});assert.equal(hits[0]?.canonicalPlaceId,eid);sqlProbes++;
      for(const id of [undefined,...(p.payload?.identity as any).memberIds]) {
        const resolved=index.resolve(city,name,id);assert.equal(resolved.status,'resolved');if(resolved.status==='resolved')assert.equal(resolved.canonicalPlaceId,eid);
      }
    }
    for(const id of [undefined,...(p.payload?.identity as any).memberIds])for(const name of boundaries) {
      const result=index.resolve(city,name,id);assert.ok(result.status!=='resolved'||result.canonicalPlaceId!==eid);boundaryProbes++;
    }
    results.push({entityId:eid,name:p.name,oldName:old.name,category:p.category,type:p.payload?.xhsPlaceType,confirmed:expectedMentions.length,pending:g.mentionIds.length-expectedMentions.length,coordinatesPreservedNotNewlyVerified:true});
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
  assert.equal(assignments.length,300);
  for(const actual of assignments) {
    const a=latest.get(Number(actual.mention_id));assert.ok(a);assert.equal(actual.entity_id,a.entityId);assert.equal(actual.input_hash,a.inputHash);
    assert.equal(actual.revision,a.scope.sourcePlaceId===5352?2:1);assert.equal(actual.change_key,a.scope.key);assert.deepEqual(actual.fact_exclusions,a.factExclusions??null);
  }
  const graph=(await db.query('SELECT manifest,relations FROM place_relation_snapshots WHERE city=$1',[city])).rows[0];assert.equal(graph.manifest.revision,33);
  assert.deepEqual(graph.relations,library.tables.place_relation_snapshots[0].relations);
  const pending=graph.manifest.sourceState.mentions.filter((m:any)=>m.status==='review');assert.equal(pending.length,117);
  assert.deepEqual(pending.filter((m:any)=>m.mentionId!==11464),library.tables.place_relation_snapshots[0].manifest.sourceState.mentions.filter((m:any)=>m.status==='review'));
  const priorAudit=await read('all-cities/audit/run-57/snapshot.json'),audit=await read('all-cities/audit/run-58/snapshot.json');
  const newReviews=audit.reviews.filter((r:any)=>!priorAudit.reviews.some((old:any)=>old.id===r.id));
  assert.equal(newReviews.length,1);assert.equal(newReviews[0].detail.mentionId,11464);assert.equal(newReviews[0].status,'PENDING');
  assert.deepEqual(audit.reviews.filter((r:any)=>!newReviews.some((n:any)=>n.id===r.id)),priorAudit.reviews);
  const sourceIds=source.sources.map((g:any)=>g.source.id);
  assert.deepEqual(audit.scopes.filter((r:any)=>!sourceIds.includes(Number(r.place_id))),priorAudit.scopes);
  assert.deepEqual(audit.scopeSources,priorAudit.scopeSources);
  for(const g of source.groups) {
    const sid=g.entity.primary_place_id,scope=audit.scopes.find((r:any)=>Number(r.place_id)===sid);
    assert.ok(scope);assert.equal(scope.revision,1);assert.deepEqual(scope.entity_ids,[g.entity.entity_id]);assert.deepEqual(scope.name_keys,g.nameKeys);
    const row=(await up.query('SELECT source_hash,revision,change_key FROM place_identity_scope WHERE place_id=$1',[sid])).rows[0];
    assert.equal(row.source_hash,g.sources[0].sourceHash);assert.equal(row.revision,1);assert.equal(row.change_key,`all-cities-20261009-batch-59-source-${sid}-scope`);
  }
  const trips=(await db.query("SELECT count(*)::int count,md5(COALESCE(string_agg(h,'' ORDER BY h),'')) digest FROM (SELECT md5(to_jsonb(t)::text) h FROM trips t) x")).rows[0];
  assert.deepEqual(trips,(await read(folder+'pre-import-check.json')).trips);
  const report={batch:59,readOnly:true,at:new Date().toISOString(),consumedFieldsVerified:exported.length,fields,results,assignmentRows:300,pendingMentions:117,
    scopesAdded:1,confirmed:4,pendingAdded:1,coordinatesCleared:0,newPreciseLocations:0,categoriesCorrected:0,addressesCorrected:1,sqlProbes,boundaryProbes,realVectorProbes:1,graph:19,directEdges:3,
    priorRelationEvidenceAndStrengthPreserved:true,weakRelationAdded:0,priorReviewRowsPreserved:true,rawDerivedCachesPreserved:true,confirmedFactsPreserved:true,negativeConfirmed:3,positiveConfirmed:1,staleNavigationRemoved:true,coordinatesPreservedNotNewlyVerified:true,
    fallbackObservedAtChanges,fallbackObservedAtMeaning:'保留看点的来源日期保持；本批隔离一条带旧址导航事实的提及内容，compiledAt随导出更新。',trips,
    imageComparison:'deferred_by_user',fullReviewPassed:false,failures:[]};
  await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...report,fallbackObservedAtChanges:fallbackObservedAtChanges.length}));
} finally {await db.query('ROLLBACK').catch(()=>{});await up.query('ROLLBACK').catch(()=>{});await db.end();await up.end();}
