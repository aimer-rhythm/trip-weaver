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
test('明确餐饮分店与四条待审内容隔离、原有事实图库保持',async()=>{
  const folder=new URL('all-cities/batch-57/sync-01/',import.meta.url);
  const read=async(p:string)=>JSON.parse(await readFile(new URL(p,folder),'utf8'));
  const sync=(await read('sync-state.json')).cities['济南'];assert.ok(sync.importedAt&&sync.relationsImportedAt);
  const bytes=await readFile(new URL('preview-济南/library-before.json',folder));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),(await read('preview-济南/state.json')).libraryHash);
  const library=JSON.parse(bytes.toString('utf8'));
  const exportBytes=await readFile(new URL('xhs-places-济南.json',folder));assert.equal(createHash('sha256').update(exportBytes).digest('hex'),sync.exportHash);
  for(const table of ['canonical_places','research_evidence','place_relation','data_import','independent_photo_assignments','place_relation_snapshots'])
    await pool.query(`INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(NULL::${table},$1::jsonb)`,[JSON.stringify(library.tables[table])]);
  const source=JSON.parse(await readFile(new URL('all-cities/batch-57-source.json',import.meta.url),'utf8'));
  const decisions=JSON.parse(await readFile(new URL('all-cities/batch-57-decisions.json',import.meta.url),'utf8'));
  const targets=source.groups.map((g:any)=>g.entity.entity_id);
  const before=await loadCityPlaceFacts('济南');
  const inputs=await loadIndependentPhotoSources('济南');assert.deepEqual(inputs.warnings,[]);
  const freeze=JSON.parse(await readFile(new URL('priority-cities/济南/restaurant-branches-photo-metadata-01.json',import.meta.url),'utf8'));
  assert.equal(photoIdentityDigest(inputs),freeze.inputDigest);
  let queued=0;
  const makeIndex=(rows:PlaceRow[])=>createPlaceIdentityIndex(rows.filter(p=>p.verified||p.payload?.identityWithdrawal).map(p=>({...p,aliases:placeNames(p),evidence:[]})));
  const makeLookup=(rows:PlaceRow[])=>createGenerationPhotoLookup('济南',async()=>makeIndex(rows),{loadSources:async()=>inputs,
    loadAssignments:async()=>library.tables.independent_photo_assignments,adoption:{adoptUnsplash:async()=>false},enqueue:async()=>{queued++;}});
  const oldLookup=makeLookup(library.tables.canonical_places),beforeMedia=new Map();
  for(const name of ['老商埠','经三路','老舍故居','燕喜堂','刘小忙把子肉','亮亮拉面'])beforeMedia.set(name,await oldLookup(name));
  const beforeMockEnqueues=queued;assert.equal(beforeMockEnqueues,3);queued=0;
  for(const kind of ['places','relations'])await promisify(execFile)(process.execPath,['--import','tsx',
    fileURLToPath(new URL(`../../../../apps/server/scripts/seed-xhs-${kind}.ts`,import.meta.url)),
    fileURLToPath(new URL(`xhs-${kind==='places'?'places':'place-relations'}-济南.json`,folder))],{env:process.env,windowsHide:true,timeout:60000});
  const facts=await loadCityPlaceFacts('济南');
  for(const g of source.groups) {
    const eid=g.entity.entity_id,decision=decisions.find((d:any)=>d.entityId===eid);
    const expectedMentions=g.mentionIds.filter((id:number)=>![11481,11525,12741,12798].includes(id));
    const current=facts.get(placeNameKey(decision.canonicalName)),old=before.get(placeNameKey(g.entity.canonical_name));assert.ok(current&&old);
    assert.equal(current.canonicalPlaceId,eid);assert.equal(current.placeType,'food');assert.equal(current.category,'美食');
    assert.equal(current.mentionCount,expectedMentions.length);assert.equal(old.mentionCount,g.mentionIds.length);assert.ok(old.lat&&old.lng);assert.ok(current.lat==null&&current.lng==null);
    for(const name of decision.aliases)assert.deepEqual(facts.get(placeNameKey(name)),current);
    assert.equal(current.visitMinutes,undefined);
    const p=(await pool.query('SELECT name,payload FROM canonical_places WHERE id=$1',[eid])).rows[0];
    const expected=JSON.parse(exportBytes.toString('utf8')).places.find((r:any)=>r.id===eid);
    assert.deepEqual(p.payload.content,expected.payload.content);assert.deepEqual(p.payload.topReasons,expected.payload.topReasons);
    assert.equal(p.payload.address,decision.overrides.address);assert.equal(p.payload.geoStatus,'unresolvable');
    const evidence=(await pool.query('SELECT kind,content FROM research_evidence WHERE place_id=$1 AND kind LIKE $2',[eid,'xhs_%'])).rows;
    assert.deepEqual(evidence.map(e=>e.content).sort(),source.mentions.filter((m:any)=>expectedMentions.includes(m.id)).map((m:any)=>m.reason).sort());
    assert.doesNotMatch(JSON.stringify({facts:current,payload:p.payload,evidence}),/位于Day2路线中，是济南鲁菜代表|济南特色美食店铺推荐|骨汤浓郁，拉面劲道牛肉大块/);
    assert.deepEqual(p.payload.mentionSources.map((m:any)=>m.mentionId).sort((a:number,b:number)=>a-b),expectedMentions);
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
  for(const name of ['燕喜堂','刘小忙把子肉','亮亮拉面']){assert.equal(beforeMedia.get(name),null);assert.equal(await lookup(name),null);}
  for(const d of decisions)assert.equal(await lookup(d.canonicalName),null);assert.equal(queued,0);
  const afterMockEnqueues=queued;
  const report={batch:57,isolated:true,synthetic:false,fullCityPlaces:JSON.parse(exportBytes.toString('utf8')).places.length,
    actualPlaceFacts:true,priorGovernedFactsPreserved:true,confirmedIdentityPreserved:true,confirmedContentAndEvidencePreserved:true,pendingContentExcluded:4,
    coordinatesCleared:3,categoriesCorrected:0,addressesCorrected:3,independentIdentityPreserved:true,media,canonicalized,
    independentSourceDigestUnchanged:true,mockEnqueueCalls:{before:beforeMockEnqueues,after:afterMockEnqueues},actualEnqueues:0,
    enqueueMeaning:'原3个普通主体均无图、触发3次mock；完整scope后3个原名及分店新名均无图、0次mock，旧3/1/2图库保持。真实队列未写入。',
    imageComparison:'deferred_by_user',failures:[]};
  await writeFile(new URL(`restaurant-branches-consumption-${Date.now()}.json`,folder),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
});
