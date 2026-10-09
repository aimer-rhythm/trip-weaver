// 全城双导入后实际事实与图库入口；只比较返回对象，不查看图片、不写补图队列。
import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile} from 'node:fs/promises';
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
test('夜市迁址名称地址与旧导航隔离、三条负评及旧图库保持',async()=>{
  const folder=new URL('all-cities/batch-59/sync-01/',import.meta.url);
  const read=async(p:string)=>JSON.parse(await readFile(new URL(p,folder),'utf8'));
  const sync=(await read('sync-state.json')).cities['济南'];assert.ok(sync.importedAt&&sync.relationsImportedAt);
  const bytes=await readFile(new URL('preview-济南/library-before.json',folder));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),(await read('preview-济南/state.json')).libraryHash);
  const library=JSON.parse(bytes.toString('utf8'));
  const exportBytes=await readFile(new URL('xhs-places-济南.json',folder));assert.equal(createHash('sha256').update(exportBytes).digest('hex'),sync.exportHash);
  for(const table of ['canonical_places','research_evidence','place_relation','data_import','independent_photo_assignments','place_relation_snapshots'])
    await pool.query(`INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(NULL::${table},$1::jsonb)`,[JSON.stringify(library.tables[table])]);
  const source=JSON.parse(await readFile(new URL('all-cities/batch-59-source.json',import.meta.url),'utf8'));
  const eid='7950bfadd891932d01be8636aba8b51a',oldName='环联夜市',newName='环联1904火车夜市';
  const before=await loadCityPlaceFacts('济南');
  const inputs=await loadIndependentPhotoSources('济南');assert.deepEqual(inputs.warnings,[]);
  const freeze=JSON.parse(await readFile(new URL('priority-cities/济南/night-market-photo-metadata-01.json',import.meta.url),'utf8'));
  assert.equal(photoIdentityDigest(inputs),freeze.inputDigest);
  assert.equal(freeze.entities[0].independentSources.length,10);assert.ok(freeze.entities[0].independentSources.every((s:any)=>s.eligible===false));assert.equal(freeze.entities[0].assignments.length,0);
  let queued=0;
  const makeIndex=(rows:PlaceRow[])=>createPlaceIdentityIndex(rows.filter(p=>p.verified||p.payload?.identityWithdrawal).map(p=>({...p,aliases:placeNames(p),evidence:[]})));
  const makeLookup=(rows:PlaceRow[])=>createGenerationPhotoLookup('济南',async()=>makeIndex(rows),{loadSources:async()=>inputs,
    loadAssignments:async()=>library.tables.independent_photo_assignments,adoption:{adoptUnsplash:async()=>false},enqueue:async()=>{queued++;}});
  const oldLookup=makeLookup(library.tables.canonical_places),beforeMedia=new Map();
  for(const name of ['老商埠','经三路','老舍故居',oldName])beforeMedia.set(name,await oldLookup(name));
  const beforeMockEnqueues=queued;assert.equal(beforeMockEnqueues,1);queued=0;
  for(const kind of ['places','relations'])await promisify(execFile)(process.execPath,['--import','tsx',
    fileURLToPath(new URL(`../../../../apps/server/scripts/seed-xhs-${kind}.ts`,import.meta.url)),
    fileURLToPath(new URL(`xhs-${kind==='places'?'places':'place-relations'}-济南.json`,folder))],{env:process.env,windowsHide:true,timeout:60000});
  const facts=await loadCityPlaceFacts('济南');
  const current=facts.get(placeNameKey(newName)),old=before.get(placeNameKey(oldName));assert.ok(current&&old);
  assert.equal(current.canonicalPlaceId,eid);assert.equal(current.placeType,'market');assert.equal(current.category,'购物');
  assert.equal(current.mentionCount,4);assert.equal(old.mentionCount,5);assert.equal(current.lat,old.lat);assert.equal(current.lng,old.lng);
  assert.deepEqual(facts.get(placeNameKey(oldName)),current);assert.equal(current.visitMinutes,undefined);
  const p=(await pool.query('SELECT name,payload FROM canonical_places WHERE id=$1',[eid])).rows[0];
  const previous=library.tables.canonical_places.find((p:any)=>p.id===eid);
  assert.equal(p.name,newName);assert.equal(p.payload.address,'祝舜路555号');assert.match(previous.payload.content.intro,/祝舜路1469号/);
  assert.doesNotMatch(JSON.stringify(p.payload),/祝舜路1469号|祝甸站/);
  assert.deepEqual(p.payload.content.highlights,previous.payload.content.highlights.slice(2));
  assert.deepEqual(p.payload.mentionSources.map((m:any)=>m.mentionId).sort((a:number,b:number)=>a-b),[11571,11607,12647,12825]);
  const evidence=(await pool.query('SELECT kind,content FROM research_evidence WHERE place_id=$1 AND kind LIKE $2',[eid,'xhs_%'])).rows;
  const expected=source.mentions.filter((m:any)=>m.id!==11464).map((m:any)=>({kind:m.sentiment==='negative'?'xhs_warning':'xhs_reason',content:m.reason}));
  assert.deepEqual(new Set(evidence.map(e=>JSON.stringify(e))),new Set(expected.map((e:any)=>JSON.stringify(e))));assert.equal(evidence.filter(e=>e.kind==='xhs_warning').length,3);
  for(const [name,value] of before)if(value.canonicalPlaceId!==eid)assert.deepEqual(facts.get(name),value,`其他主体事实/${name}`);
  const rows=(await pool.query<PlaceRow>('SELECT id,city,name,category,lat,lng,verified,source,payload FROM canonical_places WHERE city=$1',['济南'])).rows;
  const index=makeIndex(rows),lookup=makeLookup(rows),media=[];
  for(const [name,count,digest] of [['老商埠',3,'2c29d7b93a412f38eb21d6ce3ece4f175e0576dee87bee3a179d5bb095868603'],
    ['经三路',1,'2143dbc77997beeaf461e337c7f018783583096ae8e60dac777fba41cdbefddd'],
    ['老舍故居',2,'5b29595c5b0ea1e07d65dc896d5f79992af0e3a406b6ebe06a67289a9ed96b9c']] as const) {
    const result=await lookup(name);assert.deepEqual(result,beforeMedia.get(name));assert.equal(result?.photos?.length,count);assert.equal(photoIdentityDigest(result),digest);media.push({name,count,digest});
  }
  const canonicalized=[];
  for(const name of ['老舍故居','济南老舍纪念馆','老舍纪念馆']) {
    const resolved=index.resolve('济南',name);assert.ok(resolved.status==='resolved');assert.equal(resolved.place.name,'老舍故居');
    const result=await lookup(resolved.place.name);assert.deepEqual(result,beforeMedia.get('老舍故居'));
    canonicalized.push({input:name,canonicalName:resolved.place.name,photos:result?.photos?.length});
  }
  assert.equal(beforeMedia.get(oldName),null);
  for(const name of [oldName,newName]) {
    const resolved=index.resolve('济南',name);assert.ok(resolved.status==='resolved');assert.equal(resolved.canonicalPlaceId,eid);
    assert.equal(await lookup(name),null);assert.equal(await lookup(resolved.place.name),null);
  }
  assert.equal(queued,0);assert.equal(photoIdentityDigest(await loadIndependentPhotoSources('济南')),freeze.inputDigest);
  const report={batch:59,isolated:true,synthetic:false,fullCityPlaces:JSON.parse(exportBytes.toString('utf8')).places.length,
    actualPlaceFacts:true,priorGovernedFactsPreserved:true,confirmedIdentityPreserved:true,confirmedContentAndEvidencePreserved:true,negativeConfirmed:3,positiveConfirmed:1,staleNavigationRemoved:true,
    coordinatesCleared:0,coordinatesPreservedNotNewlyVerified:true,categoriesCorrected:0,addressesCorrected:1,independentIdentityPreserved:true,media,canonicalized,
    independentSourceDigestUnchanged:true,independentSources:10,eligibleIndependentSources:0,mockEnqueueCalls:{before:beforeMockEnqueues,after:queued},actualEnqueues:0,
    enqueueMeaning:'市场新旧名称实际返回null，scope抑制旧补图回退，mock1→0；10个独立来源均不eligible，未认领图片。旧3/1/2图库保持，真实队列未写入。',
    imageComparison:'deferred_by_user',failures:[]};
  await writeFile(new URL(`night-market-consumption-${Date.now()}.json`,folder),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
});
