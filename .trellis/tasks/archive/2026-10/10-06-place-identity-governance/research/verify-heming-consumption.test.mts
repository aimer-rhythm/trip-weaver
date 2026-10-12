// 全城临时库双导入，实际facts及旧主名图片返回逐项核对；不看图、不真实入队。
import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {readFile,writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {createPlaceIdentityIndex,placeNames} from '../../../../apps/server/src/lib/placeIdentity';
import type {PlaceRow} from '../../../../apps/server/src/generation/retrievalRanking';
import {HEMING_ID,HEMING_WARNING,expectedHemingExport} from './heming-assertions';
assert.match(process.env.DATABASE_URL??'',/127\.0\.0\.1:18798\/place_identity_test_\d+$/);
const {pool}=await import('../../../../apps/server/src/db/client');
const {loadCityPlaceFacts}=await import('../../../../apps/server/src/generation/scheduling/placeFacts');
const {createGenerationPhotoLookup}=await import('../../../../apps/server/src/integrations/photoEnrichment');
const {loadIndependentPhotoSources,photoIdentityDigest}=await import('../../../../apps/server/src/services/independentPhotoSources');
after(()=>pool.end());
test('茶社完整scope保全全部实际facts及旧图库返回，停止茶社补图',async()=>{
  const read=async(p:string)=>JSON.parse(await readFile(new URL(p,import.meta.url),'utf8'));
  const folder='all-cities/batch-69/sync-01/',library=await read(folder+'preview-成都/library-before.json'),decisions=[{entityId:HEMING_ID,canonicalName:'鹤鸣茶社'}],ids=[HEMING_ID];
  for(const table of ['canonical_places','research_evidence','place_relation','data_import','independent_photo_assignments','place_relation_snapshots'])
    await pool.query(`INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(NULL::${table},$1::jsonb)`,[JSON.stringify(library.tables[table])]);
  const before=await loadCityPlaceFacts('成都'),inputs=await loadIndependentPhotoSources('成都');assert.deepEqual(inputs.warnings,[]);
  assert.equal(photoIdentityDigest(inputs),(await read('priority-cities/成都/park-zones-photo-metadata-01.json')).inputDigest);
  const queued:string[]=[];
  const makeLookup=(rows:PlaceRow[])=>createGenerationPhotoLookup('成都',async()=>createPlaceIdentityIndex(rows.filter(p=>p.verified||p.payload?.identityWithdrawal).map(p=>({...p,aliases:placeNames(p),evidence:[]}))),
    {loadSources:async()=>inputs,loadAssignments:async()=>library.tables.independent_photo_assignments,adoption:{adoptUnsplash:async()=>false},enqueue:async(_city,name)=>{queued.push(name);}});
  const lookupBefore=makeLookup(library.tables.canonical_places),mediaBefore=new Map<string,Awaited<ReturnType<typeof lookupBefore>>>();
  for(const p of library.tables.canonical_places.filter((p:PlaceRow)=>p.verified))mediaBefore.set(p.name,await lookupBefore(p.name));
  const beforeCalls=[...queued];queued.length=0;
  for(const kind of ['places','relations'])await promisify(execFile)(process.execPath,['--import','tsx',fileURLToPath(new URL(`../../../../apps/server/scripts/seed-xhs-${kind}.ts`,import.meta.url)),fileURLToPath(new URL(folder+`xhs-${kind==='places'?'places':'place-relations'}-成都.json`,import.meta.url))],{env:process.env,windowsHide:true,timeout:60000});
  const afterFacts=await loadCityPlaceFacts('成都');assert.equal(afterFacts.size,before.size);let correctedKeys=0;
  for(const [name,value]of before){const expected=structuredClone(value);
    if(ids.includes(value.canonicalPlaceId ?? '')){correctedKeys++;}
    assert.deepEqual(afterFacts.get(name),expected,`facts/${name}`);
  }
  const rows=(await pool.query<PlaceRow>('SELECT id,city,name,category,lat,lng,verified,source,payload FROM canonical_places WHERE city=$1',['成都'])).rows,lookup=makeLookup(rows),media=[];
  for(const [name,old]of mediaBefore){const actual=await lookup(name);assert.deepEqual(actual,old,`旧主名图库/${name}`);if(old)media.push({name,count:old.photos?.length??0,digest:photoIdentityDigest(old)});}
  assert.deepEqual(queued,beforeCalls.filter(name=>name!=='鹤鸣茶社'));for(const d of decisions)assert.equal(mediaBefore.get(d.canonicalName),null);
  const targetFactMedia=['人民公园','鹤鸣茶社'].map(name=>{
    const old=before.get(name),current=afterFacts.get(name);assert.ok(old&&current);
    assert.deepEqual(current.imageGallery,old.imageGallery);assert.equal(current.coverImage,old.coverImage);
    return {name,galleryCount:old.imageGallery?.length??0,hasCover:!!old.coverImage,actualLookupPhotos:mediaBefore.get(name)?.photos?.length??0};
  });
  assert.deepEqual(targetFactMedia,[{name:'人民公园',galleryCount:1,hasCover:true,actualLookupPhotos:0},{name:'鹤鸣茶社',galleryCount:0,hasCover:false,actualLookupPhotos:0}]);
  const tea=rows.find(p=>p.id===HEMING_ID);assert.ok(tea);assert.deepEqual(tea.payload?.tips,[HEMING_WARNING]);
  const source=await read('all-cities/batch-69-source.json'),previous=(await read('all-cities/batch-68/sync-01/xhs-places-成都.json')).places.find((p:any)=>p.id===HEMING_ID);
  const expected=expectedHemingExport(previous,source);
  const evidence=(await pool.query('SELECT kind,content,source_url AS "sourceUrl" FROM research_evidence WHERE place_id=$1 AND kind LIKE $2',[HEMING_ID,'xhs_%'])).rows;
  assert.deepEqual(evidence.map(e=>JSON.stringify(e)).sort(),expected.evidence.map((e:any)=>JSON.stringify(e)).sort());
  assert.deepEqual((tea.payload?.content as any).highlights,expected.payload.content.highlights);
  const report={batch:69,isolated:true,actualPlaceFacts:true,allOtherFactsPreserved:true,correctedNameKeys:correctedKeys,oldCanonicalMediaProbes:mediaBefore.size,
    nonEmptyOldMedia:media,allOldMediaReturnsPreserved:true,targetPhotos:0,oldNameMockEnqueues:{before:beforeCalls.length,after:queued.length},actualEnqueues:0,
    targetFactMedia,targetPhotosMeaning:'茶社scope前后facts和lookup均无图；公园facts旧1图及封面保持。',multilineWarningPreserved:true,originalWarningsPreserved:2,currentEvidence:7,originalHighlightsPreserved:4,independentSourceDigestPreserved:true,imageComparison:'deferred_by_user',failures:[]};
  await writeFile(new URL(folder+`heming-consumption-${Date.now()}.json`,import.meta.url),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
});
