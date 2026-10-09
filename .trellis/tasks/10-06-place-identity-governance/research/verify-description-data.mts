// 第40批双库只读检查：实际描述/语料、完整来源声明、旧时长排除及历史行程。
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Client } from 'pg';
import { parse } from 'dotenv';
import { createPlaceIdentityIndex } from '../../../../apps/server/src/lib/placeIdentity';
import { placeEmbeddingText } from '../../../../apps/server/src/lib/placeEmbeddingText';
import type { PlaceRow } from '../../../../apps/server/src/generation/retrievalRanking';

const read = async (p: string) => JSON.parse(await readFile(new URL(p,import.meta.url),'utf8'));
const folder = 'all-cities/batch-40/sync-01/';
const output = new URL('priority-cities/济南/description-downstream-check-01.json',import.meta.url);
await readFile(output).then(() => {throw new Error('证据不能覆盖');},(e: NodeJS.ErrnoException) => {if(e.code!=='ENOENT')throw e;});
const sync = (await read(folder+'sync-state.json')).cities['济南'];
assert.ok(sync.importedAt && sync.relationsImportedAt && sync.embeddingRunAt);
const bytes = await readFile(new URL(folder+'xhs-places-济南.json',import.meta.url));
assert.equal(createHash('sha256').update(bytes).digest('hex'),sync.exportHash);
const exported = JSON.parse(bytes.toString('utf8')).places as PlaceRow[];
const before = await read(folder+'preview-济南/library-before.json');
const scopes = await read('all-cities/batch-40-scope-decisions.json');
const source = await read('all-cities/batch-40-source.json');
const vectors = await read(folder+'verification-vectors.json');
assert.deepEqual(vectors.failures,[]);
assert.equal(vectors.cities[0].vectorProbes.length,2);
assert.ok(vectors.cities[0].vectorProbes.every((p: any) => p.diagnostics.vector==='used'));
const config = parse(await readFile('apps/server/.env'));
const upConfig = parse(await readFile('D:/Project/xhs-travel-pipeline/.env'));
const db = new Client({connectionString:config.DATABASE_URL,connectionTimeoutMillis:10000});
const up = new Client({connectionString:upConfig.DATABASE_URL!.replace('postgresql+asyncpg:','postgresql:'),connectionTimeoutMillis:10000});
try {
  await db.connect(); await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await up.connect(); await up.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const rows = (await db.query<PlaceRow>('SELECT id,city,name,category,lat,lng,verified,source,payload FROM canonical_places WHERE city=$1',['济南'])).rows;
  const byId = new Map(rows.map(p => [p.id,p]));
  const fields = ['content','topReasons','openHours','reservation','reservationNote','reservationEvidence','typicalVisitMinutes','mentionSources','themes'];
  for(const expected of exported) {
    const actual = byId.get(expected.id); assert.ok(actual);
    for(const field of fields) assert.deepEqual(actual.payload?.[field]??null,expected.payload?.[field]??null,`${actual.name}/${field}`);
  }
  const bad = /泉水茶|登高怀古|千年文脉|济南动物园/;
  const probes = [];
  for(const g of source.groups) {
    const p = byId.get(g.entity.entity_id); assert.ok(p);
    assert.equal(p.verified,true); assert.equal(p.payload?.identityWithdrawal,undefined);
    assert.equal(p.category,'娱乐');
    assert.equal(p.lat,Number(g.source.latitude.toFixed(6))); assert.equal(p.lng,Number(g.source.longitude.toFixed(6)));
    assert.equal(p.payload?.mentionCount,g.mentions.length);
    assert.doesNotMatch(JSON.stringify(p.payload),bad);
    assert.doesNotMatch(placeEmbeddingText(p),bad);
    if(p.name==='明水古城') assert.ok(JSON.stringify(p.payload?.topReasons).includes('济南章丘古城，适合拍照'));
    else {assert.deepEqual(p.payload?.topReasons,[]); assert.equal((p.payload?.content as any).intro,'');}
    const evidence = (await db.query('SELECT content FROM research_evidence WHERE place_id=$1 AND kind LIKE $2',[p.id,'xhs_%'])).rows;
    assert.ok(before.tables.research_evidence.some((e: any) => e.place_id===p.id && bad.test(e.content)),'治理前须真实存在错误语料');
    assert.ok(evidence.every(e => !bad.test(e.content)));
    assert.equal(evidence.length,p.name==='明水古城'?2:0);
    probes.push({id:p.id,name:p.name,mentionCount:p.payload?.mentionCount,evidenceCount:evidence.length,embeddingText:placeEmbeddingText(p)});
  }
  const index = createPlaceIdentityIndex(rows.filter(p => p.verified || p.payload?.identityWithdrawal));
  const negatives = [
    ['abc624edea07111dc19aa79dfbb18289',['济南动物园','济南市动物园','济南野生动物世界停车场','济南野生动物世界-售票处','公厕']],
    ['69b816cda273f29ed9296314fbe6f52d',['济南','章丘','百脉泉','明水古城停车场']],
  ] as const;
  for(const [eid,names] of negatives) for(const name of names) for(const id of [undefined,eid]) {
    const resolved = index.resolve('济南',name,id);
    assert.ok(resolved.status!=='resolved' || resolved.canonicalPlaceId!==eid,name);
  }
  const oldScopes = await read('all-cities/batch-36-scope-decisions.json');
  const allScopes = [...oldScopes,...scopes];
  const assignments = (await up.query('SELECT mention_id,entity_id,input_hash,revision,change_key,fact_exclusions FROM place_mention_assignment WHERE mention_id=ANY($1::int[])',
    [allScopes.flatMap((s: any) => s.assignments.map((a: any) => a.mentionId))])).rows;
  assert.equal(assignments.length,15);
  for(const s of allScopes) for(const expected of s.assignments) {
    const a = assignments.find(a => Number(a.mention_id)===expected.mentionId); assert.ok(a);
    assert.equal(a.entity_id,expected.entityId); assert.equal(a.input_hash,expected.inputHash);
    assert.equal(a.change_key,s.key); assert.equal(a.revision,1);
    assert.deepEqual(a.fact_exclusions,expected.factExclusions??null);
  }
  const graph = (await db.query('SELECT manifest,relations FROM place_relation_snapshots WHERE city=$1',['济南'])).rows[0];
  assert.equal(graph.manifest.revision,14); assert.equal(graph.relations.length,20);
  const priorPending = before.tables.place_relation_snapshots[0].manifest.sourceState.mentions.filter((m: any) => m.status==='review');
  assert.equal(priorPending.length,60);
  for(const m of priorPending) assert.deepEqual(graph.manifest.sourceState.mentions.find((n: any) => n.mentionId===m.mentionId),m);
  const temple = byId.get('29f4a4b260878eb8d9143b15b8fca54f'); assert.ok(temple);
  assert.equal(temple.payload?.typicalVisitMinutes??null,null); assert.ok(JSON.stringify(temple.payload?.content).includes('宋代彩塑'));
  for(const name of ['王府池子','腾蛟泉','起凤泉','刘氏泉']) {
    const p = rows.find(r => r.name===name && r.verified); assert.ok(p); assert.equal(p.payload?.typicalVisitMinutes??null,null);
  }
  const trips = (await db.query("SELECT count(*)::int count,md5(COALESCE(string_agg(h,'' ORDER BY h),'')) digest FROM (SELECT md5(to_jsonb(t)::text) h FROM trips t) x")).rows[0];
  assert.deepEqual(trips,before.trips??(await read(folder+'pre-import-check.json')).trips);
  assert.deepEqual(trips,{count:201,digest:'e01d67cbf42a62fc595f4ef052f99e75'});
  const report = {readOnly:true,batch:40,capturedAt:new Date().toISOString(),consumedFieldsVerified:exported.length,fields,probes,
    badDescriptionsRemoved:true,oldEvidenceActuallyRemoved:true,independentFieldsPreserved:true,priorAssignments:11,
    newAssignments:4,excludedDescriptionFields:4,priorDurationExclusions:4,pendingMentions:60,boundaryChecks:18,trips,
    imageComparison:'deferred_by_user',fullReviewPassed:false,vectorReport:folder+'verification-vectors.json',failures:[]};
  await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({batch:40,consumedFieldsVerified:exported.length,probes,trips,failures:[]}));
} finally {
  await db.query('ROLLBACK').catch(() => {}); await db.end();
  await up.query('ROLLBACK').catch(() => {}); await up.end();
}
