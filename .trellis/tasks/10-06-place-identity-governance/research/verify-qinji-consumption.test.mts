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
test('第52批秦记火烧混合分店内容隔离，明确推荐、坐标及既有图库保持',async()=>{
  const folder=new URL('all-cities/batch-52/sync-01/',import.meta.url);
  const read=async(p:string)=>JSON.parse(await readFile(new URL(p,folder),'utf8'));
  const sync=(await read('sync-state.json')).cities['济南'];assert.ok(sync.importedAt&&sync.relationsImportedAt);
  const bytes=await readFile(new URL('preview-济南/library-before.json',folder));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),(await read('preview-济南/state.json')).libraryHash);
  const library=JSON.parse(bytes.toString('utf8'));
  const exportBytes=await readFile(new URL('xhs-places-济南.json',folder));assert.equal(createHash('sha256').update(exportBytes).digest('hex'),sync.exportHash);
  for(const table of ['canonical_places','research_evidence','place_relation','data_import','independent_photo_assignments','place_relation_snapshots'])
    await pool.query(`INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(NULL::${table},$1::jsonb)`,[JSON.stringify(library.tables[table])]);
  const reviewed=JSON.parse(await readFile(new URL('priority-cities/济南/qinji-source-review-01.json',import.meta.url),'utf8'));
  const targetNames=['秦记火烧'];
  const before=await loadCityPlaceFacts('济南');
  const inputs=await loadIndependentPhotoSources('济南');assert.deepEqual(inputs.warnings,[]);
  const freeze=JSON.parse(await readFile(new URL('priority-cities/济南/food-followup-photo-metadata-01.json',import.meta.url),'utf8'));
  assert.equal(photoIdentityDigest(inputs),freeze.inputDigest);
  let queued=0;
  const makeLookup=()=>createGenerationPhotoLookup('济南',undefined,{loadSources:async()=>inputs,
    loadAssignments:async()=>library.tables.independent_photo_assignments,adoption:{adoptUnsplash:async()=>false},enqueue:async()=>{queued++;}});
  const oldLookup=makeLookup();const beforeMedia=new Map();
  for(const name of ['老商埠','经三路',...targetNames])beforeMedia.set(name,await oldLookup(name));
  const beforeMockEnqueues=queued;assert.equal(beforeMockEnqueues,1);queued=0;
  for(const kind of ['places','relations'])await promisify(execFile)(process.execPath,['--import','tsx',
    fileURLToPath(new URL(`../../../../apps/server/scripts/seed-xhs-${kind}.ts`,import.meta.url)),
    fileURLToPath(new URL(`xhs-${kind==='places'?'places':'place-relations'}-济南.json`,folder))],{env:process.env,windowsHide:true,timeout:60000});
  const facts=await loadCityPlaceFacts('济南');
  const targets=['53fc7a0204959595c1277e9c76915534'];
  const current=facts.get(placeNameKey('秦记火烧')),old=before.get(placeNameKey('秦记火烧'));assert.ok(current&&old);
  assert.equal(current.canonicalPlaceId,targets[0]);assert.equal(current.placeType,'food');assert.equal(current.category,'美食');
  assert.equal(old.mentionCount,4);assert.equal(current.mentionCount,2);assert.equal(current.lat,old.lat);assert.equal(current.lng,old.lng);
  assert.equal(current.visitMinutes,undefined);assert.doesNotMatch(JSON.stringify(current),/肉火烧去制锦市|其他去河边|具体菜品未详述/);
  for(const [name,value] of before)if(!targets.includes(value.canonicalPlaceId??''))assert.deepEqual(facts.get(name),value,`其他主体事实/${name}`);
  const kept=(await pool.query('SELECT name,payload FROM canonical_places WHERE id=ANY($1::text[])',[targets])).rows;
  for(const p of kept){
    assert.equal(p.payload.content.intro,'本地人推荐，有特色且味道好。');assert.equal(p.payload.content.highlights.length,1);
    assert.deepEqual(p.payload.mentionSources.map((m:any)=>m.mentionId).sort((a:number,b:number)=>a-b),[11364,12605]);
  }
  const lookup=makeLookup();
  const media=[];
  for(const [name,count,digest] of [['老商埠',3,'2c29d7b93a412f38eb21d6ce3ece4f175e0576dee87bee3a179d5bb095868603'],
    ['经三路',1,'2143dbc77997beeaf461e337c7f018783583096ae8e60dac777fba41cdbefddd']] as const) {
    const result=await lookup(name);assert.deepEqual(result,beforeMedia.get(name));assert.equal(result?.photos?.length,count);assert.equal(photoIdentityDigest(result),digest);media.push({name,count,digest});
  }
  for(const name of targetNames){assert.equal(beforeMedia.get(name),null);assert.equal(await lookup(name),null);}
  assert.equal(queued,0);
  const report={batch:52,isolated:true,synthetic:false,fullCityPlaces:JSON.parse(exportBytes.toString('utf8')).places.length,
    actualPlaceFacts:true,priorGovernedFactsPreserved:true,confirmedContentPreserved:true,mixedBranchContentRemoved:true,coordinatesCleared:0,categoriesCorrected:0,addressesAdded:0,independentIdentityPreserved:true,media,
    independentSourceDigestUnchanged:true,mockEnqueueCalls:{before:beforeMockEnqueues,after:queued},actualEnqueues:0,
    enqueueMeaning:'原无scope主体触发1次mock请求；新增scope后禁止未审核图片回退，after为0。两次实际返回均无图，真实队列未写入。',imageComparison:'deferred_by_user',failures:[]};
  await writeFile(new URL(`qinji-consumption-${Date.now()}.json`,folder),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
});
