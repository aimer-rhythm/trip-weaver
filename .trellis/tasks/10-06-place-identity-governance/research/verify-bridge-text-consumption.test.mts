import {assertBridgeTextRow,GATE_ID,GATE_NAME} from './bridge-text-assertions';
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
test('门洞独立摄影停留、桥体旧消费及实际图库保全',async()=>{
  const folder=new URL('all-cities/batch-65/sync-01/',import.meta.url);
  const read=async(p:string)=>JSON.parse(await readFile(new URL(p,folder),'utf8'));
  const sync=(await read('sync-state.json')).cities['济南'];assert.ok(sync.importedAt&&sync.relationsImportedAt);
  const bytes=await readFile(new URL('preview-济南/library-before.json',folder));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),(await read('preview-济南/state.json')).libraryHash);
  const library=JSON.parse(bytes.toString('utf8'));
  const exportBytes=await readFile(new URL('xhs-places-济南.json',folder));assert.equal(createHash('sha256').update(exportBytes).digest('hex'),sync.exportHash);
  for(const table of ['canonical_places','research_evidence','place_relation','data_import','independent_photo_assignments','place_relation_snapshots'])
    await pool.query(`INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(NULL::${table},$1::jsonb)`,[JSON.stringify(library.tables[table])]);
  const source=JSON.parse(await readFile(new URL('priority-cities/济南/bridge-text-source-packet-01.json',import.meta.url),'utf8'));
  const targets=source.groups.map((g:any)=>g.entity.entity_id);
  const before=await loadCityPlaceFacts('济南');
  const inputs=await loadIndependentPhotoSources('济南');assert.deepEqual(inputs.warnings,[]);
  const freeze=JSON.parse(await readFile(new URL('priority-cities/济南/bridge-text-photo-metadata-01.json',import.meta.url),'utf8'));
  assert.equal(photoIdentityDigest(inputs),freeze.inputDigest);
  const queuedNames:string[]=[];
  const makeIndex=(rows:PlaceRow[])=>createPlaceIdentityIndex(rows.filter(p=>p.verified||p.payload?.identityWithdrawal).map(p=>({...p,aliases:placeNames(p),evidence:[]})));
  const makeLookup=(rows:PlaceRow[])=>createGenerationPhotoLookup('济南',async()=>makeIndex(rows),{loadSources:async()=>inputs,
    loadAssignments:async()=>library.tables.independent_photo_assignments,adoption:{adoptUnsplash:async()=>false},enqueue:async(_city,name)=>{queuedNames.push(name);}});
  const oldLookup=makeLookup(library.tables.canonical_places),beforeMedia=new Map();
  for(const name of ['老商埠','经三路','老舍故居',...source.groups.map((g:any)=>g.entity.canonical_name)])beforeMedia.set(name,await oldLookup(name));
  const beforeMockEnqueues=queuedNames.length;assert.equal(beforeMockEnqueues,2);
  assert.deepEqual([...queuedNames].sort(),['起凤桥','起凤桥八号']);queuedNames.length=0;
  for(const kind of ['places','relations'])await promisify(execFile)(process.execPath,['--import','tsx',
    fileURLToPath(new URL(`../../../../apps/server/scripts/seed-xhs-${kind}.ts`,import.meta.url)),
    fileURLToPath(new URL(`xhs-${kind==='places'?'places':'place-relations'}-济南.json`,folder))],{env:process.env,windowsHide:true,timeout:60000});
  const facts=await loadCityPlaceFacts('济南');
  for(const g of source.groups) {
    const eid=g.entity.entity_id,sid=g.entity.primary_place_id;
    const current=facts.get(placeNameKey(sid===5392?GATE_NAME:g.entity.canonical_name)),old=before.get(placeNameKey(g.entity.canonical_name));assert.ok(old);
    const p=(await pool.query('SELECT id,name,payload,verified,category,lat,lng FROM canonical_places WHERE id=$1',[eid])).rows[0];
    const previous=library.tables.canonical_places.find((p:any)=>p.id===eid);
    const evidence=(await pool.query('SELECT kind,content FROM research_evidence WHERE place_id=$1 AND kind LIKE $2',[eid,'xhs_%'])).rows;
    const prior=library.tables.research_evidence.filter((e:any)=>e.place_id===eid&&e.kind.startsWith('xhs_')).map((e:any)=>({kind:e.kind,content:e.content}));
    assertBridgeTextRow(p,previous,sid,evidence,prior);
    assert.ok(current);assert.equal(current.canonicalPlaceId,eid);
    assert.equal(current.category,'文化');assert.equal(current.placeType,'photo_spot');
    assert.equal(current.mentionCount,old.mentionCount);assert.equal(current.visitMinutes,old.visitMinutes);
    assert.equal(current.lat,old.lat);assert.equal(current.lng,old.lng);
    if(sid===5392){assert.equal(current.visitMinutes,30);assert.ok(!facts.has(placeNameKey('起凤桥八号')));}

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
  for(const g of source.groups){
    assert.equal(beforeMedia.get(g.entity.canonical_name),null);
    assert.equal(await lookup(g.entity.primary_place_id===5392?GATE_NAME:g.entity.canonical_name),null);
  }
  assert.deepEqual(queuedNames,['起凤桥']);
  const afterMockEnqueues=queuedNames.length;
  for(const id of [undefined,GATE_ID]) {const result=index.resolve('济南','起凤桥八号',id);assert.ok(result.status!=='resolved'||result.canonicalPlaceId!==GATE_ID);}
  assert.equal(index.isScopedReference('济南',GATE_NAME),true);
  assert.equal(index.isScopedReference('济南','起凤桥八号'),false);
  assert.equal(await lookup('起凤桥八号'),null);
  assert.deepEqual(queuedNames,['起凤桥','起凤桥八号']);
  const excludedNameProbe={name:'起凤桥八号',resolvedToGate:false,photos:null,mockEnqueueCalls:queuedNames.length-afterMockEnqueues};
  assert.equal(excludedNameProbe.mockEnqueueCalls,1);
  const report={batch:65,isolated:true,synthetic:false,fullCityPlaces:JSON.parse(exportBytes.toString('utf8')).places.length,
    actualPlaceFacts:true,priorGovernedFactsPreserved:true,confirmedIdentityPreserved:true,validOldOpinionsAndHighlightsPreserved:true,
    scopesAdded:1,confirmed:2,pendingAdded:0,readOnlySources:1,gateMinutes:30,
    coordinatesCleared:0,newPreciseLocations:0,media,canonicalized,
    independentSourceDigestUnchanged:true,mockEnqueueCalls:{before:beforeMockEnqueues,after:afterMockEnqueues},excludedNameProbe,totalAfterMockEnqueues:queuedNames.length,actualEnqueues:0,
    enqueueMeaning:'当前主名路径mock2→1，仅起凤桥普通回退；新门洞名scope阻止回退。旧裸名已排除且不再是scope引用，单独直接请求仍走未知名称普通回退，另1次mock，总2次；各返回null，真实队列未写入，旧3/1/2图库保持。',
    imageComparison:'deferred_by_user',failures:[]};
  await writeFile(new URL(`bridge-text-consumption-${Date.now()}.json`,folder),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
});
