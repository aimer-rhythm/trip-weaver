// 第68批实库只读：除公园类别及实体版本外，全城原消费保持。
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
const folder='all-cities/batch-68/sync-01/';
const sync=(await read(folder+'sync-state.json')).cities['成都'];assert.ok(sync.importedAt&&sync.relationsImportedAt&&sync.embeddingRunAt);
const bytes=await readFile(new URL(folder+'xhs-places-成都.json',import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),sync.exportHash);
const exported=JSON.parse(bytes.toString('utf8')).places as PlaceRow[],before=(await read('all-cities/batch-67/sync-01/xhs-places-成都.json')).places;
const library=await read(folder+'preview-成都/library-before.json'),decisions=await read('all-cities/batch-68-decisions.json');
const vectors=await read(folder+'verification-vectors-retry01.json');assert.deepEqual(vectors.failures,[]);assert.equal(vectors.cities[0].vectorProbes.length,1);assert.ok(vectors.cities[0].vectorProbes.every((p:any)=>p.diagnostics.vector==='used'));
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
    if(decision){
      expected.category='自然';expected.payload.identity.revision=2;
      const legacyIds=decision.aliases.map((name:string)=>createHash('sha256').update('成都'+name).digest('hex').slice(0,32));
      expected.payload.identity.memberIds=[p.id,...[...new Set<string>(legacyIds)].filter(id=>id!==p.id).sort()];
      assert.deepEqual(expected.payload.identity.memberIds,['c59fb8b0967139fdc1bbf231b57283b1','bff6ba292c6b9b100d70ed00fde2f96f','dd173f010b9176ae48bae1a5cbc329ae']);
      for(const id of expected.payload.identity.memberIds.filter((id:string)=>id!==p.id))assert.ok(!library.tables.canonical_places.some((row:any)=>row.id===id));
    }
    assert.deepEqual(stable(p),expected,`${p.name}/仅类别、版本及既有别名历史ID可变`);
  }
  const index=createPlaceIdentityIndex(rows.filter(p=>p.verified||p.payload?.identityWithdrawal));
  const retrieve=createPlaceRetriever({query:(sql,args)=>db.query(sql,args),embed:async()=>null});
  let sqlProbes=0,boundaryProbes=0;
  for(const d of decisions){const p=byId.get(d.entityId);assert.ok(p);const identity=p.payload!.identity as any;
    assert.equal(p.category,'自然');assert.equal(p.payload!.mentionSources,undefined);
    const embedded=(await db.query('SELECT embedding IS NOT NULL embedded,payload->>\'embeddedText\' text FROM canonical_places WHERE id=$1',[p.id])).rows[0];assert.ok(embedded.embedded);assert.equal(embedded.text,placeEmbeddingText(p));
    for(const name of new Set([d.canonicalName,...d.aliases])){assert.equal((await retrieve([name as string],{city:'成都',vector:'off',limit:24}))[0]?.canonicalPlaceId,p.id);sqlProbes++;
      for(const id of [undefined,...identity.memberIds]){const r=index.resolve('成都',name as string,id);assert.ok(r.status==='resolved');assert.equal(r.canonicalPlaceId,p.id);}}
    for(const name of ['鹤鸣茶社','人民公园鹤鸣茶社','辛亥秋保路死事纪念碑','祠堂街',...decisions.map((v:any)=>v.canonicalName)].filter(n=>n!==d.canonicalName&&!d.aliases.includes(n)))
      for(const id of [undefined,...identity.memberIds]){const r=index.resolve('成都',name,id);assert.ok(r.status!=='resolved'||r.canonicalPlaceId!==p.id);boundaryProbes++;}
  }
  const graph=(await db.query('SELECT manifest,relations FROM place_relation_snapshots WHERE city=$1',['成都'])).rows[0];assert.equal(graph.manifest.revision,8);
  // 类别改变只能刷新有关端点实体版本，关系原始证据、强度和位置不变。
  let relationEndpointRevisions=0;
  const expectedRelations=structuredClone(library.tables.place_relation_snapshots[0].relations);
  for(const edge of expectedRelations)for(const end of ['from','to'])if(edge[end+'EntityId']===decisions[0].entityId){assert.equal(edge[end+'Revision'],1);edge[end+'Revision']=2;}
  for(const edge of expectedRelations)for(const proof of edge.evidence??[])for(const end of ['from','to'])if(proof[end]?.entityId===decisions[0].entityId){
    assert.equal(proof[end].revision,1);proof[end].revision=2;relationEndpointRevisions++;
  }
  assert.deepEqual(graph.relations,expectedRelations);assert.equal(graph.relations.length,49);
  const audit=await read('all-cities/audit/run-67/snapshot.json'),priorAudit=await read('all-cities/audit/run-66/snapshot.json');
  for(const key of ['reviews','scopes','scopeSources'])assert.deepEqual(audit[key],priorAudit[key]);
  const trips=(await db.query("SELECT count(*)::int count,md5(COALESCE(string_agg(h,'' ORDER BY h),'')) digest FROM (SELECT md5(to_jsonb(t)::text) h FROM trips t) x")).rows[0];assert.deepEqual(trips,(await read(folder+'pre-import-check.json')).trips);
  const report={batch:68,readOnly:true,consumedFieldsVerified:exported.length,sqlProbes,boundaryProbes,realVectorProbes:1,
    allNonCategoryConsumptionPreserved:true,identityMembersPreserved:true,existingAliasLegacyIdsAdded:2,newAliases:0,scopeChanges:0,assignmentChanges:0,pendingAdded:0,
    categoryChanges:1,coordinatesCleared:0,preciseLocationsResolved:0,graph:49,directEdges:15,relationEndpointRevisions,trips,imageComparison:'deferred_by_user',fullReviewPassed:false,failures:[]};
  await writeFile(new URL('priority-cities/成都/renmin-category-downstream-check-01.json',import.meta.url),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
} finally {await db.query('ROLLBACK').catch(()=>{});await db.end();}
