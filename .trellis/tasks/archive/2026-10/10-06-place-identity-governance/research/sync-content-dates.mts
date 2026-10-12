// 已预演的日期元数据双导入；无实体决定，单独登记，不冒充新实体批次。
import assert from 'node:assert/strict';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {Client} from 'pg';
import {parse} from 'dotenv';
import {createPlaceIdentityIndex,placeNames} from '../../../../apps/server/src/lib/placeIdentity';
import {placeEmbeddingText} from '../../../../apps/server/src/lib/placeEmbeddingText';
import {verifyContentDates,verifyEvidenceRefresh} from './content-dates-contract.mjs';
const mode=process.argv[2];assert.ok(['before','import','check'].includes(mode!));
const folder=new URL('metadata/content-dates-01/sync-01/',import.meta.url);
const read=async(p:string)=>JSON.parse(await readFile(new URL(p,folder),'utf8'));
const state=await read('state.json'),config=parse(await readFile('apps/server/.env'));
const client=new Client({connectionString:config.DATABASE_URL,connectionTimeoutMillis:10000});
const tables=['canonical_places','research_evidence','place_relation','data_import','independent_photo_assignments','place_relation_snapshots'];
const documents:any={};
for(const [name,key]of [['library-before.json','libraryHash'],['xhs-places-济南.json','placesHash'],['xhs-place-relations-济南.json','relationsHash']]) {
  const bytes=await readFile(new URL(name!,folder));assert.equal(createHash('sha256').update(bytes).digest('hex'),state[key!]);documents[name!]=JSON.parse(bytes.toString());
}
const library=documents['library-before.json'],exported=documents['xhs-places-济南.json'],graph=documents['xhs-place-relations-济南.json'];
assert.equal(state.sourceRevision,24);assert.deepEqual(graph.relationIdentity,library.tables.place_relation_snapshots[0].manifest);
assert.deepEqual(graph.relations,library.tables.place_relation_snapshots[0].relations);
const preview=await read('../preview/report.json');assert.deepEqual(preview.failures,[]);
const save=()=>writeFile(new URL('state.json',folder),JSON.stringify(state,null,2)+'\n');
const snapshot=async()=>{
  const data:any={};
  for(const table of tables)data[table]=(await client.query(`SELECT to_jsonb(t) value FROM ${table} t WHERE city=$1 ORDER BY to_jsonb(t)::text`,['济南'])).rows.map(r=>r.value);
  return data;
};
const trips=async()=>(await client.query("SELECT count(*)::int count,md5(COALESCE(string_agg(h,'' ORDER BY h),'')) digest FROM (SELECT md5(to_jsonb(t)::text) h FROM trips t) x")).rows[0];
try {
  await client.connect();await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  if(mode==='before') {
    assert.equal(state.placesImported,false);assert.equal(state.relationsImported,false);
    assert.deepEqual(await snapshot(),library.tables);
    const evidence={readOnly:true,at:new Date().toISOString(),trips:await trips(),frozenTablesMatch:true,failures:[]};
    await writeFile(new URL('pre-import-check.json',folder),JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});
    console.log(JSON.stringify(evidence));
  } else if(mode==='import') {
    assert.equal(state.placesImported,false);assert.equal(state.relationsImported,false);
    const tests=(await readdir(folder)).filter(f=>/^consumption-\d+\.json$/.test(f));assert.equal(tests.length,1);
    const test=await read(tests[0]!);assert.ok(test.repeatImport&&test.reverseRollback);assert.deepEqual(test.failures,[]);
    assert.deepEqual(await snapshot(),library.tables);assert.deepEqual(await trips(),(await read('pre-import-check.json')).trips);
    await client.query('ROLLBACK');state.importStartedAt=new Date().toISOString();await save();
    for(const kind of ['places','relations']) {
      const result=await promisify(execFile)(process.execPath,['--import','tsx',
        fileURLToPath(new URL(`../../../../apps/server/scripts/seed-xhs-${kind}.ts`,import.meta.url)),
        fileURLToPath(new URL(`xhs-${kind==='places'?'places':'place-relations'}-济南.json`,folder))],
      {cwd:'D:/Project/tripweaver/apps/server',env:process.env,windowsHide:true,timeout:60000});
      await writeFile(new URL(`import-${kind}.log`,folder),result.stdout+result.stderr,{flag:'wx'});
      state[kind==='places'?'placesImported':'relationsImported']=true;await save();
    }
    state.importFinishedAt=new Date().toISOString();state.phase='imported';await save();
    console.log(JSON.stringify({metadataRun:1,placesImported:state.placesImported,relationsImported:state.relationsImported}));
  } else {
    assert.ok(state.placesImported&&state.relationsImported);
    const current=await snapshot(),counts=verifyContentDates(library.tables.canonical_places,current.canonical_places,exported.places,preview.changes);
    const evidence=verifyEvidenceRefresh(library.tables.research_evidence,current.research_evidence,exported.places,
      Date.parse(state.importStartedAt),Date.parse(state.importFinishedAt));
    assert.deepEqual(current.independent_photo_assignments,library.tables.independent_photo_assignments);
    assert.deepEqual(current.place_relation,library.tables.place_relation);
    const relation=current.place_relation_snapshots[0];assert.deepEqual(relation.manifest,graph.relationIdentity);assert.deepEqual(relation.relations,graph.relations);
    assert.deepEqual(relation.available_ids,library.tables.place_relation_snapshots[0].available_ids);
    const oldRows=library.tables.canonical_places,currentRows=current.canonical_places;
    const visible=(p:any)=>p.verified||p.payload?.identityWithdrawal;
    const oldIndex=createPlaceIdentityIndex(oldRows.filter(visible)),newIndex=createPlaceIdentityIndex(currentRows.filter(visible));let names=0;
    for(const row of oldRows.filter(visible))for(const name of placeNames(row)) {
      const old=oldIndex.resolve('济南',name,row.id),now=newIndex.resolve('济南',name,row.id);
      assert.equal(now.status,old.status);
      if(old.status==='resolved'&&now.status==='resolved')assert.equal(now.canonicalPlaceId,old.canonicalPlaceId);
      if(old.status==='ambiguous'&&now.status==='ambiguous')assert.deepEqual(now.candidates.map(p=>p.id).sort(),old.candidates.map(p=>p.id).sort());
      names++;
    }
    const eligible=currentRows.filter((p:any)=>p.verified&&!p.payload?.canonicalRedirectTo&&!p.payload?.identityWithdrawal);
    const pending=eligible.filter((p:any)=>!p.embedding||p.payload?.embeddedText!==placeEmbeddingText(p));assert.equal(pending.length,0);
    state.afterTrips=await trips();assert.deepEqual(state.afterTrips,(await read('pre-import-check.json')).trips);
    const report={metadataRun:1,readOnly:true,at:new Date().toISOString(),counts,evidence,namesVerified:names,
      sourceRevision:24,relationCount:graph.relations.length,direct:graph.relations.filter((r:any)=>r.strength==='direct').length,
      relationManifestUnchanged:true,independentAssignments:9,trips:state.afterTrips,eligibleEmbeddings:eligible.length,
      pendingEmbeddings:0,embeddingBackfillNeeded:false,imageComparison:'deferred_by_user',failures:[]};
    await writeFile(new URL('live-check.json',folder),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
    state.phase='verified';state.verifiedAt=report.at;await save();console.log(JSON.stringify(report));
  }
}finally{await client.query('ROLLBACK').catch(()=>{});await client.end();}
