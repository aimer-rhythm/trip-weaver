import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
assert.match(process.env.DATABASE_URL??'',/127\.0\.0\.1:18798\/place_identity_test_\d+$/);
const {pool}=await import('../../../../apps/server/src/db/client');
const {loadCityPlaceFacts}=await import('../../../../apps/server/src/generation/scheduling/placeFacts');
const {captureIdentityImport,rollbackIdentityImport}=await import('../../../../apps/server/src/services/placeIdentityAudit');
const {createPlaceRetriever}=await import('../../../../apps/server/src/generation/placeRetrieval');
after(()=>pool.end());

test('真实上游导出经双导入保留完整作者警告、停留和身份，移除不残留且可逆',async()=>{
  assert.ok(process.env.NOTE_WARNING_FLOW_FIXTURE,'必须指定本次通过的上游导出');
  const folder=new URL(process.env.NOTE_WARNING_FLOW_FIXTURE,import.meta.url);
  const read=async(p:string)=>JSON.parse(await readFile(new URL(p,folder),'utf8'));
  const report=await read('report.json');assert.deepEqual(report.failures,[]);assert.ok(report.actualExport&&report.reverseRollback);
  const {city,entityId,quote}=report;
  const execute=(label:string,kind:'places'|'relations')=>promisify(execFile)(process.execPath,['--import','tsx',
    fileURLToPath(new URL(`../../../../apps/server/scripts/seed-xhs-${kind}.ts`,import.meta.url)),
    fileURLToPath(new URL(`xhs-${kind==='relations'?'place-relations':'places'}-${label}.json`,folder))],
    {env:process.env,windowsHide:true,timeout:30000});
  const db=await pool.connect();
  try {
    const baseline=await captureIdentityImport(db,city);
    for(const label of ['before','with-warning'])for(const kind of ['places','relations'] as const)await execute(label,kind);
    const place=()=>db.query('SELECT id,city,name,category,source,verified,payload FROM canonical_places WHERE id=$1',[entityId]).then(r=>r.rows[0]);
    const warnings=()=>db.query("SELECT content FROM research_evidence WHERE place_id=$1 AND kind='xhs_warning'",[entityId]).then(r=>r.rows.map(v=>v.content));
    const p=await place();assert.equal(p.verified,true);assert.equal(p.payload.identity.entityId,entityId);
    assert.deepEqual(p.payload.tips,[quote]);assert.equal(p.payload.mentionSources.length,1);assert.equal(p.payload.mentionCount,1);
    assert.deepEqual(await warnings(),[quote]);assert.doesNotMatch(p.payload.content.intro,/又贵|乙馆|接水/);
    assert.equal(p.payload.openHours.status,'unknown');assert.equal(p.payload.reservation,'unknown');assert.equal(p.payload.typicalVisitMinutes,30);
    assert.equal((await loadCityPlaceFacts(city)).get('甲街')?.visitMinutes,30);
    const retrieve=createPlaceRetriever({query:(sql,args)=>db.query(sql,args),embed:async()=>null});
    assert.equal((await retrieve(['甲街'],{city,vector:'off',limit:8}))[0]?.canonicalPlaceId,entityId);
    const manifest=(await db.query('SELECT manifest FROM place_relation_snapshots WHERE city=$1',[city])).rows[0].manifest;
    assert.equal(manifest.sourceState.supplementalSources.length,1);assert.equal(manifest.sourceState.mentions.length,1);
    const stable=await captureIdentityImport(db,city);
    for(const kind of ['places','relations'] as const)await execute('with-warning',kind);
    const business=(s:Awaited<ReturnType<typeof captureIdentityImport>>)=>({...s,
      evidence:s.evidence.map(({fetched_at:_t,...r})=>r),imports:s.imports.map(({imported_at:_t,...r})=>r),
      relationImports:s.relationImports?.map(({imported_at:_t,...r})=>r)});
    assert.deepEqual(business(await captureIdentityImport(db,city)),business(stable));
    for(const kind of ['places','relations'] as const)await execute('removed-warning',kind);
    assert.equal((await place()).payload.tips,undefined);assert.deepEqual(await warnings(),[]);
    assert.equal((await loadCityPlaceFacts(city)).get('甲街')?.visitMinutes,30);
    await assert.rejects(execute('with-warning','places'),/版本回退|旧|快照/);
    const audits=(await db.query('SELECT id FROM place_identity_imports WHERE city=$1 ORDER BY created_at DESC,id DESC',[city])).rows;
    await db.query('BEGIN');for(const a of audits)await rollbackIdentityImport(db,a.id,true);
    assert.deepEqual(await captureIdentityImport(db,city),baseline);await db.query('COMMIT');
    await writeFile(new URL(`downstream-verification-${Date.now()}.json`,folder),JSON.stringify({city,entityId,actualDualImport:true,
      authorWarningPreserved:true,otherFactsExcluded:true,warningRemovalAuthoritative:true,visitMinutesPreserved:30,sqlIdentity:true,
      oldVersionRejected:true,idempotent:true,reverseRollback:true,failures:[]},null,2),{flag:'wx'});
  }finally{await db.query('ROLLBACK');db.release();}
});
