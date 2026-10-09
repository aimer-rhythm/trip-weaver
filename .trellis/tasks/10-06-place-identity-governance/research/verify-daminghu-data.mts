// 第42批正式双库只读核验；实际SQL别名探针补足仅scope批次的通用检查。
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Client } from 'pg';
import { parse } from 'dotenv';
import { placeNameKey } from '@tripweaver/shared';
import { createPlaceIdentityIndex } from '../../../../apps/server/src/lib/placeIdentity';
import { createPlaceRetriever } from '../../../../apps/server/src/generation/placeRetrieval';
import type { PlaceRow } from '../../../../apps/server/src/generation/retrievalRanking';

const read = async (p:string) => JSON.parse(await readFile(new URL(p,import.meta.url),'utf8'));
const folder = 'all-cities/batch-42/sync-01/', city = '济南', eid = '550d6810857b4487aae8ce39c9ee093b';
const output = new URL('priority-cities/济南/daminghu-downstream-check-01.json',import.meta.url);
await readFile(output).then(() => {throw new Error('证据不能覆盖');}, (e:NodeJS.ErrnoException) => {if(e.code!=='ENOENT')throw e;});
const sync = (await read(folder+'sync-state.json')).cities[city];
assert.ok(sync.importedAt && sync.relationsImportedAt && sync.embeddingRunAt);
const bytes = await readFile(new URL(folder+'xhs-places-济南.json',import.meta.url));
assert.equal(createHash('sha256').update(bytes).digest('hex'),sync.exportHash);
const exported = JSON.parse(bytes.toString('utf8')).places as PlaceRow[];
const before = await read(folder+'preview-济南/library-before.json');
const source = await read('all-cities/batch-42-source.json');
const expectedScopes = (await Promise.all([36,40,41,42].map(n => read(`all-cities/batch-${n}-scope-decisions.json`)))).flat();
const scope = expectedScopes.find(s => s.sourcePlaceId===5348);
const confirmed = scope.assignments.filter((a:any) => a.entityId).map((a:any) => a.mentionId).sort((a:number,b:number) => a-b);
const pending = scope.assignments.filter((a:any) => !a.entityId).map((a:any) => a.mentionId);
assert.equal(confirmed.length,48); assert.equal(pending.length,17);
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
    for (const field of ['name','category','lat','lng','verified'] as const) assert.equal(actual[field],expected[field]);
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
  assert.equal(p.name,'大明湖'); assert.equal(p.category,'自然'); assert.equal(p.verified,true);
  assert.equal(p.payload?.identityWithdrawal,undefined); assert.equal((p.payload?.identity as any).revision,3);
  assert.deepEqual(p.payload?.aliases,source.entity.aliases);
  assert.equal(p.payload?.typicalVisitMinutes,120);
  assert.deepEqual((p.payload?.mentionSources as any[]).map(m => m.mentionId).sort((a,b) => a-b),confirmed);
  assert.deepEqual((p.payload?.imageIdentity as any).approved,[]);
  const old = before.tables.canonical_places.find((r:PlaceRow) => r.id===eid); assert.ok(old);
  assert.equal(p.lat,old.lat); assert.equal(p.lng,old.lng);
  for (const field of ['coverImage','imageGallery','amapPhoto','imageIdentity']) assert.equal(old.payload[field],undefined);
  const retrieve = createPlaceRetriever({query:(sql,values) => db.query(sql,values),embed:async () => null});
  const sqlProbes = [];
  for (const alias of source.entity.aliases) {
    const hits = await retrieve([alias],{city,category:'attraction',vector:'off'});
    assert.equal(hits[0]?.canonicalPlaceId,eid);
    assert.equal(new Set(hits.map(h => h.canonicalPlaceId)).size,hits.length);
    sqlProbes.push({name:alias,first:eid});
  }
  const index = createPlaceIdentityIndex(rows.filter(p => p.verified || p.payload?.identityWithdrawal));
  const boundaries = ['大明湖南门','大明湖景区(南门)','湖畔雨荷','大明湖南丰祠码头旁机位','尚泉尚水茶馆','超然楼'];
  for (const id of [undefined,...source.entity.legacy_ids]) {
    for (const name of source.entity.aliases) {
      const result = index.resolve(city,name,id); assert.equal(result.status,'resolved');
      if(result.status==='resolved') assert.equal(result.canonicalPlaceId,eid);
    }
    for (const name of boundaries) {
      const result = index.resolve(city,name,id); assert.ok(result.status!=='resolved' || result.canonicalPlaceId!==eid);
    }
  }
  const evidence = (await db.query('SELECT content FROM research_evidence WHERE place_id=$1 AND kind LIKE $2',[eid,'xhs_%'])).rows;
  assert.ok(evidence.some(e => /环湖|湖景/.test(e.content)));
  const assignments = (await up.query('SELECT mention_id,entity_id,input_hash,revision,change_key,fact_exclusions FROM place_mention_assignment WHERE mention_id=ANY($1::int[])',
    [expectedScopes.flatMap((s:any) => s.assignments.map((a:any) => a.mentionId))])).rows;
  assert.equal(assignments.length,81);
  for (const s of expectedScopes) for (const expected of s.assignments) {
    const a = assignments.find(a => Number(a.mention_id)===expected.mentionId); assert.ok(a);
    assert.equal(a.entity_id,expected.entityId); assert.equal(a.input_hash,expected.inputHash);
    assert.equal(a.change_key,s.key); assert.equal(a.revision,1); assert.deepEqual(a.fact_exclusions,expected.factExclusions??null);
  }
  const graph = (await db.query('SELECT manifest,relations FROM place_relation_snapshots WHERE city=$1',[city])).rows[0];
  assert.equal(graph.manifest.revision,16); assert.equal(graph.relations.length,20);
  assert.equal(graph.relations.filter((r:any) => r.strength==='direct').length,7);
  const priorPending = before.tables.place_relation_snapshots[0].manifest.sourceState.mentions.filter((m:any) => m.status==='review');
  assert.equal(priorPending.length,60);
  for (const m of priorPending) assert.deepEqual(graph.manifest.sourceState.mentions.find((n:any) => n.mentionId===m.mentionId),m);
  const currentPending = graph.manifest.sourceState.mentions.filter((m:any) => m.status==='review'); assert.equal(currentPending.length,77);
  for (const id of pending) assert.ok(currentPending.some((m:any) => m.mentionId===id));
  for (const name of ['灵岩寺','王府池子','腾蛟泉','起凤泉','刘氏泉']) {
    const row = rows.find(r => r.name===name && r.verified); assert.ok(row); assert.equal(row.payload?.typicalVisitMinutes??null,null);
    if(name==='灵岩寺') assert.ok(JSON.stringify(row.payload?.content).includes('宋代彩塑'));
  }
  for (const target of ['69b816cda273f29ed9296314fbe6f52d','abc624edea07111dc19aa79dfbb18289']) {
    const row = byId.get(target); assert.ok(row); assert.doesNotMatch(JSON.stringify(row.payload),/泉水茶|登高怀古|千年文脉|济南动物园/);
  }
  const platformId = '2c8372d3a47dbcb68abd998af495436d', platform = byId.get(platformId); assert.ok(platform);
  assert.equal(platform.name,'尚泉尚水茶馆前平台'); assert.equal(platform.payload?.xhsPlaceType,'photo_spot');
  assert.equal(platform.lat,null); assert.equal(platform.lng,null);
  assert.ok(JSON.stringify(platform.payload?.content).includes('前面平台可拍摄湖面与楼阁全景'));
  const cafe = index.resolve(city,'尚泉尚水茶馆',platformId); assert.ok(cafe.status!=='resolved' || cafe.canonicalPlaceId!==platformId);
  const trips = (await db.query("SELECT count(*)::int count,md5(COALESCE(string_agg(h,'' ORDER BY h),'')) digest FROM (SELECT md5(to_jsonb(t)::text) h FROM trips t) x")).rows[0];
  assert.deepEqual(trips,(await read(folder+'pre-import-check.json')).trips);
  assert.deepEqual(trips,{count:201,digest:'e01d67cbf42a62fc595f4ef052f99e75'});
  const report = {readOnly:true,batch:42,capturedAt:new Date().toISOString(),consumedFieldsVerified:exported.length,fields,
    entityId:eid,canonicalName:p.name,category:p.category,effectiveMinutes:120,sqlProbes,
    legacyIds:source.entity.legacy_ids,boundaries,confirmed:48,pendingAdded:17,pendingMentions:77,
    priorAssignments:16,newAssignments:65,subjectDurationExclusions:1,coordinatesPreserved:true,priorPlatformPreserved:true,
    graph:20,directEdges:7,trips,imageComparison:'deferred_by_user',fullReviewPassed:false,
    vectorReport:folder+'verification-vectors.json',failures:[]};
  await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({batch:42,consumedFieldsVerified:exported.length,sqlAliases:sqlProbes.length,effectiveMinutes:120,pendingMentions:77,trips,failures:[]}));
} finally {
  await db.query('ROLLBACK').catch(() => {}); await db.end();
  await up.query('ROLLBACK').catch(() => {}); await up.end();
}
