// 使用真实冻结目录验证实际事实读取及旧图库路由；不查看图片、不调用视觉模型或补图队列。
import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import type {PlaceRow} from '../../../../apps/server/src/generation/retrievalRanking';
import {createPlaceIdentityIndex,placeNames} from '../../../../apps/server/src/lib/placeIdentity';
assert.match(process.env.DATABASE_URL??'',/127\.0\.0\.1:18798\/place_identity_test_\d+$/);
const {pool}=await import('../../../../apps/server/src/db/client');
const {loadCityPlaceFacts}=await import('../../../../apps/server/src/generation/scheduling/placeFacts');
const {createGenerationPhotoLookup}=await import('../../../../apps/server/src/integrations/photoEnrichment');
const {loadIndependentPhotoSources,photoIdentityDigest}=await import('../../../../apps/server/src/services/independentPhotoSources');
after(()=>pool.end());
test('第45批两主体事实消费正确，未应用商业体/道路保留旧图库路由',async()=>{
  const folder=new URL('all-cities/batch-45/sync-01/',import.meta.url);
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
  const facts=await loadCityPlaceFacts('济南');
  for(const [name,id,count,type] of [['大观园','910ac4e3fee34da1dd5f4378c7319ba5',4,'attraction'],['纬三路与经三路交叉口','fef9784ad510099ad3bd150eee3fbf5c',1,'photo_spot']] as const) {
    const p=facts.get(name);assert.ok(p);assert.equal(p.canonicalPlaceId,id);assert.equal(p.visitMinutes,undefined);
    assert.equal(p.category,'文化');assert.equal(p.mentionCount,count);assert.equal(p.placeType,type);
    if(name==='大观园'){assert.equal(p.lat,undefined);assert.equal(p.lng,undefined);}else{assert.equal(p.lat,before.get(name)?.lat);assert.equal(p.lng,before.get(name)?.lng);}
  }
  for(const name of ['融汇老商埠','经三路','经三路爱心红绿灯','大明湖','解放阁','曲水亭街','百花洲','黑虎泉','千佛山'])assert.deepEqual(facts.get(name),before.get(name),name);
  const inputs=await loadIndependentPhotoSources('济南');assert.deepEqual(inputs.warnings,[]);
  const photoFreeze=JSON.parse(await readFile(new URL('priority-cities/济南/commercial-photo-metadata-01.json',import.meta.url),'utf8'));
  assert.equal(photoIdentityDigest(inputs),photoFreeze.inputDigest);
  const rows=(await pool.query<PlaceRow>('SELECT id,city,name,category,lat,lng,verified,source,payload FROM canonical_places WHERE city=$1',['济南'])).rows;
  const getIndex=(rows:PlaceRow[])=>createPlaceIdentityIndex(rows.filter(p=>p.verified||p.payload?.identityWithdrawal).map(p=>({...p,aliases:placeNames(p),evidence:[]})));
  let queued=0;
  const dependencies={loadSources:async()=>inputs,loadAssignments:async()=>library.tables.independent_photo_assignments,
    adoption:{adoptUnsplash:async()=>false},enqueue:async()=>{queued++;}};
  const oldLookup=createGenerationPhotoLookup('济南',async()=>getIndex(library.tables.canonical_places),dependencies);
  const currentLookup=createGenerationPhotoLookup('济南',async()=>getIndex(rows),dependencies);
  const hypotheticalRows=rows.map(p=>['46bf462d545dc6435d6de296ba099d0f','c11648e477180d1b3f97da06808da5e7'].includes(p.id)?{...p,payload:{...p.payload,mentionSources:[]}}:p);
  const hypothetical=createGenerationPhotoLookup('济南',async()=>getIndex(hypotheticalRows),dependencies);
  const media=[];
  for(const name of ['老商埠','经三路']) {
    const old=await oldLookup(name),current=await currentLookup(name);assert.ok(old?.photos&&old.photos.length>0,name);assert.ok(current?.photos);assert.deepEqual(current,old);
    const count=queued;assert.equal(await hypothetical(name),null);assert.equal(queued,count);
    media.push({name,oldPhotoCount:old.photos.length,currentPhotoCount:current.photos.length,unchangedDigest:photoIdentityDigest(current),hypotheticalScopedPhotoCount:0});
  }
  assert.equal(queued,0);
  assert.deepEqual((await pool.query('SELECT * FROM independent_photo_assignments WHERE city=$1 ORDER BY image_key',['济南'])).rows,
    [...library.tables.independent_photo_assignments].sort((a:any,b:any)=>a.image_key.localeCompare(b.image_key)));
  const report={batch:45,isolated:true,synthetic:false,fullCityPlaces:JSON.parse(exportBytes.toString('utf8')).places.length,
    actualPlaceFacts:true,knownWrongDaguanyuanPointRemoved:true,priorGovernedFactsPreserved:true,media,
    hypotheticalScopeOnlyInMemory:true,independentSourceDigestUnchanged:true,queued,imageComparison:'deferred_by_user',failures:[]};
  await writeFile(new URL(`commercial-consumption-${Date.now()}.json`,folder),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
});
