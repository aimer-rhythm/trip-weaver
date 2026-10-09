// 原消费和新增scope门禁的隔离预演，仅比较实际返回与元数据，不查看图片。
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
test('武侯祠锦里在facts及专用图库中均无当前图片，scope媒体预演无损失',async()=>{
  const read=async(p:string)=>JSON.parse(await readFile(new URL(p,import.meta.url),'utf8'));
  const folder='priority-cities/成都/wuhou-jinli-before-01/',bytes=await readFile(new URL(folder+'library-before.json',import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),(await read(folder+'state.json')).libraryHash);
  const library=JSON.parse(bytes.toString('utf8'));
  for(const table of ['canonical_places','research_evidence','place_relation','data_import','independent_photo_assignments','place_relation_snapshots'])
    await pool.query(`INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(NULL::${table},$1::jsonb)`,[JSON.stringify(library.tables[table])]);
  const facts=await loadCityPlaceFacts('成都'),inputs=await loadIndependentPhotoSources('成都');assert.deepEqual(inputs.warnings,[]);
  const metadata=await read('priority-cities/成都/wuhou-jinli-photo-metadata-01.json');assert.equal(photoIdentityDigest(inputs),metadata.inputDigest);
  const rows=library.tables.canonical_places as PlaceRow[],queued:string[]=[],targets=['武侯祠','锦里'];
  const make=(list:PlaceRow[])=>createGenerationPhotoLookup('成都',async()=>createPlaceIdentityIndex(list.filter(p=>p.verified||p.payload?.identityWithdrawal).map(p=>({...p,aliases:placeNames(p),evidence:[]}))),
    {loadSources:async()=>inputs,loadAssignments:async()=>library.tables.independent_photo_assignments,adoption:{adoptUnsplash:async()=>false},enqueue:async(_city,name)=>{queued.push(name);}});
  const ordinary=make(rows),hypothetical=make(rows.map(p=>targets.includes(p.name)?{...p,payload:{...p.payload,mentionSources:[]}}:p)),results=[];
  for(const name of targets){const fact=facts.get(name);assert.ok(fact);assert.equal(fact.imageGallery,undefined);assert.equal(fact.coverImage,undefined);assert.equal(fact.amapPhoto,undefined);
    assert.equal(await ordinary(name),null);assert.equal(await hypothetical(name),null);
    const input=metadata.entities.find((e:any)=>e.name===name);assert.ok(input);assert.equal(input.assignments.length,0);assert.equal(input.independentSources.filter((s:any)=>s.eligible).length,0);
    results.push({name,factsImages:0,lookupImages:0,independentSources:input.independentSources.length,eligible:0,assignments:0});}
  assert.deepEqual(queued,targets);
  const report={readOnlyPreflight:true,isolated:true,sourceEntityBatch:69,actualFactsChecked:true,results,existingPhotoConsumptionPreserved:true,
    hypotheticalScopeOnly:true,mockEnqueues:2,actualEnqueues:0,imageComparison:'deferred_by_user',failures:[]};
  await writeFile(new URL('priority-cities/成都/wuhou-jinli-photo-preflight-01.json',import.meta.url),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
});
