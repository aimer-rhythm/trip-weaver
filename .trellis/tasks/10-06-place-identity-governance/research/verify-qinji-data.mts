// 第52批实际消费：同名多位置范围、明确提及保留、旧分配和来源日期保持。
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
const folder='all-cities/batch-52/sync-01/',city='济南';
const output=new URL('priority-cities/济南/qinji-downstream-check-01.json',import.meta.url);
await readFile(output).then(()=>{throw new Error('证据不能覆盖');},(e:NodeJS.ErrnoException)=>{if(e.code!=='ENOENT')throw e;});
const sync=(await read(folder+'sync-state.json')).cities[city];assert.ok(sync.importedAt&&sync.relationsImportedAt&&sync.embeddingRunAt);
const bytes=await readFile(new URL(folder+'xhs-places-济南.json',import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),sync.exportHash);
const exported=JSON.parse(bytes.toString('utf8')).places as PlaceRow[];
const library=await read(folder+'preview-济南/library-before.json'),source=await read('all-cities/batch-52-source.json');
const targets=source.groups.map((g:any)=>g.entity.entity_id);
const scopes=(await Promise.all([36,40,41,42,43,44,45,46,47,48,49,52].map(n=>read(`all-cities/batch-${n}-scope-decisions.json`)))).flat();
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
    assert.equal((p.payload?.identity as any).revision,2);assert.equal(p.category,'美食');assert.equal(p.payload?.xhsPlaceType,'food');
    assert.equal(p.verified,true);assert.equal(p.lat,old.lat);assert.equal(p.lng,old.lng);assert.equal(p.payload?.address,old.payload.address);
    assert.deepEqual(p.payload?.aliases,old.payload.aliases);assert.equal(old.payload.mentionCount,4);assert.equal(p.payload?.mentionCount,2);
    assert.deepEqual((p.payload?.mentionSources as any[]).map(m=>m.mentionId).sort((a,b)=>a-b),[11364,12605]);
    assert.equal(p.payload?.typicalVisitMinutes,undefined);assert.deepEqual(p.payload?.themes,[]);
    assert.deepEqual((p.payload?.imageIdentity as any).approved,[]);
    assert.doesNotMatch(JSON.stringify(p.payload),/肉火烧去制锦市|其他去河边|具体菜品未详述/);
    assert.deepEqual(p.payload?.topReasons,['本地人推荐，有特色且味道好']);
    const content=p.payload?.content as any;assert.equal(content.intro,'本地人推荐，有特色且味道好。');assert.equal(content.highlights.length,1);
    assert.deepEqual(content.highlights[0],old.payload.content.highlights[0]);
    const evidence=(await db.query('SELECT kind,content FROM research_evidence WHERE place_id=$1 AND kind LIKE $2',[eid,'xhs_%'])).rows;
    assert.deepEqual(evidence,[{kind:'xhs_reason',content:'本地人推荐，有特色且味道好'}]);
    const boundaries=['秦记火烧（制锦市店）','秦记火烧（河边店）','制锦市','秦记火烧铜元局前街店','桥下把子肉'];
    const hits=await retrieve([p.name],{city,vector:'off',limit:24});assert.equal(hits[0]?.canonicalPlaceId,eid);sqlProbes++;
    for(const id of [undefined,...g.entity.legacy_ids]) {
      const resolved=index.resolve(city,p.name,id);assert.equal(resolved.status,'resolved');if(resolved.status==='resolved')assert.equal(resolved.canonicalPlaceId,eid);
      for(const name of boundaries){const r=index.resolve(city,name,id);assert.ok(r.status!=='resolved'||r.canonicalPlaceId!==eid);boundaryProbes++;}
    }
    results.push({entityId:eid,name:p.name,category:p.category,type:p.payload?.xhsPlaceType,confirmed:2,pending:2,locationPreservedNotNewlyVerified:true});
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
  assert.equal(assignments.length,272);
  for(const actual of assignments) {
    const a=latest.get(Number(actual.mention_id));assert.ok(a);assert.equal(actual.entity_id,a.entityId);assert.equal(actual.input_hash,a.inputHash);
    assert.equal(actual.revision,a.scope.sourcePlaceId===5352?2:1);assert.equal(actual.change_key,a.scope.key);assert.deepEqual(actual.fact_exclusions,a.factExclusions??null);
  }
  const graph=(await db.query('SELECT manifest,relations FROM place_relation_snapshots WHERE city=$1',[city])).rows[0];assert.equal(graph.manifest.revision,26);
  assert.deepEqual(graph.relations,library.tables.place_relation_snapshots[0].relations);
  const pending=graph.manifest.sourceState.mentions.filter((m:any)=>m.status==='review');assert.equal(pending.length,109);
  assert.deepEqual(pending.filter((m:any)=>![11664,12892].includes(m.mentionId)),library.tables.place_relation_snapshots[0].manifest.sourceState.mentions.filter((m:any)=>m.status==='review'));
  const priorAudit=await read('all-cities/audit/run-50/snapshot.json'),audit=await read('all-cities/audit/run-51/snapshot.json');
  const newReviews=audit.reviews.filter((r:any)=>!priorAudit.reviews.some((old:any)=>old.id===r.id));
  assert.equal(newReviews.length,2);assert.deepEqual(newReviews.map((r:any)=>r.detail.mentionId).sort((a:number,b:number)=>a-b),[11664,12892]);
  assert.ok(newReviews.every((r:any)=>r.status==='PENDING'));
  assert.deepEqual(audit.reviews.filter((r:any)=>!newReviews.some((n:any)=>n.id===r.id)),priorAudit.reviews);
  assert.deepEqual(audit.scopes.filter((r:any)=>Number(r.place_id)!==5342),priorAudit.scopes);
  assert.deepEqual(audit.scopeSources.filter((r:any)=>Number(r.scope_place_id)!==5342),priorAudit.scopeSources);
  const addedScopes=audit.scopes.filter((r:any)=>Number(r.place_id)===5342);
  assert.equal(addedScopes.length,1);assert.equal(addedScopes[0].revision,1);
  assert.deepEqual(addedScopes[0].entity_ids,targets);assert.deepEqual(addedScopes[0].name_keys,['秦记火烧']);
  const addedSources=audit.scopeSources.filter((r:any)=>Number(r.scope_place_id)===5342);
  // 单源scope把源指纹保存在主表，联合来源才写显式成员表。
  assert.equal(addedSources.length,0);
  const scopeRow=(await up.query('SELECT source_hash,revision,change_key FROM place_identity_scope WHERE place_id=$1',[5342])).rows[0];
  assert.equal(scopeRow.source_hash,source.sources[0].sourceHash);assert.equal(scopeRow.revision,1);
  assert.equal(scopeRow.change_key,'all-cities-20261009-batch-52-source-5342-scope');
  const trips=(await db.query("SELECT count(*)::int count,md5(COALESCE(string_agg(h,'' ORDER BY h),'')) digest FROM (SELECT md5(to_jsonb(t)::text) h FROM trips t) x")).rows[0];
  assert.deepEqual(trips,(await read(folder+'pre-import-check.json')).trips);
  const report={batch:52,readOnly:true,at:new Date().toISOString(),consumedFieldsVerified:exported.length,fields,results,assignmentRows:272,pendingMentions:109,
    scopesAdded:1,confirmed:2,pendingAdded:2,coordinatesCleared:0,newPreciseLocations:0,categoriesCorrected:0,addressesAdded:0,sqlProbes,boundaryProbes,realVectorProbes:1,graph:18,directEdges:3,
    relationEvidenceAndStrengthPreserved:true,priorReviewRowsPreserved:true,rawDerivedCachesPreserved:true,confirmedFactsPreserved:true,
    fallbackObservedAtChanges,fallbackObservedAtMeaning:'保留看点的来源日期保持；本批隔离两条未确认提及的内容，compiledAt随导出更新。',trips,
    imageComparison:'deferred_by_user',fullReviewPassed:false,failures:[]};
  await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...report,fallbackObservedAtChanges:fallbackObservedAtChanges.length}));
} finally {await db.query('ROLLBACK').catch(()=>{});await up.query('ROLLBACK').catch(()=>{});await db.end();await up.end();}
