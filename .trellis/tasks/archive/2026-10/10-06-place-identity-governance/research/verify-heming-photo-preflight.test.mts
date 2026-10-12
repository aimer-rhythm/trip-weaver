// 茶社新增scope前，分别核对实际facts和专用图库；不看图、不真实补图。
import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import type {PlaceRow} from '../../../../apps/server/src/generation/retrievalRanking';
import {createPlaceIdentityIndex,placeNames} from '../../../../apps/server/src/lib/placeIdentity';
assert.match(process.env.DATABASE_URL??'',/127\.0\.0\.1:18798\/place_identity_test_\d+$/);
const {pool}=await import('../../../../apps/server/src/db/client');
const {loadCityPlaceFacts}=await import('../../../../apps/server/src/generation/scheduling/placeFacts');
const {createGenerationPhotoLookup}=await import('../../../../apps/server/src/integrations/photoEnrichment');
const {loadIndependentPhotoSources,photoIdentityDigest}=await import('../../../../apps/server/src/services/independentPhotoSources');
after(()=>pool.end());
test('茶社实际两条媒体消费路径均为空，scope不损失已消费图片',async()=>{
  const read=async(p:string)=>JSON.parse(await readFile(new URL(p,import.meta.url),'utf8'));
  const folder='priority-cities/成都/heming-before-01/',bytes=await readFile(new URL(folder+'library-before.json',import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),(await read(folder+'state.json')).libraryHash);
  const library=JSON.parse(bytes.toString('utf8'));
  for(const table of ['canonical_places','research_evidence','place_relation','data_import','independent_photo_assignments','place_relation_snapshots'])
    await pool.query(`INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(NULL::${table},$1::jsonb)`,[JSON.stringify(library.tables[table])]);
  const facts=await loadCityPlaceFacts('成都'),tea=facts.get('鹤鸣茶社'),park=facts.get('人民公园');assert.ok(tea&&park);
  assert.equal(tea.imageGallery,undefined);assert.equal(tea.coverImage,undefined);assert.equal(tea.amapPhoto,undefined);
  assert.equal(park.imageGallery?.length,1);assert.ok(park.coverImage);
  const input=await loadIndependentPhotoSources('成都'),metadata=await read('priority-cities/成都/heming-photo-metadata-01.json');
  assert.deepEqual(input.warnings,[]);assert.equal(photoIdentityDigest(input),metadata.inputDigest);
  assert.deepEqual(metadata.entities[0].independentSources,[]);assert.deepEqual(metadata.entities[0].assignments,[]);
  const rows=library.tables.canonical_places as PlaceRow[],queued:string[]=[];
  const make=(list:PlaceRow[])=>createGenerationPhotoLookup('成都',async()=>createPlaceIdentityIndex(list.filter(p=>p.verified||p.payload?.identityWithdrawal).map(p=>({...p,aliases:placeNames(p),evidence:[]}))),
    {loadSources:async()=>input,loadAssignments:async()=>library.tables.independent_photo_assignments,adoption:{adoptUnsplash:async()=>false},enqueue:async(_c,name)=>{queued.push(name);}});
  const current=make(rows),scoped=make(rows.map(p=>p.name==='鹤鸣茶社'?{...p,payload:{...p.payload,mentionSources:[]}}:p));
  assert.equal(await current('鹤鸣茶社'),null);assert.deepEqual(queued,['鹤鸣茶社']);assert.equal(await scoped('鹤鸣茶社'),null);assert.deepEqual(queued,['鹤鸣茶社']);
  const report={batch:69,readOnlyPreflight:true,isolated:true,sourceEntityBatch:68,actualFactsChecked:true,teaFactImages:0,teaLookupImages:0,readOnlyParkFactImages:1,
    independentInputsVerified:true,existingPhotoConsumptionPreserved:true,mockEnqueues:1,actualEnqueues:0,imageComparison:'deferred_by_user',failures:[]};
  await writeFile(new URL('priority-cities/成都/heming-photo-preflight-01.json',import.meta.url),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
});
