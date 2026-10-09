// 第41批正式双库只读检查；不导入会自动迁移的应用db/client。
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Client } from 'pg';
import { parse } from 'dotenv';
import { placeNameKey } from '@tripweaver/shared';
import { createPlaceIdentityIndex } from '../../../../apps/server/src/lib/placeIdentity';
import { placeEmbeddingText } from '../../../../apps/server/src/lib/placeEmbeddingText';
import { createPlaceRetriever } from '../../../../apps/server/src/generation/placeRetrieval';
import type { PlaceRow } from '../../../../apps/server/src/generation/retrievalRanking';

const read = async (p: string) => JSON.parse(await readFile(new URL(p,import.meta.url),'utf8'));
const folder = 'all-cities/batch-41/sync-01/', city = '济南', eid = '2c8372d3a47dbcb68abd998af495436d';
const output = new URL('priority-cities/济南/platform-downstream-check-01.json',import.meta.url);
await readFile(output).then(() => {throw new Error('证据不能覆盖');}, (e: NodeJS.ErrnoException) => {if(e.code!=='ENOENT')throw e;});
const sync = (await read(folder+'sync-state.json')).cities[city];
assert.ok(sync.importedAt && sync.relationsImportedAt && sync.embeddingRunAt);
const bytes = await readFile(new URL(folder+'xhs-places-济南.json',import.meta.url));
assert.equal(createHash('sha256').update(bytes).digest('hex'),sync.exportHash);
const exported = JSON.parse(bytes.toString('utf8')).places as PlaceRow[];
const before = await read(folder+'preview-济南/library-before.json');
const vectors = await read(folder+'verification-vectors.json');
assert.deepEqual(vectors.failures,[]); assert.equal(vectors.cities[0].vectorProbes.length,1);
assert.equal(vectors.cities[0].vectorProbes[0].diagnostics.vector,'used');
const config = parse(await readFile('apps/server/.env'));
const upConfig = parse(await readFile('D:/Project/xhs-travel-pipeline/.env'));
const db = new Client({connectionString:config.DATABASE_URL,connectionTimeoutMillis:10000});
const up = new Client({connectionString:upConfig.DATABASE_URL!.replace('postgresql+asyncpg:','postgresql:'),connectionTimeoutMillis:10000});
try {
  await db.connect(); await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await up.connect(); await up.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const rows = (await db.query<PlaceRow>('SELECT id,city,name,category,lat,lng,verified,source,payload FROM canonical_places WHERE city=$1',[city])).rows;
  const byId = new Map(rows.map(p => [p.id,p]));
  const fields = ['identity','aliases','xhsPlaceType','content','topReasons','openHours','reservation','reservationNote','reservationEvidence','typicalVisitMinutes','mentionSources','themes'];
  for (const expected of exported) {
    const actual = byId.get(expected.id); assert.ok(actual);
    assert.equal(actual.name,expected.name); assert.equal(actual.category,expected.category);
    for (const field of fields) {
      let value = expected.payload?.[field]??null;
      if (field==='identity' && value) {
        const identity = value as {memberNames:string[]};
        value = {...identity, nameKeys:[...new Set([...identity.memberNames,...(expected.payload?.aliases as string[]??[])].map(placeNameKey))]};
      }
      assert.deepEqual(actual.payload?.[field]??null,value,`${actual.name}/${field}`);
    }
  }
  const p = byId.get(eid); assert.ok(p);
  assert.equal(p.name,'尚泉尚水茶馆前平台'); assert.equal(p.category,'自然'); assert.equal(p.payload?.xhsPlaceType,'photo_spot');
  assert.equal(p.lat,null); assert.equal(p.lng,null); assert.equal(p.payload?.geoStatus,'unresolvable');
  assert.equal(p.verified,true); assert.equal(p.payload?.identityWithdrawal,undefined);
  assert.equal((p.payload?.identity as any).revision,4);
  assert.deepEqual(p.payload?.aliases,[p.name]); assert.deepEqual(p.payload?.themes,[]);
  assert.deepEqual((p.payload?.mentionSources as any[]).map(m => m.mentionId),[12653]);
  const old = before.tables.canonical_places.find((r: PlaceRow) => r.id===eid); assert.ok(old);
  assert.equal(old.payload.xhsPlaceType,'cafe'); assert.equal(old.category,'美食');
  assert.notEqual(placeEmbeddingText(p),placeEmbeddingText(old));
  const retrieve = createPlaceRetriever({query:(sql,values) => db.query(sql,values), embed:async () => null});
  assert.equal((await retrieve([p.name],{city,category:'attraction',vector:'off'}))[0]?.canonicalPlaceId,eid);
  for (const name of [p.name,'尚泉尚水茶馆']) assert.ok(!(await retrieve([name],{city,category:'food',vector:'off',limit:48})).some(r => r.canonicalPlaceId===eid));
  const index = createPlaceIdentityIndex(rows.filter(p => p.verified || p.payload?.identityWithdrawal));
  for (const id of [undefined,eid]) {
    const good = index.resolve(city,p.name,id); assert.equal(good.status,'resolved');
    if(good.status==='resolved') assert.equal(good.canonicalPlaceId,eid);
    const bad = index.resolve(city,'尚泉尚水茶馆',id); assert.ok(bad.status!=='resolved' || bad.canonicalPlaceId!==eid);
  }
  const evidence = (await db.query('SELECT content FROM research_evidence WHERE place_id=$1',[eid])).rows;
  assert.ok(evidence.some(e => e.content.includes('前面平台可拍摄湖面与楼阁全景')));
  const scopes = (await Promise.all([36,40,41].map(n => read(`all-cities/batch-${n}-scope-decisions.json`)))).flat();
  const assignments = (await up.query('SELECT mention_id,entity_id,input_hash,revision,change_key,fact_exclusions FROM place_mention_assignment WHERE mention_id=ANY($1::int[])',
    [scopes.flatMap((s: any) => s.assignments.map((a: any) => a.mentionId))])).rows;
  assert.equal(assignments.length,16);
  for (const s of scopes) for (const expected of s.assignments) {
    const a = assignments.find(a => Number(a.mention_id)===expected.mentionId); assert.ok(a);
    assert.equal(a.entity_id,expected.entityId); assert.equal(a.input_hash,expected.inputHash);
    assert.equal(a.change_key,s.key); assert.equal(a.revision,1); assert.deepEqual(a.fact_exclusions,expected.factExclusions??null);
  }
  for (const targetId of ['69b816cda273f29ed9296314fbe6f52d','abc624edea07111dc19aa79dfbb18289']) {
    const row = byId.get(targetId); assert.ok(row);
    assert.doesNotMatch(JSON.stringify(row.payload),/泉水茶|登高怀古|千年文脉|济南动物园/);
    const e = (await db.query('SELECT content FROM research_evidence WHERE place_id=$1 AND kind LIKE $2',[targetId,'xhs_%'])).rows;
    assert.ok(e.every(e => !/泉水茶|登高怀古|千年文脉|济南动物园/.test(e.content)));
  }
  const graph = (await db.query('SELECT manifest,relations FROM place_relation_snapshots WHERE city=$1',[city])).rows[0];
  assert.equal(graph.manifest.revision,15); assert.equal(graph.relations.length,20);
  const priorPending = before.tables.place_relation_snapshots[0].manifest.sourceState.mentions.filter((m: any) => m.status==='review');
  assert.equal(priorPending.length,60);
  for (const m of priorPending) assert.deepEqual(graph.manifest.sourceState.mentions.find((n: any) => n.mentionId===m.mentionId),m);
  for (const name of ['灵岩寺','王府池子','腾蛟泉','起凤泉','刘氏泉']) {
    const row = rows.find(r => r.name===name && r.verified); assert.ok(row); assert.equal(row.payload?.typicalVisitMinutes??null,null);
    if(name==='灵岩寺') assert.ok(JSON.stringify(row.payload?.content).includes('宋代彩塑'));
  }
  const trips = (await db.query("SELECT count(*)::int count,md5(COALESCE(string_agg(h,'' ORDER BY h),'')) digest FROM (SELECT md5(to_jsonb(t)::text) h FROM trips t) x")).rows[0];
  assert.deepEqual(trips,(await read(folder+'pre-import-check.json')).trips);
  assert.deepEqual(trips,{count:201,digest:'e01d67cbf42a62fc595f4ef052f99e75'});
  const report = {readOnly:true,batch:41,capturedAt:new Date().toISOString(),consumedFieldsVerified:exported.length,fields,
    entityId:eid,canonicalName:p.name,category:p.category,fineType:p.payload?.xhsPlaceType,
    exactNameSql:true,bareCafeNameCannotBind:true,foodQueryExcluded:true,validDescriptionPreserved:true,coordinatesRemainNull:true,
    priorAssignments:15,newAssignments:1,priorDescriptionExclusions:4,priorDurationExclusions:4,pendingMentions:60,trips,
    imageComparison:'deferred_by_user',fullReviewPassed:false,vectorReport:folder+'verification-vectors.json',failures:[]};
  await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({batch:41,consumedFieldsVerified:exported.length,fineType:p.payload?.xhsPlaceType,foodQueryExcluded:true,trips,failures:[]}));
} finally {
  await db.query('ROLLBACK').catch(() => {}); await db.end();
  await up.query('ROLLBACK').catch(() => {}); await up.end();
}
