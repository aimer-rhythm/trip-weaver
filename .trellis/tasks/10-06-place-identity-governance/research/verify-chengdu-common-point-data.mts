// 第67批实库只读：除四项位置及实体版本外，全城原消费保持。
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
const folder='all-cities/batch-67/sync-01/';
const sync=(await read(folder+'sync-state.json')).cities['成都'];assert.ok(sync.importedAt&&sync.relationsImportedAt&&sync.embeddingRunAt);
const bytes=await readFile(new URL(folder+'xhs-places-成都.json',import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),sync.exportHash);
const exported=JSON.parse(bytes.toString('utf8')).places as PlaceRow[],before=(await read('all-cities/batch-66/sync-01/xhs-places-成都.json')).places;
const library=await read(folder+'preview-成都/library-before.json'),decisions=await read('all-cities/batch-67-decisions.json');
const vectors=await read(folder+'verification-vectors.json');assert.deepEqual(vectors.failures,[]);assert.equal(vectors.cities[0].vectorProbes.length,4);assert.ok(vectors.cities[0].vectorProbes.every((p:any)=>p.diagnostics.vector==='used'));
const stable=(p:any)=>{const copy=structuredClone(p);if(copy.payload?.content)delete copy.payload.content.compiledAt;return copy;};
const db=new Client({connectionString:parse(await readFile('apps/server/.env')).DATABASE_URL,connectionTimeoutMillis:10000});
try {
  await db.connect();await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const rows=(await db.query<PlaceRow>('SELECT id,city,name,category,lat,lng,verified,source,payload FROM canonical_places WHERE city=$1',['成都'])).rows,byId=new Map(rows.map(p=>[p.id,p]));
  for(const p of exported){const actual=byId.get(p.id);assert.ok(actual);
    for(const k of ['name','category','lat','lng','verified'] as const)assert.equal(actual[k],p[k]);
    for(const [k,v] of Object.entries(p.payload??{})){let expected:any=v;
      if(k==='identity')expected={...expected,nameKeys:[...new Set([...expected.memberNames,...(p.payload?.aliases as string[]??[])].map(placeNameKey))]};
      assert.deepEqual(actual.payload?.[k],expected,`${p.name}/${k}`);
    }
    const prior=before.find((r:any)=>r.id===p.id);assert.ok(prior);const expected=stable(prior),decision=decisions.find((d:any)=>d.entityId===p.id);
    if(decision){expected.lat=null;expected.lng=null;Object.assign(expected.payload,{address:decision.overrides.address,geoStatus:'unresolvable',adcode:''});expected.payload.identity.revision=2;}
    assert.deepEqual(stable(p),expected,`${p.name}/仅位置字段和版本可变`);
  }
  const index=createPlaceIdentityIndex(rows.filter(p=>p.verified||p.payload?.identityWithdrawal));
  const retrieve=createPlaceRetriever({query:(sql,args)=>db.query(sql,args),embed:async()=>null});
  let sqlProbes=0,boundaryProbes=0;
  for(const d of decisions){const p=byId.get(d.entityId);assert.ok(p);const identity=p.payload!.identity as any;
    assert.equal(p.lat,null);assert.equal(p.lng,null);assert.equal(p.payload!.adcode,'');assert.equal(p.payload!.mentionSources,undefined);
    const embedded=(await db.query('SELECT embedding IS NOT NULL embedded,payload->>\'embeddedText\' text FROM canonical_places WHERE id=$1',[p.id])).rows[0];assert.ok(embedded.embedded);assert.equal(embedded.text,placeEmbeddingText(p));
    for(const name of new Set([d.canonicalName,...d.aliases])){assert.equal((await retrieve([name as string],{city:'成都',vector:'off',limit:24}))[0]?.canonicalPlaceId,p.id);sqlProbes++;
      for(const id of [undefined,...identity.memberIds]){const r=index.resolve('成都',name as string,id);assert.ok(r.status==='resolved');assert.equal(r.canonicalPlaceId,p.id);}}
    for(const name of ['洛带古镇','博客楼',...decisions.map((v:any)=>v.canonicalName)].filter(n=>n!==d.canonicalName&&!d.aliases.includes(n)))
      for(const id of [undefined,...identity.memberIds]){const r=index.resolve('成都',name,id);assert.ok(r.status!=='resolved'||r.canonicalPlaceId!==p.id);boundaryProbes++;}
  }
  const graph=(await db.query('SELECT manifest,relations FROM place_relation_snapshots WHERE city=$1',['成都'])).rows[0];assert.equal(graph.manifest.revision,7);
  // 位置改变只能刷新有关端点实体版本，关系原始证据、强度和位置不变。
  const normalized=(edges:any[])=>edges.map(e=>{const copy=structuredClone(e);delete copy.fromRevision;delete copy.toRevision;for(const proof of copy.evidence??[])for(const end of ['from','to'])if(proof[end])delete proof[end].entityRevision;return copy;});
  assert.deepEqual(normalized(graph.relations),normalized(library.tables.place_relation_snapshots[0].relations));assert.equal(graph.relations.length,49);
  const audit=await read('all-cities/audit/run-66/snapshot.json'),priorAudit=await read('all-cities/audit/run-65/snapshot.json');
  for(const key of ['reviews','scopes','scopeSources'])assert.deepEqual(audit[key],priorAudit[key]);
  const trips=(await db.query("SELECT count(*)::int count,md5(COALESCE(string_agg(h,'' ORDER BY h),'')) digest FROM (SELECT md5(to_jsonb(t)::text) h FROM trips t) x")).rows[0];assert.deepEqual(trips,(await read(folder+'pre-import-check.json')).trips);
  const report={batch:67,readOnly:true,consumedFieldsVerified:exported.length,sqlProbes,boundaryProbes,realVectorProbes:4,
    allNonLocationConsumptionPreserved:true,identityMembersPreserved:true,scopeChanges:0,assignmentChanges:0,pendingAdded:0,
    coordinatesCleared:4,preciseLocationsResolved:0,graph:49,directEdges:15,trips,imageComparison:'deferred_by_user',fullReviewPassed:false,failures:[]};
  await writeFile(new URL('priority-cities/成都/common-point-downstream-check-01.json',import.meta.url),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
} finally {await db.query('ROLLBACK').catch(()=>{});await db.end();}
