import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { Client } from 'pg';
import { parse } from 'dotenv';
import { createPlaceIdentityIndex } from '../../../../../apps/server/src/lib/placeIdentity';
import { validateRelationManifest, validateBoundRelations } from '../../../../../apps/server/src/services/placeRelationIdentity';
const eid = '8cc25e536e67519c958ee54248ead04f';
const ledger = JSON.parse(await readFile(new URL('../priority-cities/济南/square-source-review-02.json',import.meta.url),'utf8')) as {
  rows: { mentionId:number; entityId:string|null; inputHash:string }[];
};
const client = new Client({connectionString:parse(await readFile('apps/server/.env')).DATABASE_URL,connectionTimeoutMillis:10000});
try {
  await client.connect(); await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const rows = (await client.query('SELECT id,city,name,category,lat,lng,verified,payload FROM canonical_places WHERE city=$1',['济南'])).rows;
  const index = createPlaceIdentityIndex(rows);
  const current = rows.find(r=>r.id===eid); assert.ok(current);
  assert.equal(current.verified,true); assert.equal(current.category,'娱乐');
  assert.equal(current.payload.identity.revision,3);
  assert.deepEqual(current.payload.identity.memberIds,[eid]); assert.deepEqual(current.payload.aliases,['泉城广场']);
  assert.equal(current.payload.identityWithdrawal,undefined); assert.equal(current.payload.canonicalRedirectTo,undefined);
  assert.equal(current.lat,36.661818); assert.equal(current.lng,117.025546);
  for (const id of [undefined,eid]) {
    const result=index.resolve('济南','泉城广场',id); assert.ok(result.status==='resolved' && result.canonicalPlaceId===eid);
  }
  const negativeNames=['全季酒店济南泉城广场店','泉城广场附近住宿','泉城广场音乐喷泉','泉标','泉城广场东侧环廊'];
  for (const name of negativeNames) {
    const result=index.resolve('济南',name); assert.ok(result.status!=='resolved' || result.canonicalPlaceId!==eid,name);
  }
  const independent=['黑虎泉','宽厚里','解放阁','五龙潭公园'];
  for (const name of independent) {
    const result=index.resolve('济南',name); assert.ok(result.status==='resolved' && result.canonicalPlaceId!==eid,name);
  }
  const assigned=ledger.rows.filter(r=>r.entityId===eid).map(r=>r.mentionId).sort((a,b)=>a-b);
  const pending=ledger.rows.filter(r=>r.entityId===null).map(r=>r.mentionId).sort((a,b)=>a-b);
  assert.equal(assigned.length,30); assert.deepEqual(pending,[11420,12580,12913]);
  assert.deepEqual(current.payload.mentionSources.map((r:{mentionId:number})=>r.mentionId).sort((a:number,b:number)=>a-b),assigned);
  assert.equal(current.payload.mentionCount,30); assert.deepEqual(current.payload.themes,[]);
  assert.deepEqual(current.payload.imageIdentity.approved,[]);
  const evidence=(await client.query('SELECT * FROM research_evidence WHERE city=$1 AND place_id=$2',['济南',eid])).rows;
  assert.equal(evidence.length,30);
  for (const wrong of ['住宿推荐区域','性价比高','从五龙潭东门出']) {
    assert.ok(!JSON.stringify(current.payload).includes(wrong),wrong);
    assert.ok(!JSON.stringify(evidence).includes(wrong),wrong);
  }
  const snapshot=(await client.query('SELECT manifest,relations FROM place_relation_snapshots WHERE city=$1',['济南'])).rows[0];
  const manifest=validateRelationManifest(snapshot.manifest,'济南'); const graph=validateBoundRelations(snapshot.relations,manifest);
  assert.equal(manifest.revision,9);
  for (const row of ledger.rows) {
    const mention=manifest.sourceState.mentions.find(m=>m.mentionId===row.mentionId); assert.ok(mention);
    assert.equal(mention.inputHash,row.inputHash); assert.equal(mention.entityId,row.entityId);
    assert.equal(mention.status,row.entityId?'resolved':'review'); assert.equal(mention.revision,row.entityId?3:null);
  }
  for (const edge of graph) for (const item of edge.evidence) {
    assert.ok([...item.from.mentions,...item.to.mentions].every(m=>!pending.includes(m.mentionId)));
  }
  const bound=(await client.query('SELECT count(*)::int count FROM independent_photo_assignments WHERE city=$1',['济南'])).rows[0].count;
  assert.equal(bound,9);
  const report={readOnly:true,city:'济南',batch:'batch-35',entityId:eid,revision:3,assigned:30,pending,
    category:'娱乐',coordinatesPreserved:true,stableIdPreserved:true,noWithdrawal:true,noNewHotel:true,
    misattributedFactsNotTransferred:true,researchEvidence:evidence.length,negativeNames,independent,
    relationSnapshotRevision:manifest.revision,relations:graph.length,independentAssignments:bound,failures:[]};
  await writeFile(new URL('batch-35/sync-01/boundary-check.json',import.meta.url),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(report));
} finally {await client.query('ROLLBACK').catch(()=>{});await client.end();}
