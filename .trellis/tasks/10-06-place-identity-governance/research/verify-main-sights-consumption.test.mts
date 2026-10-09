import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
assert.match(process.env.DATABASE_URL??'',/127\.0\.0\.1:18798\/place_identity_test_\d+$/);
const {pool}=await import('../../../../apps/server/src/db/client');
const {loadCityPlaceFacts}=await import('../../../../apps/server/src/generation/scheduling/placeFacts');
after(()=>pool.end());
test('第43批真实完整城市双导入后事实读取黑虎泉50分钟、千佛山未知，原景区身份与有效看点保留',async()=>{
  const folder=new URL('all-cities/batch-43/sync-01/',import.meta.url);
  const read=async(p:string)=>JSON.parse(await readFile(new URL(p,folder),'utf8'));
  const sync=(await read('sync-state.json')).cities['济南'];assert.ok(sync.importedAt&&sync.relationsImportedAt);
  const bytes=await readFile(new URL('preview-济南/library-before.json',folder));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),(await read('preview-济南/state.json')).libraryHash);
  const library=JSON.parse(bytes.toString('utf8'));
  const exportBytes=await readFile(new URL('xhs-places-济南.json',folder));assert.equal(createHash('sha256').update(exportBytes).digest('hex'),sync.exportHash);
  for(const table of ['canonical_places','research_evidence','place_relation','data_import','independent_photo_assignments','place_relation_snapshots'])
    await pool.query(`INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(NULL::${table},$1::jsonb)`,[JSON.stringify(library.tables[table])]);
  const before=await loadCityPlaceFacts('济南');assert.equal(before.get('黑虎泉')?.visitMinutes,60);assert.equal(before.get('千佛山')?.visitMinutes,30);
  for(const kind of ['places','relations'])await promisify(execFile)(process.execPath,['--import','tsx',
    fileURLToPath(new URL(`../../../../apps/server/scripts/seed-xhs-${kind}.ts`,import.meta.url)),
    fileURLToPath(new URL(`xhs-${kind==='places'?'places':'place-relations'}-济南.json`,folder))],{env:process.env,windowsHide:true,timeout:60000});
  const facts=await loadCityPlaceFacts('济南');
  for(const [name,id,minutes,count] of [['黑虎泉','136719df189e0dd70cd34be75f6faef4',50,36],['千佛山','290bf0287b4fc3936cb552acd37abca4',undefined,10]] as const) {
    const p=facts.get(name);assert.ok(p);assert.equal(p.canonicalPlaceId,id);assert.equal(p.visitMinutes,minutes);
    assert.equal(p.category,'自然');assert.equal(p.mentionCount,count);assert.deepEqual(p.aliases,[name]);
    assert.equal(p.lat,before.get(name)?.lat);assert.equal(p.lng,before.get(name)?.lng);
    const row=(await pool.query('SELECT payload FROM canonical_places WHERE id=$1',[id])).rows[0];
    assert.equal(row.payload.reservation,'unknown');assert.deepEqual(row.payload.reservationEvidence,[]);
    assert.equal(row.payload.mentionSources.length,count);
  }
  assert.equal(facts.get('大明湖')?.visitMinutes,120);assert.equal(facts.get('尚泉尚水茶馆前平台')?.placeType,'photo_spot');
  for(const name of ['灵岩寺','王府池子','腾蛟泉','起凤泉','刘氏泉'])assert.equal(facts.get(name)?.visitMinutes,undefined);
  const report={batch:43,isolated:true,synthetic:false,fullCityPlaces:JSON.parse(exportBytes.toString('utf8')).places.length,
    beforeMinutes:{黑虎泉:60,千佛山:30},afterMinutes:{黑虎泉:50,千佛山:null},actualPlaceFacts:true,
    reservationPolicyUnknown:true,priorDaminghuPlatformAndSpringFactsPreserved:true,imageComparison:'deferred_by_user',failures:[]};
  await writeFile(new URL(`main-sights-consumption-${Date.now()}.json`,folder),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
});
