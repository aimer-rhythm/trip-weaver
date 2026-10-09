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
test('第53批恢复餐饮分店名并隔离未确认分店内容，明确推荐、坐标及既有图库保持',async()=>{
  const folder=new URL('all-cities/batch-53/sync-01/',import.meta.url);
  const read=async(p:string)=>JSON.parse(await readFile(new URL(p,folder),'utf8'));
  const sync=(await read('sync-state.json')).cities['济南'];assert.ok(sync.importedAt&&sync.relationsImportedAt);
  const bytes=await readFile(new URL('preview-济南/library-before.json',folder));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),(await read('preview-济南/state.json')).libraryHash);
  const library=JSON.parse(bytes.toString('utf8'));
  const exportBytes=await readFile(new URL('xhs-places-济南.json',folder));assert.equal(createHash('sha256').update(exportBytes).digest('hex'),sync.exportHash);
  for(const table of ['canonical_places','research_evidence','place_relation','data_import','independent_photo_assignments','place_relation_snapshots'])
    await pool.query(`INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(NULL::${table},$1::jsonb)`,[JSON.stringify(library.tables[table])]);
  const reviewed=JSON.parse(await readFile(new URL('priority-cities/济南/food-branches-source-review-01.json',import.meta.url),'utf8'));
  const source=JSON.parse(await readFile(new URL('all-cities/batch-53-source.json',import.meta.url),'utf8'));
  const decisions=JSON.parse(await readFile(new URL('all-cities/batch-53-decisions.json',import.meta.url),'utf8'));
  const targetNames=source.groups.map((g:any)=>g.entity.canonical_name);
  const targets=source.groups.map((g:any)=>g.entity.entity_id);
  const before=await loadCityPlaceFacts('济南');
  const inputs=await loadIndependentPhotoSources('济南');assert.deepEqual(inputs.warnings,[]);
  const freeze=JSON.parse(await readFile(new URL('priority-cities/济南/food-branches-photo-metadata-01.json',import.meta.url),'utf8'));
  assert.equal(photoIdentityDigest(inputs),freeze.inputDigest);
  let queued=0;
  const makeLookup=()=>createGenerationPhotoLookup('济南',undefined,{loadSources:async()=>inputs,
    loadAssignments:async()=>library.tables.independent_photo_assignments,adoption:{adoptUnsplash:async()=>false},enqueue:async()=>{queued++;}});
  const oldLookup=makeLookup();const beforeMedia=new Map();
  for(const name of ['老商埠','经三路',...targetNames])beforeMedia.set(name,await oldLookup(name));
  const beforeMockEnqueues=queued;assert.equal(beforeMockEnqueues,2);queued=0;
  for(const kind of ['places','relations'])await promisify(execFile)(process.execPath,['--import','tsx',
    fileURLToPath(new URL(`../../../../apps/server/scripts/seed-xhs-${kind}.ts`,import.meta.url)),
    fileURLToPath(new URL(`xhs-${kind==='places'?'places':'place-relations'}-济南.json`,folder))],{env:process.env,windowsHide:true,timeout:60000});
  const facts=await loadCityPlaceFacts('济南');
  for(const g of source.groups) {
    const eid=g.entity.entity_id,decision=decisions.find((d:any)=>d.entityId===eid);
    const current=facts.get(placeNameKey(decision.canonicalName)),old=before.get(placeNameKey(g.entity.canonical_name));assert.ok(current&&old);
    const ids=eid==='cc3ebff96b9f814d82ef808324a42400'?[11709]:[11635,12886];
    assert.equal(current.canonicalPlaceId,eid);assert.equal(current.placeType,'food');assert.equal(current.category,'美食');
    assert.equal(old.mentionCount,g.mentionIds.length);assert.equal(current.mentionCount,ids.length);assert.equal(current.lat,old.lat);assert.equal(current.lng,old.lng);
    assert.deepEqual(facts.get(placeNameKey(g.entity.canonical_name)),current);
    assert.equal(current.visitMinutes,undefined);assert.doesNotMatch(JSON.stringify(current),/口味单调|作者不喜欢|具体菜品未详述|乱收费/);
    const p=(await pool.query('SELECT name,payload FROM canonical_places WHERE id=$1',[eid])).rows[0];
    assert.equal(p.name,decision.canonicalName);assert.equal(p.payload.content.highlights.length,ids.length===1?3:2);
    assert.deepEqual(p.payload.mentionSources.map((m:any)=>m.mentionId).sort((a:number,b:number)=>a-b),ids);
  }
  for(const [name,value] of before)if(!targets.includes(value.canonicalPlaceId??''))assert.deepEqual(facts.get(name),value,`其他主体事实/${name}`);
  const lookup=makeLookup();
  const media=[];
  for(const [name,count,digest] of [['老商埠',3,'2c29d7b93a412f38eb21d6ce3ece4f175e0576dee87bee3a179d5bb095868603'],
    ['经三路',1,'2143dbc77997beeaf461e337c7f018783583096ae8e60dac777fba41cdbefddd']] as const) {
    const result=await lookup(name);assert.deepEqual(result,beforeMedia.get(name));assert.equal(result?.photos?.length,count);assert.equal(photoIdentityDigest(result),digest);media.push({name,count,digest});
  }
  for(const name of targetNames){assert.equal(beforeMedia.get(name),null);assert.equal(await lookup(name),null);}
  for(const d of decisions)assert.equal(await lookup(d.canonicalName),null);
  assert.equal(queued,0);
  const report={batch:53,isolated:true,synthetic:false,fullCityPlaces:JSON.parse(exportBytes.toString('utf8')).places.length,
    actualPlaceFacts:true,priorGovernedFactsPreserved:true,confirmedContentPreserved:true,mixedBranchContentRemoved:true,coordinatesCleared:0,categoriesCorrected:0,addressesAdded:0,independentIdentityPreserved:true,media,
    independentSourceDigestUnchanged:true,mockEnqueueCalls:{before:beforeMockEnqueues,after:queued},actualEnqueues:0,
    enqueueMeaning:'原两个无scope主体触发2次mock请求；新增scope后禁止未审核图片回退，after为0。两次实际返回均无图，真实队列未写入。',imageComparison:'deferred_by_user',failures:[]};
  await writeFile(new URL(`food-branches-consumption-${Date.now()}.json`,folder),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
});
