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
test('第44批真实城市双导入读取独立有效时长，曲水亭别名及旧治理事实保持',async()=>{
  const folder=new URL('all-cities/batch-44/sync-01/',import.meta.url);
  const read=async(p:string)=>JSON.parse(await readFile(new URL(p,folder),'utf8'));
  const sync=(await read('sync-state.json')).cities['济南'];assert.ok(sync.importedAt&&sync.relationsImportedAt);
  const bytes=await readFile(new URL('preview-济南/library-before.json',folder));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),(await read('preview-济南/state.json')).libraryHash);
  const library=JSON.parse(bytes.toString('utf8'));
  const exportBytes=await readFile(new URL('xhs-places-济南.json',folder));assert.equal(createHash('sha256').update(exportBytes).digest('hex'),sync.exportHash);
  for(const table of ['canonical_places','research_evidence','place_relation','data_import','independent_photo_assignments','place_relation_snapshots'])
    await pool.query(`INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(NULL::${table},$1::jsonb)`,[JSON.stringify(library.tables[table])]);
  const before=await loadCityPlaceFacts('济南');
  assert.equal(before.get('解放阁')?.visitMinutes,30);assert.equal(before.get('曲水亭街')?.visitMinutes,360);assert.equal(before.get('百花洲')?.visitMinutes,60);
  for(const kind of ['places','relations'])await promisify(execFile)(process.execPath,['--import','tsx',
    fileURLToPath(new URL(`../../../../apps/server/scripts/seed-xhs-${kind}.ts`,import.meta.url)),
    fileURLToPath(new URL(`xhs-${kind==='places'?'places':'place-relations'}-济南.json`,folder))],{env:process.env,windowsHide:true,timeout:60000});
  const facts=await loadCityPlaceFacts('济南');
  for(const [name,id,minutes,count,aliases] of [
    ['解放阁','15ad3a8280476165635672cb0e43117a',30,34,['解放阁']],
    ['曲水亭街','c9c9ce7c33c95b71b859f0ab30bf7136',50,44,['曲水亭','曲水亭街']],
    ['百花洲','b58d15060ff3828b071f950487e487db',undefined,12,['百花洲']],
  ] as const) {
    const p=facts.get(name);assert.ok(p);assert.equal(p.canonicalPlaceId,id);assert.equal(p.visitMinutes,minutes);
    assert.equal(p.category,'文化');assert.equal(p.mentionCount,count);assert.deepEqual(p.aliases,aliases);
    assert.equal(p.lat,before.get(name)?.lat);assert.equal(p.lng,before.get(name)?.lng);
    const row=(await pool.query('SELECT payload FROM canonical_places WHERE id=$1',[id])).rows[0];
    assert.equal(row.payload.mentionSources.length,count);
  }
  assert.equal(facts.get('曲水亭')?.canonicalPlaceId,'c9c9ce7c33c95b71b859f0ab30bf7136');
  for(const [name,minutes] of [['大明湖',120],['黑虎泉',50],['五龙潭公园',60],['趵突泉公园',120],['泉城广场',30]] as const)
    assert.equal(facts.get(name)?.visitMinutes,minutes);
  assert.equal(facts.get('尚泉尚水茶馆前平台')?.placeType,'photo_spot');
  for(const name of ['千佛山','灵岩寺','王府池子','腾蛟泉','起凤泉','刘氏泉'])assert.equal(facts.get(name)?.visitMinutes,undefined);
  const report={batch:44,isolated:true,synthetic:false,fullCityPlaces:JSON.parse(exportBytes.toString('utf8')).places.length,
    beforeMinutes:{解放阁:30,曲水亭街:360,百花洲:60},afterMinutes:{解放阁:30,曲水亭街:50,百花洲:null},actualPlaceFacts:true,
    aliasesPreserved:true,priorGovernedFactsPreserved:true,imageComparison:'deferred_by_user',failures:[]};
  await writeFile(new URL(`shared-routes-consumption-${Date.now()}.json`,folder),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
});
