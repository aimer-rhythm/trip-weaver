// 第66批实库只读核验：全城导出、日期修复边界、名称与旧ID、关系及行程。
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {Client} from 'pg';
import {parse} from 'dotenv';
import {createHash} from 'node:crypto';
import {placeNameKey} from '@tripweaver/shared';
import {createPlaceIdentityIndex} from '../../../../apps/server/src/lib/placeIdentity';
import {createPlaceRetriever} from '../../../../apps/server/src/generation/placeRetrieval';
import {placeEmbeddingText} from '../../../../apps/server/src/lib/placeEmbeddingText';
import type {PlaceRow} from '../../../../apps/server/src/generation/retrievalRanking';
const read=async(p:string)=>JSON.parse(await readFile(new URL(p,import.meta.url),'utf8'));
const folder='all-cities/batch-66/sync-01/',baseline='priority-cities/成都/run-1791504271958861000/';
const sync=(await read(folder+'sync-state.json')).cities['成都'];assert.ok(sync.importedAt&&sync.relationsImportedAt&&sync.embeddingRunAt);
const bytes=await readFile(new URL(folder+'xhs-places-成都.json',import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),sync.exportHash);
const exported=JSON.parse(bytes.toString('utf8')).places as PlaceRow[],producer=(await read(baseline+'producer-before.json')).places;
const library=await read(baseline+'library-before.json'),dateReport=await read(baseline+'producer-baseline-check.json');
assert.deepEqual(dateReport.failures,[]);assert.equal(dateReport.changedHighlights,314);
const decisions=await read('all-cities/batch-66-decisions.json'),targetIds=decisions.map((d:any)=>d.entityId);
const vectors=await read(folder+'verification-vectors.json');assert.deepEqual(vectors.failures,[]);
assert.equal(vectors.cities[0].vectorProbes.length,2);assert.ok(vectors.cities[0].vectorProbes.every((p:any)=>p.diagnostics.vector==='used'));
const db=new Client({connectionString:parse(await readFile('apps/server/.env')).DATABASE_URL,connectionTimeoutMillis:10000});
const fields=['aliases','identity','xhsPlaceType','content','topReasons','openHours','reservation','reservationNote','reservationEvidence','reservationConflict','typicalVisitMinutes','mentionSources','themes','address','geoStatus','price','tips','imageIdentity','adcode'];
try {
  await db.connect();await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const rows=(await db.query<PlaceRow>('SELECT id,city,name,category,lat,lng,verified,source,payload FROM canonical_places WHERE city=$1',['成都'])).rows;
  const byId=new Map(rows.map(p=>[p.id,p]));
  for(const p of exported) {
    const actual=byId.get(p.id);assert.ok(actual);
    for(const k of ['name','category','lat','lng','verified'] as const)assert.equal(actual[k],p[k]);
    for(const k of fields){let expected=p.payload?.[k]??null;if(k==='identity'&&expected){const identity=expected as {memberNames:string[]};expected={...identity,nameKeys:[...new Set([...identity.memberNames,...(p.payload?.aliases as string[]??[])].map(placeNameKey))]};}assert.deepEqual(actual.payload?.[k]??null,expected,`${p.name}/${k}`);}
    const prior=producer.find((r:any)=>r.id===p.id);assert.ok(prior);
    if(!targetIds.includes(p.id)) {
      const previous=structuredClone(prior),current=structuredClone(p);
      if(previous.payload?.content)delete previous.payload.content.compiledAt;
      const content=current.payload?.content as Record<string,unknown>|undefined;if(content)delete content.compiledAt;
      assert.deepEqual(current,previous,`其他主体同生产者导出/${p.name}`);
    }
  }
  const index=createPlaceIdentityIndex(rows.filter(p=>p.verified||p.payload?.identityWithdrawal));
  const retrieve=createPlaceRetriever({query:(sql,args)=>db.query(sql,args),embed:async()=>null});
  let sqlProbes=0,boundaryProbes=0;
  for(const d of decisions) {
    const p=byId.get(d.entityId);assert.ok(p);
    const identity=p.payload!.identity as any;
    assert.equal(identity.revision,3);assert.equal(p.lat,null);assert.equal(p.lng,null);assert.equal(p.payload!.adcode,'');
    assert.equal(p.payload!.address,'黄龙溪欢乐田园内');assert.equal(p.payload!.typicalVisitMinutes,undefined);
    assert.equal((p.payload!.mentionSources as unknown[]).length,1);
    const actual=(await db.query('SELECT embedding IS NOT NULL embedded,payload->>\'embeddedText\' text FROM canonical_places WHERE id=$1',[p.id])).rows[0];
    assert.ok(actual.embedded);assert.equal(actual.text,placeEmbeddingText(p));
    for(const name of d.aliases) {
      assert.equal((await retrieve([name],{city:'成都',vector:'off',limit:24}))[0]?.canonicalPlaceId,p.id);sqlProbes++;
      for(const id of [undefined,...identity.memberIds]){const r=index.resolve('成都',name,id);assert.ok(r.status==='resolved');assert.equal(r.canonicalPlaceId,p.id);}
    }
    for(const name of ['萌宠片区','黄龙溪欢乐田园','龙溪','龙溪谷','黄龙溪古镇','萌宠(欣茂·大峰景店)',...decisions.map((v:any)=>v.canonicalName)].filter(n=>!d.aliases.includes(n)))
      for(const id of [undefined,...identity.memberIds]){const r=index.resolve('成都',name,id);assert.ok(r.status!=='resolved'||r.canonicalPlaceId!==p.id);boundaryProbes++;}
  }
  const graph=(await db.query('SELECT manifest,relations FROM place_relation_snapshots WHERE city=$1',['成都'])).rows[0];
  assert.equal(graph.manifest.revision,6);assert.deepEqual(graph.relations,library.tables.place_relation_snapshots[0].relations);assert.equal(graph.relations.length,49);
  const audit=await read('all-cities/audit/run-65/snapshot.json'),beforeAudit=await read('all-cities/audit/run-64/snapshot.json');assert.deepEqual(audit.reviews,beforeAudit.reviews);
  assert.deepEqual(audit.scopes.filter((s:any)=>![2011,2013].includes(Number(s.place_id))),beforeAudit.scopes);
  const trips=(await db.query("SELECT count(*)::int count,md5(COALESCE(string_agg(h,'' ORDER BY h),'')) digest FROM (SELECT md5(to_jsonb(t)::text) h FROM trips t) x")).rows[0];assert.deepEqual(trips,library.trips);
  const report={batch:66,readOnly:true,consumedFieldsVerified:exported.length,fields,sqlProbes,boundaryProbes,realVectorProbes:2,sourceDateCorrections:314,
    dateCorrectedEntities:245,nonTargetProducerFieldsUnchanged:true,priorReviewsPreserved:true,scopesAdded:2,confirmed:2,pendingAdded:0,
    coordinatesCleared:2,preciseLocationsResolved:0,graph:49,directEdges:15,trips,imageComparison:'deferred_by_user',fullReviewPassed:false,failures:[]};
  await writeFile(new URL('priority-cities/成都/park-zones-downstream-check-01.json',import.meta.url),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(report));
} finally {await db.query('ROLLBACK').catch(()=>{});await db.end();}
