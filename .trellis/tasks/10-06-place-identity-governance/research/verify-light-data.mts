// 第46批实库只读：描述清除、同名/旧ID、来源绑定与周边主体保全。
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
const folder='all-cities/batch-46/sync-01/',city='济南',eid='ce733b67e45f0d657e53ff9bff8cbbce';
const output=new URL('priority-cities/济南/light-downstream-check-01.json',import.meta.url);
await readFile(output).then(()=>{throw new Error('证据不能覆盖');},(e:NodeJS.ErrnoException)=>{if(e.code!=='ENOENT')throw e;});
const sync=(await read(folder+'sync-state.json')).cities[city];assert.ok(sync.importedAt&&sync.relationsImportedAt&&sync.embeddingRunAt);
const bytes=await readFile(new URL(folder+'xhs-places-济南.json',import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),sync.exportHash);
const exported=JSON.parse(bytes.toString('utf8')).places as PlaceRow[];
const library=await read(folder+'preview-济南/library-before.json'),source=await read('all-cities/batch-46-source.json');
const scopes=(await Promise.all([36,40,41,42,43,44,45,46].map(n=>read(`all-cities/batch-${n}-scope-decisions.json`)))).flat();
const vectors=await read(folder+'verification-vectors.json');assert.deepEqual(vectors.failures,[]);
assert.equal(vectors.cities[0].probes.length,1);assert.equal(vectors.cities[0].vectorProbes.length,1);
assert.equal(vectors.cities[0].vectorProbes[0].diagnostics.vector,'used');
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
  const p=byId.get(eid),old=library.tables.canonical_places.find((r:PlaceRow)=>r.id===eid);assert.ok(p&&old);
  const index=createPlaceIdentityIndex(rows.filter(p=>p.verified||p.payload?.identityWithdrawal));
  const retrieve=createPlaceRetriever({query:(sql,args)=>db.query(sql,args),embed:async()=>{throw new Error('本探针只允许SQL检索');}});
  assert.equal((p.payload?.identity as any).revision,4);assert.equal(p.category,'文化');assert.equal(p.payload?.xhsPlaceType,'photo_spot');
  assert.equal(p.verified,true);assert.equal(p.lat,null);assert.equal(p.lng,null);assert.equal(p.payload?.geoStatus,'unresolvable');
  assert.deepEqual(p.payload?.aliases,old.payload.aliases);assert.deepEqual((p.payload?.mentionSources as any[]).map(m=>m.mentionId),[12776]);
  assert.deepEqual(p.payload?.topReasons,[]);assert.equal((p.payload?.content as any).intro,'');assert.equal(p.payload?.typicalVisitMinutes,undefined);
  assert.match(JSON.stringify(old.payload),/夹心胡同/);assert.doesNotMatch(JSON.stringify(p.payload),/夹心胡同/);
  assert.equal((await db.query('SELECT count(*)::int n FROM research_evidence WHERE place_id=$1 AND kind LIKE $2',[eid,'xhs_%'])).rows[0].n,0);
  const hits=await retrieve([p.name],{city,vector:'off',limit:24});assert.ok(hits.some(h=>h.canonicalPlaceId===eid));
  const boundaries=['纬三路与经三路交叉口','经三路','纬三路','融汇老商埠','夹心胡同'];
  for(const id of [undefined,eid]) {
    const r=index.resolve(city,p.name,id);assert.equal(r.status,'resolved');if(r.status==='resolved')assert.equal(r.canonicalPlaceId,eid);
    for(const wrong of boundaries){const r=index.resolve(city,wrong,id);assert.ok(r.status!=='resolved'||r.canonicalPlaceId!==eid);}
  }
  for(const original of library.tables.canonical_places)if(original.id!==eid) {
    const current=byId.get(original.id);assert.ok(current);
    for(const field of ['identity','aliases','mentionSources','topReasons','typicalVisitMinutes','xhsPlaceType'])assert.deepEqual(current.payload?.[field],original.payload?.[field]);
  }
  const assignments=(await up.query('SELECT mention_id,entity_id,input_hash,revision,change_key,fact_exclusions FROM place_mention_assignment WHERE mention_id=ANY($1::int[])',
    [scopes.flatMap((s:any)=>s.assignments.map((a:any)=>a.mentionId))])).rows;assert.equal(assignments.length,254);
  for(const s of scopes)for(const a of s.assignments) {
    const actual=assignments.find(r=>Number(r.mention_id)===a.mentionId);assert.ok(actual);
    assert.equal(actual.entity_id,a.entityId);assert.equal(actual.input_hash,a.inputHash);assert.equal(actual.revision,1);
    assert.equal(actual.change_key,s.key);assert.deepEqual(actual.fact_exclusions,a.factExclusions??null);
  }
  const g=source.sources[0];assert.deepEqual((await up.query('SELECT typical_visit_minutes,typical_visit_source,theme_tags,content_profile FROM canonical_place WHERE id=$1',[5970])).rows[0],g.derivedBefore);
  const graph=(await db.query('SELECT manifest,relations FROM place_relation_snapshots WHERE city=$1',[city])).rows[0];
  assert.equal(graph.manifest.revision,20);assert.deepEqual(graph.relations,library.tables.place_relation_snapshots[0].relations);
  const pending=graph.manifest.sourceState.mentions.filter((m:any)=>m.status==='review');assert.equal(pending.length,108);
  assert.deepEqual(pending,library.tables.place_relation_snapshots[0].manifest.sourceState.mentions.filter((m:any)=>m.status==='review'));
  const trips=(await db.query("SELECT count(*)::int count,md5(COALESCE(string_agg(h,'' ORDER BY h),'')) digest FROM (SELECT md5(to_jsonb(t)::text) h FROM trips t) x")).rows[0];
  assert.deepEqual(trips,(await read(folder+'pre-import-check.json')).trips);
  const report={batch:46,readOnly:true,at:new Date().toISOString(),consumedFieldsVerified:exported.length,fields,entityId:eid,confirmed:1,
    factExclusions:3,assignmentRows:254,pendingMentions:108,sqlProbes:1,realVectorProbes:1,boundaries,graph:18,directEdges:3,
    relationsUnchanged:true,rawDerivedCachesPreserved:true,trips,imageComparison:'deferred_by_user',fullReviewPassed:false,failures:[]};
  await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
} finally {await db.query('ROLLBACK').catch(()=>{});await db.end();await up.query('ROLLBACK').catch(()=>{});await up.end();}
