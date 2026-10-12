import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { Client } from 'pg';
import { parse } from 'dotenv';
import { createPlaceIdentityIndex } from '../../../../../apps/server/src/lib/placeIdentity';
import { validateRelationManifest, validateBoundRelations } from '../../../../../apps/server/src/services/placeRelationIdentity';

const park = 'd7dfe7ae5196779e613b8fa0d9bacf5a';
const mixed = 'f65621879204866b17b645554f9848db';
const ledger = JSON.parse(await readFile(new URL('../priority-cities/济南/wulongtan-source-review-01.json', import.meta.url), 'utf8')) as {
  rows: { mentionId:number; entityId:string|null; inputHash:string }[];
};
const client = new Client({ connectionString:parse(await readFile('apps/server/.env')).DATABASE_URL });
try {
  await client.connect();
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const rows = (await client.query('SELECT id,city,name,category,lat,lng,verified,payload FROM canonical_places WHERE city=$1', ['济南'])).rows;
  const index = createPlaceIdentityIndex(rows);
  const current = rows.find(row => row.id===park)!;
  const old = rows.find(row => row.id===mixed)!;
  assert.ok(current && old);
  assert.equal(current.verified, true);
  assert.equal(current.category, '自然');
  assert.equal(current.payload.identity.revision, 3);
  assert.deepEqual(current.payload.identity.memberIds, [park]);
  assert.deepEqual(current.payload.aliases, ['五龙潭公园']);
  assert.equal(current.lat, 36.666543);
  assert.equal(current.lng, 117.014694);
  assert.equal(old.verified, false);
  assert.equal(old.payload.canonicalRedirectTo, undefined);
  assert.deepEqual(old.payload.identityWithdrawal.candidateIds, [park]);
  for (const id of [undefined, mixed, park]) {
    assert.notEqual(index.resolve('济南', '五龙潭', id).status, 'resolved');
  }
  const fullName = index.resolve('济南', '五龙潭公园', park);
  assert.ok(fullName.status==='resolved' && fullName.canonicalPlaceId===park);
  for (const name of ['五龙潭主潭', '五龙潭南门', '五龙潭公园南门', '五龙潭码头']) {
    const result = index.resolve('济南', name);
    assert.ok(result.status!=='resolved' || result.canonicalPlaceId!==park, name);
  }
  const independent = ['趵突泉公园', '大明湖', '关帝庙', '黑虎泉'].map(name => {
    const result = index.resolve('济南', name);
    assert.equal(result.status, 'resolved', name);
    assert.ok(result.status==='resolved' && result.canonicalPlaceId!==park, name);
    return name;
  });
  const expected = ledger.rows.filter(row=>row.entityId===park).map(row=>row.mentionId).sort((a,b)=>a-b);
  const pending = ledger.rows.filter(row=>row.entityId===null).map(row=>row.mentionId).sort((a,b)=>a-b);
  assert.equal(expected.length,25); assert.equal(pending.length,18);
  assert.deepEqual(current.payload.mentionSources.map((row:{mentionId:number})=>row.mentionId).sort((a:number,b:number)=>a-b), expected);
  assert.ok(!JSON.stringify(current.payload).includes('出门就是小吃街'));
  const snapshot = (await client.query('SELECT manifest,relations FROM place_relation_snapshots WHERE city=$1',['济南'])).rows[0];
  const manifest = validateRelationManifest(snapshot.manifest,'济南');
  const graph = validateBoundRelations(snapshot.relations,manifest);
  for (const row of ledger.rows) {
    const mention = manifest.sourceState.mentions.find(m=>m.mentionId===row.mentionId)!;
    assert.ok(mention); assert.equal(mention.inputHash,row.inputHash);
    assert.equal(mention.entityId,row.entityId);
    assert.equal(mention.status,row.entityId?'resolved':'review');
    assert.equal(mention.revision,row.entityId?3:null);
  }
  assert.ok(graph.every(edge=>edge.fromEntityId!==mixed && edge.toEntityId!==mixed));
  const report = { readOnly:true,city:'济南',batch:'batch-33',park,withdrawnMixed:mixed,
    assigned:expected.length,pending:pending.length,parkCategory:current.category,
    mixedIdNotRedirected:true,bareNameNotAlias:true,coreAndFacilityNamesNotClaimed:true,
    hotelFactNotTransferred:true,independent,relationSnapshotRevision:manifest.revision,
    relations:graph.length,failures:[] };
  await writeFile(new URL('batch-33/sync-01/boundary-check.json',import.meta.url),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(report));
} finally { await client.query('ROLLBACK').catch(()=>{}); await client.end(); }
