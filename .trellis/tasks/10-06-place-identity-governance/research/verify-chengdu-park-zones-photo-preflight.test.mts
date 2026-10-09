// 成都园内分区决定前的真实图库返回检查；不查看图片，真实补图队列不写入。
import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import type {PlaceRow} from '../../../../apps/server/src/generation/retrievalRanking';
import {createPlaceIdentityIndex,placeNames} from '../../../../apps/server/src/lib/placeIdentity';
assert.match(process.env.DATABASE_URL??'',/127\.0\.0\.1:18798\/place_identity_test_\d+$/);
const {pool}=await import('../../../../apps/server/src/db/client');
const {createGenerationPhotoLookup}=await import('../../../../apps/server/src/integrations/photoEnrichment');
const {loadIndependentPhotoSources,photoIdentityDigest}=await import('../../../../apps/server/src/services/independentPhotoSources');
after(()=>pool.end());
test('黄龙溪园内两分区及园区当前图库，新增scope仅在内存',async()=>{
  const folder=new URL('priority-cities/成都/run-1791504271958861000/',import.meta.url);
  const bytes=await readFile(new URL('library-before.json',folder));
  const manifest=JSON.parse(await readFile(new URL('library-manifest.json',folder),'utf8'));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest.sha256);
  const library=JSON.parse(bytes.toString('utf8'));
  for(const table of ['canonical_places','research_evidence','place_relation','data_import','independent_photo_assignments','place_relation_snapshots'])
    await pool.query(`INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(NULL::${table},$1::jsonb)`,[JSON.stringify(library.tables[table])]);
  const inputs=await loadIndependentPhotoSources('成都');assert.deepEqual(inputs.warnings,[]);
  const frozen=JSON.parse(await readFile(new URL('priority-cities/成都/park-zones-photo-metadata-01.json',import.meta.url),'utf8'));
  assert.equal(photoIdentityDigest(inputs),frozen.inputDigest);
  const rows=library.tables.canonical_places as PlaceRow[];
  const index=(list:PlaceRow[])=>createPlaceIdentityIndex(list.filter(p=>p.verified||p.payload?.identityWithdrawal).map(p=>({...p,aliases:placeNames(p),evidence:[]})));
  const queued:string[]=[];
  const dependencies={loadSources:async()=>inputs,loadAssignments:async()=>library.tables.independent_photo_assignments,
    adoption:{adoptUnsplash:async()=>false},enqueue:async(_city:string,name:string)=>{queued.push(name);}};
  const current=createGenerationPhotoLookup('成都',async()=>index(rows),dependencies);
  const ids=['300be0691119032dc7bc5e825a192c6a','de1ab1b76f5de5a5ff8089016c9d93f6'];
  const scoped=rows.map(p=>ids.includes(p.id)?{...p,payload:{...p.payload,mentionSources:[]}}:p);
  const hypothetical=createGenerationPhotoLookup('成都',async()=>index(scoped),dependencies);
  const media=[];
  for(const name of ['萌宠片区','龙溪谷大型野趣戏水区']) {
    const result=await current(name),before=queued.length,after=await hypothetical(name);
    assert.equal(result,null);assert.equal(after,null);assert.equal(queued.length,before);
    media.push({name,currentPhotos:0,currentDigest:photoIdentityDigest(result),hypotheticalScopedPhotos:0});
  }
  assert.deepEqual(queued,['萌宠片区','龙溪谷大型野趣戏水区']);
  const parent=await current('黄龙溪欢乐田园');assert.equal(parent,null);
  assert.deepEqual(queued,['萌宠片区','龙溪谷大型野趣戏水区','黄龙溪欢乐田园']);
  const report={batch:66,preflight:true,isolated:true,synthetic:false,fullCityAfterEntityBatch:65,libraryPlaces:rows.length,media,
    parent:{name:'黄龙溪欢乐田园',photos:0,scopePlanned:false},mockEnqueues:3,actualEnqueues:0,existingPhotoConsumptionPreserved:true,
    hypotheticalScopeOnlyInMemory:true,imageComparison:'deferred_by_user',failures:[]};
  await writeFile(new URL('priority-cities/成都/park-zones-photo-preflight-01.json',import.meta.url),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(report));
});
