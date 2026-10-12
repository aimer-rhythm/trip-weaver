// 真实全城导入后的事实消费与旧图库保全；不查看图片、不入补图队列。
import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
assert.match(process.env.DATABASE_URL??'',/127\.0\.0\.1:18798\/place_identity_test_\d+$/);
const {pool}=await import('../../../../apps/server/src/db/client');
const {loadCityPlaceFacts}=await import('../../../../apps/server/src/generation/scheduling/placeFacts');
const {createGenerationPhotoLookup}=await import('../../../../apps/server/src/integrations/photoEnrichment');
const {loadIndependentPhotoSources,photoIdentityDigest}=await import('../../../../apps/server/src/services/independentPhotoSources');
after(()=>pool.end());
test('第46批红绿灯保留主体且不消费胡同描述，既有地点事实和图库保持',async()=>{
  const folder=new URL('all-cities/batch-46/sync-01/',import.meta.url);
  const read=async(p:string)=>JSON.parse(await readFile(new URL(p,folder),'utf8'));
  const sync=(await read('sync-state.json')).cities['济南'];assert.ok(sync.importedAt&&sync.relationsImportedAt);
  const bytes=await readFile(new URL('preview-济南/library-before.json',folder));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),(await read('preview-济南/state.json')).libraryHash);
  const library=JSON.parse(bytes.toString('utf8'));
  const exportBytes=await readFile(new URL('xhs-places-济南.json',folder));assert.equal(createHash('sha256').update(exportBytes).digest('hex'),sync.exportHash);
  for(const table of ['canonical_places','research_evidence','place_relation','data_import','independent_photo_assignments','place_relation_snapshots'])
    await pool.query(`INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(NULL::${table},$1::jsonb)`,[JSON.stringify(library.tables[table])]);
  const before=await loadCityPlaceFacts('济南');
  for(const kind of ['places','relations'])await promisify(execFile)(process.execPath,['--import','tsx',
    fileURLToPath(new URL(`../../../../apps/server/scripts/seed-xhs-${kind}.ts`,import.meta.url)),
    fileURLToPath(new URL(`xhs-${kind==='places'?'places':'place-relations'}-济南.json`,folder))],{env:process.env,windowsHide:true,timeout:60000});
  const facts=await loadCityPlaceFacts('济南'),p=facts.get('经三路爱心红绿灯');assert.ok(p);
  assert.equal(p.canonicalPlaceId,'ce733b67e45f0d657e53ff9bff8cbbce');assert.equal(p.placeType,'photo_spot');assert.equal(p.category,'文化');
  assert.equal(p.mentionCount,1);assert.equal(p.visitMinutes,undefined);assert.equal(p.lat,undefined);assert.equal(p.lng,undefined);
  assert.doesNotMatch(JSON.stringify(p),/夹心胡同/);
  for(const [name,value] of before)if(value.canonicalPlaceId!==p.canonicalPlaceId)assert.deepEqual(facts.get(name),value,`其他主体事实/${name}`);
  const inputs=await loadIndependentPhotoSources('济南');assert.deepEqual(inputs.warnings,[]);
  const freeze=JSON.parse(await readFile(new URL('priority-cities/济南/light-photo-metadata-01.json',import.meta.url),'utf8'));
  assert.equal(photoIdentityDigest(inputs),freeze.inputDigest);
  let queued=0;
  const lookup=createGenerationPhotoLookup('济南',undefined,{loadSources:async()=>inputs,
    loadAssignments:async()=>library.tables.independent_photo_assignments,adoption:{adoptUnsplash:async()=>false},enqueue:async()=>{queued++;}});
  const media=[];
  for(const [name,count,digest] of [['老商埠',3,'2c29d7b93a412f38eb21d6ce3ece4f175e0576dee87bee3a179d5bb095868603'],
    ['经三路',1,'2143dbc77997beeaf461e337c7f018783583096ae8e60dac777fba41cdbefddd']] as const) {
    const result=await lookup(name);assert.equal(result?.photos?.length,count);assert.equal(photoIdentityDigest(result),digest);media.push({name,count,digest});
  }
  assert.equal(await lookup('经三路爱心红绿灯'),null);assert.equal(queued,0);
  const report={batch:46,isolated:true,synthetic:false,fullCityPlaces:JSON.parse(exportBytes.toString('utf8')).places.length,
    actualPlaceFacts:true,priorGovernedFactsPreserved:true,descriptionRemoved:true,identityAndNullCoordinatesPreserved:true,media,
    independentSourceDigestUnchanged:true,queued,imageComparison:'deferred_by_user',failures:[]};
  await writeFile(new URL(`light-consumption-${Date.now()}.json`,folder),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
});
