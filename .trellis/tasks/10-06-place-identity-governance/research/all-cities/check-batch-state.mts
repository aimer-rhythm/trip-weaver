// 实库只读前置核对/应用后核对；行程仅计算聚合摘要，不输出内容或图库URL。
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { Client } from 'pg';
import { parse } from 'dotenv';
import { validateBatchName, validateStrictMediaPreview } from './sync-contract.mjs';
import { currentBoundRelations, validateBoundRelations, validateRelationManifest } from '../../../../../apps/server/src/services/placeRelationIdentity';
const mode=process.argv[2];assert.ok(mode==='before'||mode==='after');
const auditBaseline=process.argv.includes('--audit-baseline');
assert.ok(!auditBaseline||mode==='after','事务审计补证仅用于事后检查');
const batch=validateBatchName(process.argv[3]);
const attempt=process.argv[4]?.startsWith('sync-')?process.argv[4]:'sync-01';assert.match(attempt,/^sync-\d{2}$/);
const folder=new URL(`./${batch}/${attempt}/`,import.meta.url);
const read=async(file:URL)=>JSON.parse(await readFile(file,'utf8'));
const decisions=await read(new URL(`./${batch}-decisions.json`,import.meta.url));
const scopes=await read(new URL(`./${batch}-scope-decisions.json`,import.meta.url)).catch((error:NodeJS.ErrnoException)=>{
  if(error.code==='ENOENT') return [];
  throw error;
});
const sync=await read(new URL('sync-state.json',folder));
const config=parse(await readFile('apps/server/.env'));
const client=new Client({connectionString:config.DATABASE_URL,connectionTimeoutMillis:10000});
const reports:unknown[]=[];
try {
  await client.connect();await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const trips=(await client.query(`SELECT count(*)::int count,md5(COALESCE(string_agg(h,'' ORDER BY h),'')) digest
    FROM (SELECT md5(to_jsonb(t)::text) h FROM trips t) x`)).rows[0];
  if(mode==='after') {
    const baseline=await read(new URL(auditBaseline?'import-audit-baseline.json':'pre-import-check.json',folder));
    if(auditBaseline)assert.equal(baseline.importBeforeStateEqualsFrozenLibrary,true);
    assert.deepEqual(trips,baseline.trips);
  }
  for(const city of Object.keys(sync.cities)) {
    const fixture=new URL(`preview-${city}/`,folder),state=await read(new URL('state.json',fixture));
    const bytes=await readFile(new URL('library-before.json',fixture));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),state.libraryHash);
    const library=JSON.parse(bytes.toString('utf8'));
    if(mode==='before') {
      const reports=(await readdir(fixture)).filter(name=>/^preview-\d+\.json$/.test(name));
      assert.equal(reports.length,1,'必须有且仅有本次成功预演报告');
      validateStrictMediaPreview(await read(new URL(reports[0]!,fixture)),state);
    }
    const tables:Record<string,any[]>={};
    for(const table of ['canonical_places','research_evidence','place_relation','data_import','independent_photo_assignments','place_relation_snapshots']) {
      tables[table]=(await client.query(`SELECT to_jsonb(t) value FROM ${table} t WHERE city=$1 ORDER BY to_jsonb(t)::text`,[city])).rows.map(r=>r.value);
      if(mode==='before') assert.deepEqual(tables[table],library.tables[table],`${city}/${table}偏离预演冻结`);
    }
    if(mode==='before'){reports.push({city,unchangedSincePreview:true});continue;}
    assert.ok(sync.cities[city].importedAt&&sync.cities[city].relationsImportedAt);
    const rows=tables.canonical_places!,byId=new Map(rows.map(row=>[row.id,row]));
    const exported=await read(new URL(`xhs-places-${city}.json`,folder));
    let governedScores=0;
    for(const place of exported.places) if(place.payload?.recommendationIdentity) {
      const live=byId.get(place.id);assert.ok(live);
      for(const field of ['recommendationIdentity','recommendScore','mentionCount'])
        assert.deepEqual(live.payload?.[field],place.payload[field],`已治理分数未实际落库：${place.id}/${field}`);
      governedScores++;
    }
    const exportedIds=new Set(exported.places.map((p:any)=>p.id));
    const graph=await read(new URL(`xhs-place-relations-${city}.json`,folder));
    const snapshot=tables.place_relation_snapshots![0];
    assert.deepEqual(snapshot.manifest,exported.relationIdentity);
    assert.deepEqual(snapshot.relations,graph.relations);
    assert.deepEqual([...snapshot.available_ids].sort(),exported.places.filter((p:any)=>p.verified!==false&&!p.payload?.identityWithdrawal).map((p:any)=>p.id).sort());
    const manifest=validateRelationManifest(snapshot.manifest,city);
    const available=new Set(snapshot.available_ids);
    const relations=currentBoundRelations(manifest,validateBoundRelations(snapshot.relations,manifest),rows.filter(row=>row.verified&&available.has(row.id)));
    assert.equal(relations.length,graph.relations.filter((r:any)=>r.strength==='direct').length);
    assert.deepEqual(tables.independent_photo_assignments,library.tables.independent_photo_assignments);
    let oldRows=0,photos=0,untouchedRetained=0;
    const claimed=new Set(decisions.filter((d:any)=>d.city===city).flatMap((d:any)=>d.evidence.flatMap((e:any)=>e.legacyId?[e.legacyId]:[])));
    const changedIdentities=new Set<string>(scopes.filter((s:any)=>s.city===city).flatMap((s:any)=>Object.keys(s.expectedRevisions)));
    for(const decision of decisions.filter((d:any)=>d.city===city)) {
      changedIdentities.add(decision.entityId);
      const root=byId.get(decision.entityId);assert.ok(root);
      for(const oldId of decision.mergeEntityIds) {
        changedIdentities.add(oldId);
        if(!byId.has(oldId)) continue; // 未曾导入的旧源由主实体成员声明保留。
        assert.equal(byId.get(oldId)?.payload?.canonicalRedirectTo,decision.entityId,`合并旧行未指向声明主实体：${oldId}`);
        assert.ok(root.payload?.identity?.memberIds.includes(oldId),`主实体遗漏合并旧ID：${oldId}`);
        claimed.add(oldId);
      }
    }
    for(const old of library.tables.canonical_places) {
      const current=byId.get(old.id);assert.ok(current,`旧行丢失：${old.id}`);oldRows++;
      if(!changedIdentities.has(old.id) && !claimed.has(old.id)) {
        assert.deepEqual(current.payload?.identity,old.payload?.identity,`批次外身份被更改：${old.id}`);
        assert.equal(current.payload?.canonicalRedirectTo,old.payload?.canonicalRedirectTo,`批次外重定向被更改：${old.id}`);
      }
      for(const field of ['coverImage','imageGallery','amapPhoto']) {
        if(old.payload?.[field]===undefined) continue;
        assert.ok(isDeepStrictEqual(current.payload?.[field],old.payload[field]),`旧图片字段变化：${old.id}/${field}`);photos++;
      }
      if(!exportedIds.has(old.id)&&!claimed.has(old.id)&&old.verified&&!old.payload?.canonicalRedirectTo&&!old.payload?.identityWithdrawal) {
        assert.ok(isDeepStrictEqual(current,old),`未认领旧行被更改：${old.id}`);untouchedRetained++;
      }
    }
    reports.push({city,sourceRevision:manifest.revision,graph:graph.relations.length,strongUsable:relations.length,
      oldRowsPreserved:oldRows,photoFieldsPreserved:photos,independentPhotos:tables.independent_photo_assignments!.length,untouchedRetained,governedScores});
  }
  const report={readOnly:true,mode,at:new Date().toISOString(),trips,cities:reports,failures:[]};
  await writeFile(new URL(mode==='before'?'pre-import-check.json':`post-import-check-${Date.now()}.json`,folder),JSON.stringify(report,null,2),{flag:'wx'});
  console.log(JSON.stringify(report));
}finally{await client.query('ROLLBACK').catch(()=>{});await client.end();}
