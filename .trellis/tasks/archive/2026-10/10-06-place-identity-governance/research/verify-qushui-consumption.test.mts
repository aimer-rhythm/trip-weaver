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
test('第49批恢复两条街道提及而排除独立机位，已有事实和图库保持',async()=>{
  const folder=new URL('all-cities/batch-49/sync-01/',import.meta.url);
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
  const freeze=JSON.parse(await readFile(new URL('priority-cities/济南/qushui-photo-metadata-01.json',import.meta.url),'utf8'));
  assert.equal(photoIdentityDigest(inputs),freeze.inputDigest);
  let queued=0;
  const makeLookup=()=>createGenerationPhotoLookup('济南',undefined,{loadSources:async()=>inputs,
    loadAssignments:async()=>library.tables.independent_photo_assignments,adoption:{adoptUnsplash:async()=>false},enqueue:async()=>{queued++;}});
  const oldLookup=makeLookup();const beforeMedia=new Map();
  for(const name of ['老商埠','经三路','曲水亭街','曲水亭'])beforeMedia.set(name,await oldLookup(name));
  for(const kind of ['places','relations'])await promisify(execFile)(process.execPath,['--import','tsx',
    fileURLToPath(new URL(`../../../../apps/server/scripts/seed-xhs-${kind}.ts`,import.meta.url)),
    fileURLToPath(new URL(`xhs-${kind==='places'?'places':'place-relations'}-济南.json`,folder))],{env:process.env,windowsHide:true,timeout:60000});
  const facts=await loadCityPlaceFacts('济南');
  const targets=['c9c9ce7c33c95b71b859f0ab30bf7136'];
  for(const name of ['曲水亭街','曲水亭']) {
    const p=facts.get(name),old=before.get(name);assert.ok(p&&old);assert.equal(p.canonicalPlaceId,targets[0]);assert.equal(p.placeType,old.placeType);assert.equal(p.category,'文化');
    assert.equal(p.mentionCount,46);assert.equal(old.mentionCount,44);assert.equal(p.visitMinutes,50);assert.equal(old.visitMinutes,50);
    assert.equal(p.lat,old.lat);assert.equal(p.lng,old.lng);assert.doesNotMatch(JSON.stringify(p),/起凤桥/);
  }
  for(const [name,value] of before)if(!targets.includes(value.canonicalPlaceId??''))assert.deepEqual(facts.get(name),value,`其他主体事实/${name}`);
  const kept=(await pool.query('SELECT name,payload FROM canonical_places WHERE id=ANY($1::text[])',[targets])).rows;
  for(const p of kept){assert.match(JSON.stringify(p.payload.content),/小桥流水、青石板路/);assert.doesNotMatch(JSON.stringify(p.payload),/起凤桥/);}
  const lookup=makeLookup();
  const media=[];
  for(const [name,count,digest] of [['老商埠',3,'2c29d7b93a412f38eb21d6ce3ece4f175e0576dee87bee3a179d5bb095868603'],
    ['经三路',1,'2143dbc77997beeaf461e337c7f018783583096ae8e60dac777fba41cdbefddd']] as const) {
    const result=await lookup(name);assert.deepEqual(result,beforeMedia.get(name));assert.equal(result?.photos?.length,count);assert.equal(photoIdentityDigest(result),digest);media.push({name,count,digest});
  }
  for(const name of ['曲水亭街','曲水亭']){assert.equal(beforeMedia.get(name),null);assert.equal(await lookup(name),null);}assert.equal(queued,0);
  const report={batch:49,isolated:true,synthetic:false,fullCityPlaces:JSON.parse(exportBytes.toString('utf8')).places.length,
    actualPlaceFacts:true,priorGovernedFactsPreserved:true,mixedHighlightsRemoved:true,remainingHighlightsPreserved:true,independentDurationPreserved:true,identityAndCoordinatesPreserved:true,media,
    independentSourceDigestUnchanged:true,queued,imageComparison:'deferred_by_user',failures:[]};
  await writeFile(new URL(`qushui-consumption-${Date.now()}.json`,folder),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
});
