// 只读真实事实及图片消费；补图和采纳均注入空实现，名称语义预期独立于别名配置。
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {parse} from 'dotenv';
import {createPlaceIdentityIndex,placeNames} from '../../../../apps/server/src/lib/placeIdentity';
import type {PlaceRow} from '../../../../apps/server/src/generation/retrievalRanking';
const [mode,output] = process.argv.slice(2);
assert.ok(mode==='before'||mode==='after'); assert.ok(output);
Object.assign(process.env,parse(await readFile('apps/server/.env')));
const {pool}=await import('../../../../apps/server/src/db/client');
const {loadCityPlaceFacts}=await import('../../../../apps/server/src/generation/scheduling/placeFacts');
const {createGenerationPhotoLookup}=await import('../../../../apps/server/src/integrations/photoEnrichment');
const {loadIndependentPhotoSources,photoIdentityDigest}=await import('../../../../apps/server/src/services/independentPhotoSources');
const target='981bfe8125feb36e052dcfee1e0df8b5',old='a94865355cdbf6fccfda6fc748b9e9fe';
try {
  const rows=(await pool.query<PlaceRow>("SELECT * FROM canonical_places WHERE city='北京' ORDER BY id")).rows;
  const index=createPlaceIdentityIndex(rows.filter(p=>p.verified||p.payload?.identityWithdrawal));
  const facts=await loadCityPlaceFacts('北京'),fact=facts.get('景山公园'); assert.ok(fact);
  const inputs=await loadIndependentPhotoSources('北京'); assert.deepEqual(inputs.warnings,[]);
  const assignments=(await pool.query("SELECT * FROM independent_photo_assignments WHERE city='北京' ORDER BY image_key")).rows;
  const queued:string[]=[];
  const lookup=createGenerationPhotoLookup('北京',async()=>createPlaceIdentityIndex(rows.filter(p=>p.verified||p.payload?.identityWithdrawal)
    .map(p=>({...p,aliases:placeNames(p),evidence:[]}))),
    {loadSources:async()=>inputs,loadAssignments:async()=>assignments,adoption:{adoptUnsplash:async()=>false},
      enqueue:async(_city,name)=>{queued.push(name);}});
  const photos=await lookup('景山公园');
  const checks:Record<string,boolean>={};
  for(const name of ['景山公园','景山']) for(const id of [undefined,target,old]) {
    const resolved=index.resolve('北京',name,id);
    checks[`correctName:${name}:${id??'noId'}`]=resolved.status==='resolved'&&resolved.canonicalPlaceId===target;
  }
  for(const id of [undefined,target,old]) {
    const resolved=index.resolve('北京','石景山公园',id);
    checks[`wrongName:${id??'noId'}`]=mode==='before'
      ? resolved.status==='resolved'&&resolved.canonicalPlaceId===target : resolved.status!=='resolved';
  }
  checks.wrongNameFacts=mode==='before'?facts.get('石景山公园')===fact:!facts.has('石景山公园');
  const report={mode,readOnly:true,checks,passed:Object.values(checks).every(Boolean),fact,photos,
    independentInputsDigest:photoIdentityDigest(inputs),assignmentsDigest:photoIdentityDigest(assignments),
    mockEnqueues:queued,actualEnqueues:0,photoSemanticReview:false};
  if(mode==='after') {
    const before=JSON.parse(await readFile('.trellis/tasks/10-09-attraction-top30-governance/research/jingshan-consumption-before.json','utf8'));
    assert.deepEqual(report.photos,before.photos,'专用查图返回变化');
    const withoutAliases=({aliases,...rest}:typeof fact)=>rest;
    assert.deepEqual(withoutAliases(fact),withoutAliases(before.fact),'真实facts除别名外发生变化');
    assert.equal(report.independentInputsDigest,before.independentInputsDigest);
    assert.equal(report.assignmentsDigest,before.assignmentsDigest);
    assert.deepEqual(report.mockEnqueues,before.mockEnqueues);
  }
  await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  assert.ok(report.passed);
  console.log(JSON.stringify({mode,passed:true,checks:Object.keys(checks).length,factImages:fact.imageGallery?.length??0,
    lookupPresent:photos!==null,actualEnqueues:0,afterConsumptionPreserved:mode==='after'}));
} finally {await pool.end();}
