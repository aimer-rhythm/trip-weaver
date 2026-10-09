// 完整成都实库基线在临时库双导入，实际facts及全城旧主名图库逐项比较；不看图。
import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {readFile,writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {placeNameKey} from '@tripweaver/shared';
import {createPlaceIdentityIndex,placeNames} from '../../../../apps/server/src/lib/placeIdentity';
import type {PlaceRow} from '../../../../apps/server/src/generation/retrievalRanking';
assert.match(process.env.DATABASE_URL??'',/127\.0\.0\.1:18798\/place_identity_test_\d+$/);
const {pool}=await import('../../../../apps/server/src/db/client');
const {loadCityPlaceFacts}=await import('../../../../apps/server/src/generation/scheduling/placeFacts');
const {createGenerationPhotoLookup}=await import('../../../../apps/server/src/integrations/photoEnrichment');
const {loadIndependentPhotoSources,photoIdentityDigest}=await import('../../../../apps/server/src/services/independentPhotoSources');
after(()=>pool.end());
test('两分区事实及全城旧图库返回保全',async()=>{
  const read=async(p:string)=>JSON.parse(await readFile(new URL(p,import.meta.url),'utf8'));
  const folder='all-cities/batch-66/sync-01/',library=await read('priority-cities/成都/run-1791504271958861000/library-before.json');
  const decisions=await read('all-cities/batch-66-decisions.json'),ids=decisions.map((d:any)=>d.entityId);
  for(const table of ['canonical_places','research_evidence','place_relation','data_import','independent_photo_assignments','place_relation_snapshots'])
    await pool.query(`INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(NULL::${table},$1::jsonb)`,[JSON.stringify(library.tables[table])]);
  const before=await loadCityPlaceFacts('成都');
  const inputs=await loadIndependentPhotoSources('成都');assert.deepEqual(inputs.warnings,[]);
  assert.equal(photoIdentityDigest(inputs),(await read('priority-cities/成都/park-zones-photo-metadata-01.json')).inputDigest);
  const queued:string[]=[];
  const makeLookup=(rows:PlaceRow[])=>createGenerationPhotoLookup('成都',async()=>createPlaceIdentityIndex(rows.filter(p=>p.verified||p.payload?.identityWithdrawal).map(p=>({...p,aliases:placeNames(p),evidence:[]}))),
    {loadSources:async()=>inputs,loadAssignments:async()=>library.tables.independent_photo_assignments,adoption:{adoptUnsplash:async()=>false},enqueue:async(_city,name)=>{queued.push(name);}});
  const oldLookup=makeLookup(library.tables.canonical_places),oldMedia=new Map<string,Awaited<ReturnType<typeof oldLookup>>>();
  for(const p of library.tables.canonical_places.filter((p:PlaceRow)=>p.verified))oldMedia.set(p.name,await oldLookup(p.name));
  const beforeCalls=[...queued];queued.length=0;
  for(const kind of ['places','relations'])await promisify(execFile)(process.execPath,['--import','tsx',fileURLToPath(new URL(`../../../../apps/server/scripts/seed-xhs-${kind}.ts`,import.meta.url)),fileURLToPath(new URL(folder+`xhs-${kind==='places'?'places':'place-relations'}-成都.json`,import.meta.url))],{env:process.env,windowsHide:true,timeout:60000});
  const afterFacts=await loadCityPlaceFacts('成都');
  for(const [name,value]of before)if(!ids.includes(value.canonicalPlaceId))assert.deepEqual(afterFacts.get(name),value,`其他主体facts/${name}`);
  for(const d of decisions){const p=afterFacts.get(placeNameKey(d.canonicalName));assert.ok(p);assert.equal(p.canonicalPlaceId,d.entityId);assert.equal(p.lat,undefined);assert.equal(p.lng,undefined);assert.equal(p.adcode,undefined);assert.equal(p.mentionCount,1);assert.equal(p.visitMinutes,undefined);assert.equal(p.category,'文化');assert.equal(p.placeType,'attraction');}
  assert.ok(!afterFacts.has(placeNameKey('萌宠片区')));
  const rows=(await pool.query<PlaceRow>('SELECT id,city,name,category,lat,lng,verified,source,payload FROM canonical_places WHERE city=$1',['成都'])).rows;
  const lookup=makeLookup(rows);const media=[];
  for(const [name,old]of oldMedia){const actual=await lookup(name);assert.deepEqual(actual,old,`旧主名图库/${name}`);if(old)media.push({name,count:old.photos?.length??0,digest:photoIdentityDigest(old)});}
  assert.deepEqual(queued,beforeCalls.filter(n=>n!=='龙溪谷大型野趣戏水区'));
  const oldNameAfter=queued.length;
  for(const d of decisions)assert.equal(await lookup(d.canonicalName),null);
  assert.equal(queued.length,oldNameAfter);
  assert.ok(queued.includes('萌宠片区'));assert.ok(!queued.includes('龙溪谷大型野趣戏水区'));
  const report={batch:66,isolated:true,actualPlaceFacts:true,otherFactsPreserved:true,oldCanonicalMediaProbes:oldMedia.size,nonEmptyOldMedia:media,
    allOldMediaReturnsPreserved:true,newZoneNamesPhotos:0,newNameMockEnqueues:0,excludedPetBareNameFallback:true,
    oldNameMockEnqueues:{before:beforeCalls.length,after:oldNameAfter},actualEnqueues:0,sourceDigestPreserved:true,imageComparison:'deferred_by_user',failures:[]};
  await writeFile(new URL(folder+`park-zones-consumption-${Date.now()}.json`,import.meta.url),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
});
