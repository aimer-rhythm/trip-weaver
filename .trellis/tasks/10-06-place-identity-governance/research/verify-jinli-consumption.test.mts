// 隔离双导入，比较全城实际facts和图片返回；不读取或显示图片。
import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {readFile,writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {createPlaceIdentityIndex,placeNames} from '../../../../apps/server/src/lib/placeIdentity';
import type {PlaceRow} from '../../../../apps/server/src/generation/retrievalRanking';
assert.match(process.env.DATABASE_URL??'',/127\.0\.0\.1:18798\/place_identity_test_\d+$/);
const {pool}=await import('../../../../apps/server/src/db/client');
const {loadCityPlaceFacts}=await import('../../../../apps/server/src/generation/scheduling/placeFacts');
const {createGenerationPhotoLookup}=await import('../../../../apps/server/src/integrations/photoEnrichment');
const {loadIndependentPhotoSources,photoIdentityDigest}=await import('../../../../apps/server/src/services/independentPhotoSources');
after(()=>pool.end());
test('锦里scope退出主巷名称入口，保全全城实际图片及武侯祠事实',async()=>{
  const read=async(p:string)=>JSON.parse(await readFile(new URL(p,import.meta.url),'utf8'));
  const folder='all-cities/batch-70/sync-01/',library=await read(folder+'preview-成都/library-before.json');
  const id='8a433260acdd259716088f8009e0fbdc',subarea='锦里古街主巷';
  const expected=(await read('all-cities/batch-70/scope-preview-1791512008187072400/xhs-places-成都.json')).places.find((p:any)=>p.id===id);
  for(const table of ['canonical_places','research_evidence','place_relation','data_import','independent_photo_assignments','place_relation_snapshots'])
    await pool.query(`INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(NULL::${table},$1::jsonb)`,[JSON.stringify(library.tables[table])]);
  const before=await loadCityPlaceFacts('成都'),inputs=await loadIndependentPhotoSources('成都');assert.deepEqual(inputs.warnings,[]);
  assert.equal(photoIdentityDigest(inputs),(await read('priority-cities/成都/wuhou-jinli-photo-metadata-01.json')).inputDigest);
  const queued:string[]=[];
  const makeLookup=(rows:PlaceRow[])=>createGenerationPhotoLookup('成都',async()=>createPlaceIdentityIndex(rows.filter(p=>p.verified||p.payload?.identityWithdrawal).map(p=>({...p,aliases:placeNames(p),evidence:[]}))),
    {loadSources:async()=>inputs,loadAssignments:async()=>library.tables.independent_photo_assignments,adoption:{adoptUnsplash:async()=>false},enqueue:async(_city,name)=>{queued.push(name);}});
  const lookupBefore=makeLookup(library.tables.canonical_places),mediaBefore=new Map<string,Awaited<ReturnType<typeof lookupBefore>>>();
  for(const p of library.tables.canonical_places.filter((p:PlaceRow)=>p.verified))mediaBefore.set(p.name,await lookupBefore(p.name));
  const beforeCalls=[...queued];queued.length=0;
  for(const kind of ['places','relations'])await promisify(execFile)(process.execPath,['--import','tsx',fileURLToPath(new URL(`../../../../apps/server/scripts/seed-xhs-${kind}.ts`,import.meta.url)),fileURLToPath(new URL(folder+`xhs-${kind==='places'?'places':'place-relations'}-成都.json`,import.meta.url))],{env:process.env,windowsHide:true,timeout:60000});
  // complex子名原本就不借用母项facts；本次退出的是includeComponents检索入口。
  const current=await loadCityPlaceFacts('成都');assert.ok(!before.has(subarea));assert.ok(!current.has(subarea));assert.equal(current.size,before.size);
  const beforeIndex=createPlaceIdentityIndex(library.tables.canonical_places as PlaceRow[]);
  assert.equal(beforeIndex.resolve('成都',subarea,id).status,'unresolved');
  assert.equal(beforeIndex.resolve('成都',subarea,id,true).status,'resolved');
  let correctedKeys=0;
  for(const [name,value]of before){
    const planned=structuredClone(value);
    if(value.canonicalPlaceId===id){correctedKeys++;Object.assign(planned,{placeType:'market',themes:expected.payload.themes,mentionCount:16,recommendScore:expected.payload.recommendScore});}
    assert.deepEqual(current.get(name),planned,`实际facts/${name}`);
  }
  assert.equal(correctedKeys,2);assert.equal(current.get('锦里')?.visitMinutes,undefined);
  assert.deepEqual(current.get('武侯祠'),before.get('武侯祠'));
  const rows=(await pool.query<PlaceRow>('SELECT id,city,name,category,lat,lng,verified,source,payload FROM canonical_places WHERE city=$1',['成都'])).rows;
  const lookup=makeLookup(rows),media=[];
  for(const [name,old]of mediaBefore){assert.deepEqual(await lookup(name),old,`旧主名图库/${name}`);if(old)media.push({name,count:old.photos?.length??0,digest:photoIdentityDigest(old)});}
  assert.deepEqual(queued,beforeCalls.filter(name=>name!=='锦里'));assert.equal(mediaBefore.get('锦里'),null);
  const canonicalMockAfter=queued.length;assert.equal(await lookup(subarea),null);
  assert.deepEqual(queued.slice(canonicalMockAfter),[subarea]);
  const targetFactMedia=['武侯祠','锦里','人民公园'].map(name=>{
    const old=before.get(name),after=current.get(name);assert.ok(old&&after);
    assert.deepEqual(after.imageGallery,old.imageGallery);assert.equal(after.coverImage,old.coverImage);assert.equal(after.amapPhoto,old.amapPhoto);
    return {name,galleryCount:old.imageGallery?.length??0,hasCover:!!old.coverImage,actualLookupPhotos:mediaBefore.get(name)?.photos?.length??0};
  });
  const actual=rows.find(p=>p.id===id);assert.ok(actual);assert.deepEqual(actual.payload?.tips,expected.payload.tips);
  const afterIndex=createPlaceIdentityIndex(rows);let componentIntentBoundaryProbes=0;
  for(const oldId of [undefined,...(actual.payload?.identity as any).memberIds]){
    assert.equal(afterIndex.resolve('成都',subarea,oldId,true).status,'unresolved');componentIntentBoundaryProbes++;
  }
  assert.deepEqual((actual.payload?.content as any).highlights,expected.payload.content.highlights);
  const evidence=(await pool.query('SELECT kind,content,source_url AS "sourceUrl" FROM research_evidence WHERE place_id=$1 AND kind LIKE $2',[id,'xhs_%'])).rows;
  assert.deepEqual(evidence.map(e=>JSON.stringify(e)).sort(),expected.evidence.map((e:any)=>JSON.stringify(e)).sort());
  const report={batch:70,isolated:true,actualPlaceFacts:true,allOtherFactsPreserved:true,correctedNameKeys:correctedKeys,removedFactNameKeys:[],removedComponentIntentNameKeys:[subarea],componentIntentBoundaryProbes,
    oldCanonicalMediaProbes:mediaBefore.size,nonEmptyOldMedia:media,allOldMediaReturnsPreserved:true,
    oldNameMockEnqueues:{before:beforeCalls.length,after:canonicalMockAfter},subareaUnknownNameMockEnqueues:1,actualEnqueues:0,targetFactMedia,
    originalWarningsPreserved:7,textWarnings:3,currentEvidence:18,oldValidHighlightsPreserved:3,wuhouAllFactsPreserved:true,
    independentSourceDigestPreserved:true,imageComparison:'deferred_by_user',failures:[]};
  await writeFile(new URL(folder+`jinli-consumption-${Date.now()}.json`,import.meta.url),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
});
