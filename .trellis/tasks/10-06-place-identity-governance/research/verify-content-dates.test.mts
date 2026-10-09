import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {verifyContentDates,verifyEvidenceRefresh} from './content-dates-contract.mjs';
assert.match(process.env.DATABASE_URL??'',/127\.0\.0\.1:18798\/place_identity_test_\d+$/);
const {pool}=await import('../../../../apps/server/src/db/client');
const {loadCityPlaceFacts}=await import('../../../../apps/server/src/generation/scheduling/placeFacts');
const {loadPlaceRelations}=await import('../../../../apps/server/src/generation/scheduling/placeRelations');
const {captureIdentityImport,rollbackIdentityImport}=await import('../../../../apps/server/src/services/placeIdentityAudit');
const {createGenerationPhotoLookup}=await import('../../../../apps/server/src/integrations/photoEnrichment');
const {loadIndependentPhotoSources,photoIdentityDigest}=await import('../../../../apps/server/src/services/independentPhotoSources');
after(()=>pool.end());
test('日期元数据实城双导入、重复导入、实际事实和图库保全、逆序审计回滚',async()=>{
  const folder=new URL('metadata/content-dates-01/sync-01/',import.meta.url);
  const read=async(p:string)=>JSON.parse(await readFile(new URL(p,folder),'utf8'));
  const state=await read('state.json');assert.equal(state.phase,'frozen');assert.equal(state.sourceRevision,24);
  const documents:any={};
  for(const [name,key]of [['library-before.json','libraryHash'],['xhs-places-济南.json','placesHash'],['xhs-place-relations-济南.json','relationsHash']]) {
    const bytes=await readFile(new URL(name!,folder));assert.equal(createHash('sha256').update(bytes).digest('hex'),state[key!]);documents[name!]=JSON.parse(bytes.toString());
  }
  const library=documents['library-before.json'],places=documents['xhs-places-济南.json'],graph=documents['xhs-place-relations-济南.json'];
  const baseline=await read('../preview/report.json');assert.deepEqual(baseline.failures,[]);
  assert.deepEqual(graph.relationIdentity,library.tables.place_relation_snapshots[0].manifest);
  assert.deepEqual(graph.relations,library.tables.place_relation_snapshots[0].relations);
  for(const table of ['canonical_places','research_evidence','place_relation','data_import','independent_photo_assignments','place_relation_snapshots'])
    await pool.query(`INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(NULL::${table},$1::jsonb)`,[JSON.stringify(library.tables[table])]);
  const factsBefore=await loadCityPlaceFacts('济南'),relationsBefore=await loadPlaceRelations('济南');
  const inputs=await loadIndependentPhotoSources('济南');assert.deepEqual(inputs.warnings,[]);
  const mediaFreeze=JSON.parse(await readFile(new URL('priority-cities/济南/vintage-photo-metadata-01.json',import.meta.url),'utf8'));
  assert.equal(photoIdentityDigest(inputs),mediaFreeze.inputDigest);
  let queued=0;
  const lookup=()=>createGenerationPhotoLookup('济南',undefined,{loadSources:async()=>inputs,loadAssignments:async()=>library.tables.independent_photo_assignments,
    adoption:{adoptUnsplash:async()=>false},enqueue:async()=>{queued++;}});
  const mediaNames=['老商埠','经三路','VILLASHAKA','BLUEDUCK骨董屋'],oldLookup=lookup(),oldMedia=[];
  for(const name of mediaNames)oldMedia.push(await oldLookup(name));
  const beforeEnqueues=queued;assert.equal(beforeEnqueues,2);queued=0;
  const execute=(kind:string)=>promisify(execFile)(process.execPath,['--import','tsx',
    fileURLToPath(new URL(`../../../../apps/server/scripts/seed-xhs-${kind}.ts`,import.meta.url)),
    fileURLToPath(new URL(`xhs-${kind==='places'?'places':'place-relations'}-济南.json`,folder))],{env:process.env,windowsHide:true,timeout:60000});
  const client=await pool.connect();
  try {
    const before=await captureIdentityImport(client,'济南');
    let counts,evidence;
    for(let round=0;round<2;round++) {
      const startedAt=Date.now();
      await execute('places');
      // 仅内容日期更新，来源/图哈希及版本均未变化，原匹配关系仍有效。
      assert.deepEqual(await loadPlaceRelations('济南'),relationsBefore);
      await execute('relations');
      const after=await captureIdentityImport(client,'济南');
      counts=verifyContentDates(before.places,after.places,places.places,baseline.changes);
      evidence=verifyEvidenceRefresh(before.evidence,after.evidence,places.places,startedAt,Date.now());
      assert.deepEqual(after.independentPhotos,before.independentPhotos);
      assert.deepEqual(await loadCityPlaceFacts('济南'),factsBefore);
      assert.deepEqual(await loadPlaceRelations('济南'),relationsBefore);
    }
    const newLookup=lookup(),media=[];
    for(let i=0;i<mediaNames.length;i++) {
      const result=await newLookup(mediaNames[i]!);assert.deepEqual(result,oldMedia[i]);
      assert.equal(result?.photos?.length??0,[3,1,0,0][i]);
      media.push({name:mediaNames[i],count:result?.photos?.length??0,digest:photoIdentityDigest(result)});
    }
    assert.equal(queued,beforeEnqueues);
    const audits=(await client.query('SELECT id FROM place_identity_imports WHERE city=$1 ORDER BY created_at DESC',['济南'])).rows;
    assert.ok(audits.length>=1&&audits.length<=4);
    await client.query('BEGIN');
    for(const audit of audits)await rollbackIdentityImport(client,audit.id,true);
    assert.deepEqual(await captureIdentityImport(client,'济南'),before);await client.query('COMMIT');
    const report={metadataRun:1,isolated:true,synthetic:false,counts,evidence,actualPlaceFactsPreserved:true,evidenceContentPreserved:true,
      matchingRelationsUsableThroughout:true,independentAssignmentsPreserved:9,repeatImport:true,reverseRollback:true,
      auditRows:audits.length,media,mockEnqueueCalls:{before:beforeEnqueues,after:queued},actualEnqueues:0,imageComparison:'deferred_by_user',failures:[]};
    await writeFile(new URL(`consumption-${Date.now()}.json`,folder),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
  }finally{await client.query('ROLLBACK');client.release();}
});
