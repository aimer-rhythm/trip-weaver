// 正式同步后只读检查实际事实、四主体、原有待审与图库；不导入db/client。
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Client } from 'pg';
import { parse } from 'dotenv';
import { createPlaceIdentityIndex } from '../../../../../apps/server/src/lib/placeIdentity';
import { createPlaceRetriever } from '../../../../../apps/server/src/generation/placeRetrieval';
import { validateRelationManifest, validateBoundRelations } from '../../../../../apps/server/src/services/placeRelationIdentity';
const read = async (file:string) => JSON.parse(await readFile(new URL(file, import.meta.url), 'utf8'));
const expected = await read('batch-36-export-expectations.json') as {id:string;name:string;revision:number;mentionIds:number[]}[];
const decisions = await read('batch-36-scope-decisions.json') as {sourcePlaceId:number;assignments:{mentionId:number;inputHash:string;entityId:string|null}[]}[];
const original = await read('batch-36-source.json');
const folder = 'batch-36/sync-01/';
const sync = (await read(folder + 'sync-state.json')).cities['济南'];
assert.ok(sync.importedAt && sync.relationsImportedAt && sync.embeddingRunAt);
const exportBytes = await readFile(new URL(folder + 'xhs-places-济南.json', import.meta.url));
assert.equal(createHash('sha256').update(exportBytes).digest('hex'), sync.exportHash);
const exported = JSON.parse(exportBytes.toString('utf8'));
const library = await read(folder + 'preview-济南/library-before.json');
const baselineManifest = validateRelationManifest(library.tables.place_relation_snapshots[0].manifest, '济南');
const client = new Client({connectionString:parse(await readFile('apps/server/.env')).DATABASE_URL,connectionTimeoutMillis:10000});
try {
  await client.connect(); await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const rows = (await client.query('SELECT id,city,name,category,lat,lng,verified,payload FROM canonical_places WHERE city=$1',['济南'])).rows;
  const index = createPlaceIdentityIndex(rows);
  const retrieve = createPlaceRetriever({query:(sql,args)=>client.query(sql,args),embed:async()=>null});
  const snapshot = (await client.query('SELECT manifest,relations FROM place_relation_snapshots WHERE city=$1',['济南'])).rows[0];
  const manifest = validateRelationManifest(snapshot.manifest,'济南');
  const graph = validateBoundRelations(snapshot.relations,manifest);
  assert.equal(manifest.revision,sync.relationSnapshotRevision);
  const allAssignments = decisions.flatMap(d=>d.assignments);
  const pending = allAssignments.filter(a=>a.entityId===null).map(a=>a.mentionId);
  assert.deepEqual(pending,[12692]);
  const checked = [];
  for (const target of expected) {
    const current = rows.find(r=>r.id===target.id); assert.ok(current);
    const previous = library.tables.canonical_places.find((r:{id:string})=>r.id===target.id); assert.ok(previous);
    const source = original.groups.find((g:{entity:{entity_id:string}})=>g.entity.entity_id===target.id).source;
    const published = exported.places.find((p:{id:string})=>p.id===target.id); assert.ok(published);
    assert.equal(previous.payload.typicalVisitMinutes,30);
    assert.equal(current.payload.typicalVisitMinutes,undefined);
    assert.equal(published.payload.typicalVisitMinutes,undefined);
    assert.equal(current.verified,true); assert.equal(current.category,'文化');
    assert.equal(current.category,previous.category);
    assert.equal(current.payload.identity.revision,2);
    assert.deepEqual(current.payload.identity.memberIds,[target.id]);
    assert.equal(current.payload.identityWithdrawal,undefined); assert.equal(current.payload.canonicalRedirectTo,undefined);
    assert.equal(current.lat,Number(source.latitude.toFixed(6))); assert.equal(current.lng,Number(source.longitude.toFixed(6)));
    assert.equal(current.lat,previous.lat); assert.equal(current.lng,previous.lng);
    assert.deepEqual(current.payload.mentionSources.map((m:{mentionId:number})=>m.mentionId).sort((a:number,b:number)=>a-b),target.mentionIds);
    assert.equal(current.payload.mentionCount,target.mentionIds.length);
    assert.deepEqual(current.payload.imageIdentity.approved,[]);
    assert.ok(!JSON.stringify(current.payload.content).includes('簪花少女'));
    assert.ok(current.payload.content.intro, '有效描述应保留');
    const evidence = (await client.query('SELECT * FROM research_evidence WHERE city=$1 AND place_id=$2',['济南',target.id])).rows;
    assert.equal(evidence.length,target.mentionIds.length);
    assert.ok(!JSON.stringify(evidence).includes('簪花少女'));
    for (const id of [undefined,target.id,...(previous.payload.identity.memberIds as string[])]) {
      const resolved=index.resolve('济南',target.name,id);
      assert.ok(resolved.status==='resolved' && resolved.canonicalPlaceId===target.id);
    }
    const hits=await retrieve([target.name],{city:'济南',vector:'off',limit:8});
    assert.equal(hits[0]?.canonicalPlaceId,target.id);
    assert.equal(new Set(hits.map(p=>p.canonicalPlaceId)).size,hits.length);
    checked.push({id:target.id,name:target.name,revision:2,mentionCount:evidence.length,oldMinutes:30,newMinutes:null,sqlFirst:true,descriptionPreserved:true});
  }
  assert.equal(checked.reduce((n,p)=>n+p.mentionCount,0),10);
  for (const a of allAssignments) {
    const m=manifest.sourceState.mentions.find(m=>m.mentionId===a.mentionId); assert.ok(m);
    assert.equal(m.inputHash,a.inputHash); assert.equal(m.entityId,a.entityId);
    assert.equal(m.status,a.entityId?'resolved':'review'); assert.equal(m.revision,a.entityId?2:null);
  }
  const priorPending = baselineManifest.sourceState.mentions.filter(m=>m.status==='review');
  assert.equal(priorPending.length,59);
  for (const before of priorPending) assert.deepEqual(manifest.sourceState.mentions.find(m=>m.mentionId===before.mentionId),before);
  for (const edge of graph) for (const e of edge.evidence) assert.ok([...e.from.mentions,...e.to.mentions].every(m=>m.mentionId!==12692));
  const negativeNames=['濯缨池','起凤桥八号','刘氏泉簪花摄影店'];
  for (const name of negativeNames) {
    const result=index.resolve('济南',name);
    assert.ok(result.status!=='resolved' || !expected.some(e=>e.id===result.canonicalPlaceId),name);
  }
  const previousWithdrawals=library.tables.canonical_places.filter((r:{payload:any})=>r.payload?.identityWithdrawal);
  assert.equal(previousWithdrawals.length,6);
  for (const before of previousWithdrawals) {
    const now=rows.find(r=>r.id===before.id); assert.ok(now && !now.verified);
    assert.deepEqual(now.payload.identityWithdrawal,before.payload.identityWithdrawal);
  }
  const bound=(await client.query('SELECT to_jsonb(t) value FROM independent_photo_assignments t WHERE city=$1 ORDER BY to_jsonb(t)::text',['济南'])).rows.map(r=>r.value);
  assert.deepEqual(bound,library.tables.independent_photo_assignments);
  const trips=(await client.query("SELECT count(*)::int count,md5(COALESCE(string_agg(h,'' ORDER BY h),'')) digest FROM (SELECT md5(to_jsonb(t)::text) h FROM trips t) x")).rows[0];
  assert.deepEqual(trips,(await read(folder+'pre-import-check.json')).trips);
  assert.equal(trips.count,201); assert.equal(trips.digest,'e01d67cbf42a62fc595f4ef052f99e75');
  const report={readOnly:true,batch:'batch-36',city:'济南',checked,pending,durationFieldsRemoved:4,priorPendingPreserved:59,
    oldWithdrawalsPreserved:6,negativeNames,relationSnapshotRevision:manifest.revision,relations:graph.length,
    independentAssignments:bound.length,trips,failures:[]};
  await writeFile(new URL(folder+'boundary-check.json',import.meta.url),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(report));
} finally {await client.query('ROLLBACK').catch(()=>{});await client.end();}
