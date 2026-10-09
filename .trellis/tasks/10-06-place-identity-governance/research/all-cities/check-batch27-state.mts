// 实库只读前置核对/应用后核对；行程仅计算聚合摘要，不输出内容或图库URL。
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { Client } from 'pg';
import { parse } from 'dotenv';
import { currentBoundRelations, validateBoundRelations, validateRelationManifest } from '../../../../../apps/server/src/services/placeRelationIdentity';
const mode=process.argv[2];assert.ok(mode==='before'||mode==='after');
const folder=new URL('./batch-27/sync-01/',import.meta.url);
const read=async(file:URL)=>JSON.parse(await readFile(file,'utf8'));
const decisions=await read(new URL('./batch-27-decisions.json',import.meta.url));
const sync=await read(new URL('sync-state.json',folder));
const config=parse(await readFile('apps/server/.env'));
const client=new Client({connectionString:config.DATABASE_URL,connectionTimeoutMillis:10000});
const reports:unknown[]=[];
try {
  await client.connect();await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const trips=(await client.query(`SELECT count(*)::int count,md5(COALESCE(string_agg(h,'' ORDER BY h),'')) digest
    FROM (SELECT md5(to_jsonb(t)::text) h FROM trips t) x`)).rows[0];
  if(mode==='after') assert.deepEqual(trips,(await read(new URL('pre-import-check.json',folder))).trips);
  for(const city of ['北京','成都','重庆']) {
    const fixture=new URL(`preview-${city}/`,folder),state=await read(new URL('state.json',fixture));
    const bytes=await readFile(new URL('library-before.json',fixture));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),state.libraryHash);
    const library=JSON.parse(bytes.toString('utf8'));
    const tables:Record<string,any[]>={};
    for(const table of ['canonical_places','research_evidence','place_relation','data_import','independent_photo_assignments','place_relation_snapshots']) {
      tables[table]=(await client.query(`SELECT to_jsonb(t) value FROM ${table} t WHERE city=$1 ORDER BY to_jsonb(t)::text`,[city])).rows.map(r=>r.value);
      if(mode==='before') assert.deepEqual(tables[table],library.tables[table],`${city}/${table}偏离预演冻结`);
    }
    if(mode==='before'){reports.push({city,unchangedSincePreview:true});continue;}
    assert.ok(sync.cities[city].importedAt&&sync.cities[city].relationsImportedAt);
    const rows=tables.canonical_places!,byId=new Map(rows.map(row=>[row.id,row]));
    const exported=await read(new URL(`xhs-places-${city}.json`,folder));
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
    const claimed=new Set(decisions.filter((d:any)=>d.city===city).map((d:any)=>d.evidence[1].legacyId));
    for(const old of library.tables.canonical_places) {
      const current=byId.get(old.id);assert.ok(current,`旧行丢失：${old.id}`);oldRows++;
      for(const field of ['coverImage','imageGallery','amapPhoto']) {
        if(old.payload?.[field]===undefined) continue;
        assert.ok(isDeepStrictEqual(current.payload?.[field],old.payload[field]),`旧图片字段变化：${old.id}/${field}`);photos++;
      }
      if(!available.has(old.id)&&!claimed.has(old.id)&&old.verified&&!old.payload?.canonicalRedirectTo&&!old.payload?.identityWithdrawal) {
        assert.deepEqual(current,old,`未认领旧行被更改：${old.id}`);untouchedRetained++;
      }
    }
    reports.push({city,sourceRevision:manifest.revision,graph:graph.relations.length,strongUsable:relations.length,
      oldRowsPreserved:oldRows,photoFieldsPreserved:photos,independentPhotos:tables.independent_photo_assignments!.length,untouchedRetained});
  }
  const report={readOnly:true,mode,at:new Date().toISOString(),trips,cities:reports,failures:[]};
  await writeFile(new URL(mode==='before'?'pre-import-check.json':`post-import-check-${Date.now()}.json`,folder),JSON.stringify(report,null,2),{flag:'wx'});
  console.log(JSON.stringify(report));
}finally{await client.query('ROLLBACK').catch(()=>{});await client.end();}
