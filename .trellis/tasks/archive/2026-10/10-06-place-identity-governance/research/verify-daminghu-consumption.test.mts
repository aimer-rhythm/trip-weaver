import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createPlaceIdentityIndex } from '../../../../apps/server/src/lib/placeIdentity';
import type { PlaceRow } from '../../../../apps/server/src/generation/retrievalRanking';
import { createPlaceRetriever } from '../../../../apps/server/src/generation/placeRetrieval';

assert.match(process.env.DATABASE_URL ?? '', /127\.0\.0\.1:18798\/place_identity_test_\d+$/);
const { pool } = await import('../../../../apps/server/src/db/client');
const { loadCityPlaceFacts } = await import('../../../../apps/server/src/generation/scheduling/placeFacts');
after(() => pool.end());

test('第42批真实城市双导入后，大明湖三名同一主体、有效120分钟，门/灯/楼不能借旧ID绑定', async () => {
  const folder = new URL('all-cities/batch-42/sync-01/',import.meta.url);
  const read = async (name:string) => JSON.parse(await readFile(new URL(name,folder),'utf8'));
  const sync = (await read('sync-state.json')).cities['济南'];
  assert.ok(sync.importedAt && sync.relationsImportedAt);
  const state = await read('preview-济南/state.json');
  const libraryBytes = await readFile(new URL('preview-济南/library-before.json',folder));
  assert.equal(createHash('sha256').update(libraryBytes).digest('hex'),state.libraryHash);
  const library = JSON.parse(libraryBytes.toString('utf8'));
  const bytes = await readFile(new URL('xhs-places-济南.json',folder));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),sync.exportHash);
  const exported = JSON.parse(bytes.toString('utf8'));
  const eid = '550d6810857b4487aae8ce39c9ee093b', city = '济南';
  for (const table of ['canonical_places','research_evidence','place_relation','data_import','independent_photo_assignments','place_relation_snapshots']) {
    await pool.query(`INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(NULL::${table},$1::jsonb)`,[JSON.stringify(library.tables[table])]);
  }
  for (const kind of ['places','relations']) {
    await promisify(execFile)(process.execPath,['--import','tsx',
      fileURLToPath(new URL(`../../../../apps/server/scripts/seed-xhs-${kind}.ts`,import.meta.url)),
      fileURLToPath(new URL(`xhs-${kind==='places'?'places':'place-relations'}-济南.json`,folder))],
    {env:process.env,windowsHide:true,timeout:60000});
  }
  const rows = (await pool.query<PlaceRow>('SELECT id,city,name,category,lat,lng,verified,source,payload FROM canonical_places WHERE city=$1',[city])).rows;
  const p = rows.find(p => p.id===eid); assert.ok(p);
  const expected = exported.places.find((p:PlaceRow) => p.id===eid); assert.ok(expected);
  const aliases = ['大明湖','大明湖公园','大明湖景区'];
  assert.equal(p.name,'大明湖'); assert.equal(p.category,'自然');
  assert.equal(p.payload?.typicalVisitMinutes,120);
  assert.deepEqual(p.payload?.aliases,aliases);
  for (const key of ['mentionSources','themes','content','topReasons','imageIdentity']) assert.deepEqual(p.payload?.[key],expected.payload[key]);
  assert.equal((p.payload?.mentionSources as any[]).length,48);
  const index = createPlaceIdentityIndex(rows.filter(p => p.verified || p.payload?.identityWithdrawal));
  const retrieve = createPlaceRetriever({query:(sql,values) => pool.query(sql,values),embed:async () => null});
  for (const id of [undefined,...expected.payload.identity.memberIds]) {
    for (const name of aliases) {
      const result = index.resolve(city,name,id); assert.equal(result.status,'resolved');
      if(result.status==='resolved') assert.equal(result.canonicalPlaceId,eid);
    }
    for (const name of ['大明湖南门','大明湖景区(南门)','湖畔雨荷','大明湖南丰祠码头旁机位','尚泉尚水茶馆','超然楼']) {
      const result = index.resolve(city,name,id); assert.ok(result.status!=='resolved' || result.canonicalPlaceId!==eid);
    }
  }
  const facts = await loadCityPlaceFacts(city);
  for (const alias of aliases) {
    const fact = facts.get(alias); assert.ok(fact);
    assert.equal(fact.canonicalPlaceId,eid); assert.equal(fact.category,'自然'); assert.equal(fact.visitMinutes,120);
    assert.deepEqual(fact.aliases,aliases); assert.equal(fact.lat,p.lat); assert.equal(fact.lng,p.lng);
    assert.equal((await retrieve([alias],{city,category:'attraction',vector:'off'}))[0]?.canonicalPlaceId,eid);
  }
  const platform = facts.get('尚泉尚水茶馆前平台'); assert.ok(platform); assert.equal(platform.placeType,'photo_spot');
  assert.equal(facts.get('尚泉尚水茶馆'),undefined);
  for (const name of ['灵岩寺','王府池子','腾蛟泉','起凤泉','刘氏泉']) {
    const fact = facts.get(name); assert.ok(fact); assert.equal(fact.visitMinutes,undefined);
  }
  const report = {batch:42,isolated:true,synthetic:false,fullCityPlaces:exported.places.length,
    actualPlaceFactsMinutes:120,sqlAliases:3,aliases,legacyIds:expected.payload.identity.memberIds,
    independentSubjectBoundaries:true,confirmedMentionSources:48,priorPlatformAndSpringDurationsPreserved:true,
    imageComparison:'deferred_by_user',fullReviewPassed:false,failures:[]};
  await writeFile(new URL(`daminghu-consumption-${Date.now()}.json`,folder),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(report));
});
