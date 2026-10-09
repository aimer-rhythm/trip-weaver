// 只读冻结第69批后的成都实库，供实际消费预演；不运行迁移或业务写入。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Client} from 'pg';
import {parse} from 'dotenv';
const url=p=>new URL(p,import.meta.url),read=p=>JSON.parse(fs.readFileSync(url(p),'utf8'));
const folder='priority-cities/成都/wuhou-jinli-before-01/',pointer=read('cleaning-scope/current.json');
assert.equal(pointer.latestAppliedEntityBatch,69);assert.deepEqual(pointer.pendingVerification,[]);assert.equal(pointer.userAcceptance,false);
assert.equal(pointer.imageComparisonPolicy.status,'deferred_by_user');assert.ok(!fs.existsSync(url(folder)));
const db=new Client({connectionString:parse(fs.readFileSync('apps/server/.env')).DATABASE_URL,connectionTimeoutMillis:10000});
const tables={};let trips;
try{
  await db.connect();await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await db.query("SET LOCAL statement_timeout='30s'");
  for(const name of ['canonical_places','research_evidence','place_relation','data_import','independent_photo_assignments','place_relation_snapshots'])
    tables[name]=(await db.query(`SELECT to_jsonb(t) value FROM ${name} t WHERE city=$1 ORDER BY to_jsonb(t)::text`,['成都'])).rows.map(r=>r.value);
  trips=(await db.query("SELECT count(*)::int count,md5(COALESCE(string_agg(h,'' ORDER BY h),'')) digest FROM (SELECT md5(to_jsonb(t)::text) h FROM trips t) x")).rows[0];
}finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
assert.equal(tables.canonical_places.length,411);assert.deepEqual(trips,{count:201,digest:'e01d67cbf42a62fc595f4ef052f99e75'});
const snapshot=tables.place_relation_snapshots[0];assert.equal(snapshot.manifest.revision,9);assert.equal(snapshot.relations.length,49);
for(const name of ['武侯祠','锦里'])assert.equal(tables.canonical_places.find(p=>p.name===name).payload.identity.revision,1);
const capturedAt=new Date().toISOString(),library=JSON.stringify({readOnly:true,city:'成都',capturedAt,tables,trips})+'\n';
const state={readOnly:true,entityBatch:69,capturedAt,libraryHash:createHash('sha256').update(library).digest('hex'),
  counts:Object.fromEntries(Object.entries(tables).map(([k,v])=>[k,v.length])),sourceRevision:9,trips,imageComparison:'deferred_by_user'};
fs.mkdirSync(url(folder));fs.writeFileSync(url(folder+'library-before.json'),library,{flag:'wx'});
for(const name of ['xhs-places-成都.json','xhs-place-relations-成都.json'])fs.copyFileSync(url('all-cities/batch-69/sync-01/'+name),url(folder+name),fs.constants.COPYFILE_EXCL);
fs.writeFileSync(url(folder+'state.json'),JSON.stringify(state,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(state));
