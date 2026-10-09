// 真实全城导入后的事实消费与旧图库保全；不查看图片、不入补图队列。
import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {placeNameKey} from '@tripweaver/shared';
assert.match(process.env.DATABASE_URL??'',/127\.0\.0\.1:18798\/place_identity_test_\d+$/);
const {pool}=await import('../../../../apps/server/src/db/client');
const {loadCityPlaceFacts}=await import('../../../../apps/server/src/generation/scheduling/placeFacts');
const {createGenerationPhotoLookup}=await import('../../../../apps/server/src/integrations/photoEnrichment');
const {loadIndependentPhotoSources,photoIdentityDigest}=await import('../../../../apps/server/src/services/independentPhotoSources');
after(()=>pool.end());
test('第50批实际事实清除猜测坐标、分别消费店铺类别，已有内容与图库保持',async()=>{
  const folder=new URL('all-cities/batch-50/sync-01/',import.meta.url);
  const read=async(p:string)=>JSON.parse(await readFile(new URL(p,folder),'utf8'));
  const sync=(await read('sync-state.json')).cities['济南'];assert.ok(sync.importedAt&&sync.relationsImportedAt);
  const bytes=await readFile(new URL('preview-济南/library-before.json',folder));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),(await read('preview-济南/state.json')).libraryHash);
  const library=JSON.parse(bytes.toString('utf8'));
  const exportBytes=await readFile(new URL('xhs-places-济南.json',folder));assert.equal(createHash('sha256').update(exportBytes).digest('hex'),sync.exportHash);
  for(const table of ['canonical_places','research_evidence','place_relation','data_import','independent_photo_assignments','place_relation_snapshots'])
    await pool.query(`INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(NULL::${table},$1::jsonb)`,[JSON.stringify(library.tables[table])]);
  const before=await loadCityPlaceFacts('济南');
  const inputs=await loadIndependentPhotoSources('济南');assert.deepEqual(inputs.warnings,[]);
  const freeze=JSON.parse(await readFile(new URL('priority-cities/济南/vintage-photo-metadata-01.json',import.meta.url),'utf8'));
  assert.equal(photoIdentityDigest(inputs),freeze.inputDigest);
  let queued=0;
  const makeLookup=()=>createGenerationPhotoLookup('济南',undefined,{loadSources:async()=>inputs,
    loadAssignments:async()=>library.tables.independent_photo_assignments,adoption:{adoptUnsplash:async()=>false},enqueue:async()=>{queued++;}});
  const oldLookup=makeLookup();const beforeMedia=new Map();
  for(const name of ['老商埠','经三路','VILLASHAKA','BLUEDUCK骨董屋'])beforeMedia.set(name,await oldLookup(name));
  const beforeMockEnqueues=queued;assert.equal(beforeMockEnqueues,2);queued=0;
  for(const kind of ['places','relations'])await promisify(execFile)(process.execPath,['--import','tsx',
    fileURLToPath(new URL(`../../../../apps/server/scripts/seed-xhs-${kind}.ts`,import.meta.url)),
    fileURLToPath(new URL(`xhs-${kind==='places'?'places':'place-relations'}-济南.json`,folder))],{env:process.env,windowsHide:true,timeout:60000});
  const facts=await loadCityPlaceFacts('济南');
  const targets=['2ccb52ac3eeda4ca713a2b7bd975b566','46bf3d4bc9d5aa019dd4a3184329e58a'];
  for(const [name,id,type,category] of [['VILLASHAKA',targets[0],'cafe','美食'],['BLUEDUCK骨董屋',targets[1],'shop','购物']] as const) {
    const p=facts.get(placeNameKey(name)),old=before.get(placeNameKey(name));assert.ok(p&&old);assert.equal(p.canonicalPlaceId,id);assert.equal(p.placeType,type);assert.equal(p.category,category);
    assert.equal(p.mentionCount,1);assert.equal(p.visitMinutes,undefined);assert.equal(p.lat,undefined);assert.equal(p.lng,undefined);
    assert.equal(old.lat,36.664939);assert.equal(old.lng,117.025436);
    const expected={...old,category};delete expected.lat;delete expected.lng;assert.deepEqual(p,expected);
  }
  for(const [name,value] of before)if(!targets.includes(value.canonicalPlaceId??''))assert.deepEqual(facts.get(name),value,`其他主体事实/${name}`);
  const kept=(await pool.query('SELECT name,payload FROM canonical_places WHERE id=ANY($1::text[])',[targets])).rows;
  for(const p of kept){
    const prior=library.tables.canonical_places.find((r:any)=>r.name===p.name);assert.ok(prior);
    for(const k of ['intro','highlights'])assert.deepEqual(p.payload.content[k],prior.payload.content[k]);
    assert.equal(p.payload.mentionSources,undefined);assert.equal(p.payload.geoStatus,'unresolvable');
  }
  const lookup=makeLookup();
  const media=[];
  for(const [name,count,digest] of [['老商埠',3,'2c29d7b93a412f38eb21d6ce3ece4f175e0576dee87bee3a179d5bb095868603'],
    ['经三路',1,'2143dbc77997beeaf461e337c7f018783583096ae8e60dac777fba41cdbefddd']] as const) {
    const result=await lookup(name);assert.deepEqual(result,beforeMedia.get(name));assert.equal(result?.photos?.length,count);assert.equal(photoIdentityDigest(result),digest);media.push({name,count,digest});
  }
  for(const name of ['VILLASHAKA','BLUEDUCK骨董屋']){assert.equal(beforeMedia.get(name),null);assert.equal(await lookup(name),null);}
  assert.equal(queued,beforeMockEnqueues);
  const report={batch:50,isolated:true,synthetic:false,fullCityPlaces:JSON.parse(exportBytes.toString('utf8')).places.length,
    actualPlaceFacts:true,priorGovernedFactsPreserved:true,sourceContentPreserved:true,coordinatesCleared:2,categoriesCorrected:1,independentIdentityPreserved:true,media,
    independentSourceDigestUnchanged:true,mockEnqueueCalls:{before:beforeMockEnqueues,after:queued},actualEnqueues:0,
    enqueueMeaning:'未新增scope的两无图主体按既有规则请求补图；前后各2次均被隔离测试回调截获，不写真实队列。',imageComparison:'deferred_by_user',failures:[]};
  await writeFile(new URL(`vintage-consumption-${Date.now()}.json`,folder),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
});
