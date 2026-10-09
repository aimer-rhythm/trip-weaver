// 全城双导入后调用实际事实/图库消费；只比较返回对象，不查看图片、不写补图队列。
import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {placeNameKey} from '@tripweaver/shared';
import {createPlaceIdentityIndex,placeNames} from '../../../../apps/server/src/lib/placeIdentity';
import type {PlaceRow} from '../../../../apps/server/src/generation/retrievalRanking';
assert.match(process.env.DATABASE_URL??'',/127\.0\.0\.1:18798\/place_identity_test_\d+$/);
const {pool}=await import('../../../../apps/server/src/db/client');
const {loadCityPlaceFacts}=await import('../../../../apps/server/src/generation/scheduling/placeFacts');
const {createGenerationPhotoLookup}=await import('../../../../apps/server/src/integrations/photoEnrichment');
const {loadIndependentPhotoSources,photoIdentityDigest}=await import('../../../../apps/server/src/services/independentPhotoSources');
after(()=>pool.end());
test('故居别名归原主名后保留2图，主题墙独立且事实内容保持',async()=>{
  const folder=new URL('all-cities/batch-55-v2/sync-01/',import.meta.url);
  const read=async(p:string)=>JSON.parse(await readFile(new URL(p,folder),'utf8'));
  const sync=(await read('sync-state.json')).cities['济南'];assert.ok(sync.importedAt&&sync.relationsImportedAt);
  const bytes=await readFile(new URL('preview-济南/library-before.json',folder));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),(await read('preview-济南/state.json')).libraryHash);
  const library=JSON.parse(bytes.toString('utf8'));
  const exportBytes=await readFile(new URL('xhs-places-济南.json',folder));assert.equal(createHash('sha256').update(exportBytes).digest('hex'),sync.exportHash);
  for(const table of ['canonical_places','research_evidence','place_relation','data_import','independent_photo_assignments','place_relation_snapshots'])
    await pool.query(`INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(NULL::${table},$1::jsonb)`,[JSON.stringify(library.tables[table])]);
  const source=JSON.parse(await readFile(new URL('all-cities/batch-55-v2-source.json',import.meta.url),'utf8'));
  const decisions=JSON.parse(await readFile(new URL('all-cities/batch-55-v2-decisions.json',import.meta.url),'utf8'));
  const targets=source.groups.map((g:any)=>g.entity.entity_id);
  const before=await loadCityPlaceFacts('济南');
  const inputs=await loadIndependentPhotoSources('济南');assert.deepEqual(inputs.warnings,[]);
  const freeze=JSON.parse(await readFile(new URL('priority-cities/济南/laoshe-photo-metadata-01.json',import.meta.url),'utf8'));
  assert.equal(photoIdentityDigest(inputs),freeze.inputDigest);
  let queued=0;
  const makeIndex=(rows:PlaceRow[])=>createPlaceIdentityIndex(rows.filter(p=>p.verified||p.payload?.identityWithdrawal).map(p=>({...p,aliases:placeNames(p),evidence:[]})));
  const makeLookup=(rows:PlaceRow[])=>createGenerationPhotoLookup('济南',async()=>makeIndex(rows),{loadSources:async()=>inputs,
    loadAssignments:async()=>library.tables.independent_photo_assignments,adoption:{adoptUnsplash:async()=>false},enqueue:async()=>{queued++;}});
  const oldLookup=makeLookup(library.tables.canonical_places),beforeMedia=new Map();
  for(const name of ['老商埠','经三路','老舍故居','老舍笔下的济南'])beforeMedia.set(name,await oldLookup(name));
  const beforeMockEnqueues=queued;assert.equal(beforeMockEnqueues,1);queued=0;
  for(const kind of ['places','relations'])await promisify(execFile)(process.execPath,['--import','tsx',
    fileURLToPath(new URL(`../../../../apps/server/scripts/seed-xhs-${kind}.ts`,import.meta.url)),
    fileURLToPath(new URL(`xhs-${kind==='places'?'places':'place-relations'}-济南.json`,folder))],{env:process.env,windowsHide:true,timeout:60000});
  const facts=await loadCityPlaceFacts('济南');
  for(const g of source.groups) {
    const eid=g.entity.entity_id,decision=decisions.find((d:any)=>d.entityId===eid),museum=eid==='6a111b28c08cc7853140187bfd852b16';
    const current=facts.get(placeNameKey(decision.canonicalName)),old=before.get(placeNameKey(g.entity.canonical_name));assert.ok(current&&old);
    assert.equal(current.canonicalPlaceId,eid);assert.equal(current.placeType,museum?'attraction':'photo_spot');assert.equal(current.category,'文化');
    assert.equal(current.mentionCount,g.mentionIds.length);assert.ok(old.lat&&old.lng);
    if(museum){assert.equal(current.lat,old.lat);assert.equal(current.lng,old.lng);}else assert.ok(current.lat==null&&current.lng==null);
    for(const name of decision.aliases)assert.deepEqual(facts.get(placeNameKey(name)),current);
    assert.equal(current.visitMinutes,old.visitMinutes);
    const p=(await pool.query('SELECT name,payload FROM canonical_places WHERE id=$1',[eid])).rows[0];
    const previous=library.tables.canonical_places.find((p:any)=>p.id===eid),oldContent=structuredClone(previous.payload.content);
    oldContent.compiledAt=p.payload.content.compiledAt;assert.deepEqual(p.payload.content,oldContent);assert.deepEqual(p.payload.topReasons,previous.payload.topReasons);
    assert.equal(p.payload.address,museum?'南新街58号':'西更道街5号');
    const evidence=(await pool.query('SELECT kind,content FROM research_evidence WHERE place_id=$1 AND kind LIKE $2',[eid,'xhs_%'])).rows;
    const prior=library.tables.research_evidence.filter((e:any)=>e.place_id===eid&&e.kind.startsWith('xhs_')).map((e:any)=>({kind:e.kind,content:e.content}));
    assert.equal(evidence.length,museum?3:1);assert.deepEqual(new Set(evidence.map(e=>JSON.stringify(e))),new Set(prior.map((e:any)=>JSON.stringify(e))));
    if(museum){assert.equal(p.payload.mentionSources,undefined);assert.equal(p.payload.imageIdentity,undefined);assert.match(JSON.stringify(p.payload.topReasons),/从五龙潭南门出500米/);}
    else assert.deepEqual(p.payload.mentionSources.map((m:any)=>m.mentionId),[12694]);
  }
  for(const [name,value] of before)if(!targets.includes(value.canonicalPlaceId??''))assert.deepEqual(facts.get(name),value,`其他主体事实/${name}`);
  const rows=(await pool.query<PlaceRow>('SELECT id,city,name,category,lat,lng,verified,source,payload FROM canonical_places WHERE city=$1',['济南'])).rows;
  const index=makeIndex(rows),lookup=makeLookup(rows),media=[];
  for(const [name,count,digest] of [['老商埠',3,'2c29d7b93a412f38eb21d6ce3ece4f175e0576dee87bee3a179d5bb095868603'],
    ['经三路',1,'2143dbc77997beeaf461e337c7f018783583096ae8e60dac777fba41cdbefddd'],
    ['老舍故居',2,'5b29595c5b0ea1e07d65dc896d5f79992af0e3a406b6ebe06a67289a9ed96b9c']] as const) {
    const result=await lookup(name);assert.deepEqual(result,beforeMedia.get(name));assert.equal(result?.photos?.length,count);assert.equal(photoIdentityDigest(result),digest);media.push({name,count,digest});
  }
  const canonicalized=[];
  for(const name of ['老舍故居','济南老舍纪念馆','老舍纪念馆']) {
    const resolved=index.resolve('济南',name);assert.ok(resolved.status==='resolved');assert.equal(resolved.place.name,'老舍故居');
    const result=await lookup(resolved.place.name);assert.deepEqual(result,beforeMedia.get('老舍故居'));
    canonicalized.push({input:name,canonicalName:resolved.place.name,photos:result?.photos?.length});
  }
  assert.equal(beforeMedia.get('老舍笔下的济南'),null);
  for(const name of ['老舍笔下的济南','老舍笔下的济南主题墙'])assert.equal(await lookup(name),null);
  assert.equal(queued,0);
  const afterMockEnqueues=queued,rawAliases=[];
  for(const name of ['济南老舍纪念馆','老舍纪念馆']){assert.equal(await lookup(name),null);rawAliases.push({name,photos:0});}
  assert.equal(queued,2);
  const report={batch:55,variant:'v2',isolated:true,synthetic:false,fullCityPlaces:JSON.parse(exportBytes.toString('utf8')).places.length,
    actualPlaceFacts:true,priorGovernedFactsPreserved:true,confirmedIdentityPreserved:true,contentAndEvidencePreserved:true,museumDescriptionFindingUnapplied:true,museumScopeDeferred:true,
    coordinatesCleared:1,categoriesCorrected:1,addressesCorrected:2,independentIdentityPreserved:true,media,canonicalized,rawAliases,
    independentSourceDigestUnchanged:true,mockEnqueueCalls:{before:beforeMockEnqueues,after:afterMockEnqueues},rawAliasProbeMockEnqueues:2,actualEnqueues:0,
    enqueueMeaning:'旧墙无图触发1次mock，scope后0；新增纪念馆别名须先解析到故居主名以取既有2图，裸别名直接查图仍为0，单独探针触发2次mock。真实队列未写入。',
    imageComparison:'deferred_by_user',failures:[]};
  await writeFile(new URL(`laoshe-consumption-${Date.now()}.json`,folder),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
});
