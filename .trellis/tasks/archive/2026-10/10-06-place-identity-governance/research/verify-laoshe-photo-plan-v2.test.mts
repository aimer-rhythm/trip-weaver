// 第55批应用前，实际图库返回及新增scope的影响；只比较返回对象与元数据。
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
test('保留纪念馆主名，别名规范化后实际图库保持',async()=>{
  const folder=new URL('all-cities/batch-54/sync-01/',import.meta.url);
  const read=async(p:string)=>JSON.parse(await readFile(new URL(p,folder),'utf8'));
  const sync=(await read('sync-state.json')).cities['济南'];assert.ok(sync.importedAt&&sync.relationsImportedAt);
  const bytes=await readFile(new URL('preview-济南/library-before.json',folder));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),(await read('preview-济南/state.json')).libraryHash);
  const library=JSON.parse(bytes.toString('utf8'));
  const exported=await readFile(new URL('xhs-places-济南.json',folder));assert.equal(createHash('sha256').update(exported).digest('hex'),sync.exportHash);
  for(const table of ['canonical_places','research_evidence','independent_photo_assignments'])
    await pool.query(`INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(NULL::${table},$1::jsonb)`,[JSON.stringify(library.tables[table])]);
  // 只重建本探针需要的旧地点/语料/绑定；不把隔离SQL的revision1冒充实城revision28。
  const freezeBefore=JSON.parse(await readFile(new URL('priority-cities/济南/laoshe-photo-metadata-01.json',import.meta.url),'utf8'));
  for(const item of freezeBefore.entities){const p=library.tables.canonical_places.find((p:any)=>p.id===item.entityId);assert.equal(p.name,item.name);assert.equal(p.payload.identity.revision,item.revision);assert.equal(p.lat,item.lat);assert.equal(p.lng,item.lng);}
  const planned=new URL('all-cities/batch-55-v2/scope-preview-1791493722006262300/',import.meta.url);
  const report=JSON.parse(await readFile(new URL('report.json',planned),'utf8'));
  assert.ok(report.isolated&&report.reverseRollback);
  const plannedBytes=await readFile(new URL('xhs-places-济南.json',planned));assert.equal(createHash('sha256').update(plannedBytes).digest('hex'),report.exportSha256);
  await promisify(execFile)(process.execPath,['--import','tsx',fileURLToPath(new URL('../../../../apps/server/scripts/seed-xhs-places.ts',import.meta.url)),
    fileURLToPath(new URL('xhs-places-济南.json',planned))],{env:process.env,windowsHide:true,timeout:60000});
  const inputs=await loadIndependentPhotoSources('济南');assert.deepEqual(inputs.warnings,[]);
  const freeze=JSON.parse(await readFile(new URL('priority-cities/济南/laoshe-photo-metadata-01.json',import.meta.url),'utf8'));
  assert.equal(photoIdentityDigest(inputs),freeze.inputDigest);
  const rows=(await pool.query<PlaceRow>('SELECT id,city,name,category,lat,lng,verified,source,payload FROM canonical_places WHERE city=$1',['济南'])).rows;
  const index=(list:PlaceRow[])=>createPlaceIdentityIndex(list.filter(p=>p.verified||p.payload?.identityWithdrawal).map(p=>({...p,aliases:placeNames(p),evidence:[]})));
  let queued=0;const dependencies={loadSources:async()=>inputs,loadAssignments:async()=>library.tables.independent_photo_assignments,
    adoption:{adoptUnsplash:async()=>false},enqueue:async()=>{queued++;}};
  const lookup=createGenerationPhotoLookup('济南',async()=>index(rows),dependencies);
  const scoped=rows.map(p=>['6a111b28c08cc7853140187bfd852b16','c5a3fae3d839ec359cb0521d957e56df'].includes(p.id)?{...p,payload:{...p.payload,mentionSources:[]}}:p);
  const hypothetical=createGenerationPhotoLookup('济南',async()=>index(scoped),dependencies);
  const media=[];
  for(const name of ['老舍故居','济南老舍纪念馆','老舍纪念馆','老舍笔下的济南','老舍笔下的济南主题墙']) {
    const result=await lookup(name),beforeQueued=queued,after=await hypothetical(name);
    assert.equal(after,null);assert.equal(queued,beforeQueued);
    media.push({name,currentPhotos:result?.photos?.length??0,currentDigest:photoIdentityDigest(result),hypotheticalScopedPhotos:0});
  }
  const prior=JSON.parse(await readFile(new URL('priority-cities/济南/laoshe-photo-preflight-01.json',import.meta.url),'utf8'));
  assert.equal(media[0]!.currentPhotos,2);assert.equal(media[0]!.currentDigest,prior.media[0].currentDigest);
  for(const item of media.slice(1))assert.equal(item.currentPhotos,0);
  assert.equal(queued,2);
  const canonicalized=[];
  for(const name of ['老舍故居','济南老舍纪念馆','老舍纪念馆']) {
    const resolved=index(rows).resolve('济南',name);assert.equal(resolved.status,'resolved');assert.ok(resolved.status==='resolved');
    assert.equal(resolved.place.name,'老舍故居');const result=await lookup(resolved.place.name);
    assert.equal(result?.photos?.length,2);assert.equal(photoIdentityDigest(result),prior.media[0].currentDigest);
    canonicalized.push({input:name,canonicalName:resolved.place.name,photos:2,digest:photoIdentityDigest(result)});
  }
  const result={batch:55,variant:"v2",canonicalized,preflight:true,plannedExportSha256:report.exportSha256,actualPlaceImporter:true,isolated:true,synthetic:false,baselineEntityBatch:53,targetIdentityMatchesBatch54:true,partialCityImport:true,media,mockEnqueues:queued,actualEnqueues:0,
    museumScopeMustWaitForMedia:true,hypotheticalScopeOnlyInMemory:true,imageComparison:'deferred_by_user',failures:[]};
  await writeFile(new URL('priority-cities/济南/laoshe-photo-plan-02.json',import.meta.url),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(result));
});
