// 第57批决定前，实际图库返回及新增scope的影响；只比较返回对象与元数据。
import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import type {PlaceRow} from '../../../../apps/server/src/generation/retrievalRanking';
import {createPlaceIdentityIndex,placeNames} from '../../../../apps/server/src/lib/placeIdentity';
assert.match(process.env.DATABASE_URL??'',/127\.0\.0\.1:18798\/place_identity_test_\d+$/);
const {pool}=await import('../../../../apps/server/src/db/client');
const {createGenerationPhotoLookup}=await import('../../../../apps/server/src/integrations/photoEnrichment');
const {loadIndependentPhotoSources,photoIdentityDigest}=await import('../../../../apps/server/src/services/independentPhotoSources');
after(()=>pool.end());
test('三家餐饮分店实际图库与scope门禁，仅在临时库和内存预演',async()=>{
  const folder=new URL('all-cities/batch-56-v2/sync-01/',import.meta.url);
  const read=async(p:string)=>JSON.parse(await readFile(new URL(p,folder),'utf8'));
  const sync=(await read('sync-state.json')).cities['济南'];assert.ok(sync.importedAt&&sync.relationsImportedAt);
  const bytes=await readFile(new URL('preview-济南/library-before.json',folder));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),(await read('preview-济南/state.json')).libraryHash);
  const library=JSON.parse(bytes.toString('utf8'));
  const exported=await readFile(new URL('xhs-places-济南.json',folder));assert.equal(createHash('sha256').update(exported).digest('hex'),sync.exportHash);
  for(const table of ['canonical_places','research_evidence','place_relation','data_import','independent_photo_assignments','place_relation_snapshots'])
    await pool.query(`INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(NULL::${table},$1::jsonb)`,[JSON.stringify(library.tables[table])]);
  for(const kind of ['places','relations'])await promisify(execFile)(process.execPath,['--import','tsx',
    fileURLToPath(new URL(`../../../../apps/server/scripts/seed-xhs-${kind}.ts`,import.meta.url)),
    fileURLToPath(new URL(`xhs-${kind==='places'?'places':'place-relations'}-济南.json`,folder))],{env:process.env,windowsHide:true,timeout:60000});
  const inputs=await loadIndependentPhotoSources('济南');assert.deepEqual(inputs.warnings,[]);
  const freeze=JSON.parse(await readFile(new URL('priority-cities/济南/restaurant-branches-photo-metadata-01.json',import.meta.url),'utf8'));
  assert.equal(photoIdentityDigest(inputs),freeze.inputDigest);
  const rows=(await pool.query<PlaceRow>('SELECT id,city,name,category,lat,lng,verified,source,payload FROM canonical_places WHERE city=$1',['济南'])).rows;
  const index=(list:PlaceRow[])=>createPlaceIdentityIndex(list.filter(p=>p.verified||p.payload?.identityWithdrawal).map(p=>({...p,aliases:placeNames(p),evidence:[]})));
  let queued=0;const dependencies={loadSources:async()=>inputs,loadAssignments:async()=>library.tables.independent_photo_assignments,
    adoption:{adoptUnsplash:async()=>false},enqueue:async()=>{queued++;}};
  const lookup=createGenerationPhotoLookup('济南',async()=>index(rows),dependencies);
  const scoped=rows.map(p=>['84929fb3085880c48c0cebb71aae3ad4','58d542ebe18a1dd3505b7cdc60db030c','92a39f8f2d95070cc627828807686bac'].includes(p.id)?{...p,payload:{...p.payload,mentionSources:[]}}:p);
  const hypothetical=createGenerationPhotoLookup('济南',async()=>index(scoped),dependencies);
  const media=[];
  for(const name of ['燕喜堂','刘小忙把子肉','亮亮拉面']) {
    const result=await lookup(name),beforeQueued=queued,after=await hypothetical(name);
    assert.equal(after,null);assert.equal(queued,beforeQueued);
    media.push({name,currentPhotos:result?.photos?.length??0,currentDigest:photoIdentityDigest(result),hypotheticalScopedPhotos:0});
  }
  assert.ok(media.every(m=>m.currentPhotos===0));assert.equal(queued,3);
  const report={batch:57,preflight:true,isolated:true,synthetic:false,fullCityAfterEntityBatch:56,media,mockEnqueues:queued,actualEnqueues:0,
    existingPhotoConsumptionPreserved:true,hypotheticalScopeOnlyInMemory:true,imageComparison:'deferred_by_user',failures:[]};
  await writeFile(new URL('priority-cities/济南/restaurant-branches-photo-preflight-01.json',import.meta.url),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(report));
});
