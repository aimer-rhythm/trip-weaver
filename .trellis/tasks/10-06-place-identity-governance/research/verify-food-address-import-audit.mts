// 前置检查参数顺序错误的补证：核对导入事务保存的真实before_state，不伪造前置检查成功。
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Client} from 'pg';
import {parse} from 'dotenv';
const read=async(p:string)=>JSON.parse(await readFile(new URL(p,import.meta.url),'utf8'));
const folder='all-cities/batch-51/sync-01/';
const state=(await read(folder+'sync-state.json')).cities['济南'];
const bytes=await readFile(new URL(folder+'preview-济南/library-before.json',import.meta.url));
assert.equal(createHash('sha256').update(bytes).digest('hex'),(await read(folder+'preview-济南/state.json')).libraryHash);
const library=JSON.parse(bytes.toString('utf8'));
const baseline=await read('metadata/content-dates-01/sync-01/live-check.json');
const db=new Client({connectionString:parse(await readFile('apps/server/.env')).DATABASE_URL,connectionTimeoutMillis:10000});
const sorted=(rows:any[])=>[...rows].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
interface EvidenceRow {id:string;fetched_at:string;[key:string]:unknown;}
try {
  await db.connect();await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const audits=(await db.query('SELECT id,created_at,before_state,after_state FROM place_identity_imports WHERE city=$1 AND content_hash=$2 AND rolled_back_at IS NULL ORDER BY created_at', ['济南',state.exportHash.slice(0,32)])).rows;
  assert.equal(audits.length,1);const audit=audits[0];
  const pairs=[['places','canonical_places'],['evidence','research_evidence'],['relations','place_relation'],['independentPhotos','independent_photo_assignments'],['relationSnapshots','place_relation_snapshots']] as const;
  for(const [field,table]of pairs)assert.deepEqual(sorted(audit.before_state[field]),sorted(library.tables[table]),table);
  const importedSources=['xhs_places','xhs_relations'];
  assert.deepEqual(sorted([...audit.before_state.imports,...audit.before_state.relationImports]),sorted(library.tables.data_import.filter((r:any)=>importedSources.includes(r.source))));
  const otherImports=(await db.query('SELECT to_jsonb(t) value FROM data_import t WHERE city=$1 AND NOT(source=ANY($2::text[]))',['济南',importedSources])).rows.map(r=>r.value);
  assert.deepEqual(sorted(otherImports),sorted(library.tables.data_import.filter((r:any)=>!importedSources.includes(r.source))));
  const trips=(await db.query("SELECT count(*)::int count,md5(COALESCE(string_agg(h,'' ORDER BY h),'')) digest FROM (SELECT md5(to_jsonb(t)::text) h FROM trips t) x")).rows[0];
  assert.deepEqual(trips,baseline.trips);
  const current=(await db.query('SELECT to_jsonb(t) value FROM canonical_places t WHERE city=$1',['济南'])).rows.map(r=>r.value);
  let preservedVectors=0;
  for(const old of library.tables.canonical_places){const row=current.find(r=>r.id===old.id);assert.ok(row);assert.deepEqual(row.embedding,old.embedding);assert.equal(row.payload?.embeddedText,old.payload?.embeddedText);if(old.embedding)preservedVectors++;}
  const currentEvidence=(await db.query<{value:EvidenceRow}>('SELECT to_jsonb(t) value FROM research_evidence t WHERE city=$1',['济南'])).rows.map(r=>r.value);
  const importedEvidence=new Map<string,EvidenceRow>(audit.after_state.evidence.map((r:EvidenceRow)=>[r.id,r]));
  assert.equal(currentEvidence.length,library.tables.research_evidence.length);let refreshed=0;
  for(const old of library.tables.research_evidence) {
    const row=currentEvidence.find(r=>r.id===old.id);assert.ok(row);assert.deepEqual(row,importedEvidence.get(row.id));
    const expected=structuredClone(old);
    if(row.fetched_at!==old.fetched_at){assert.ok(Date.parse(row.fetched_at)>=Date.parse(library.capturedAt));assert.ok(Date.parse(row.fetched_at)<=Date.parse(state.importedAt));expected.fetched_at=row.fetched_at;refreshed++;}
    assert.deepEqual(row,expected);
  }
  const report={batch:51,readOnly:true,at:new Date().toISOString(),preflightSucceeded:false,
    incident:'前置检查误用batch/mode参数顺序，失败后编排仍继续导入；本记录是事后事务审计补证，不是前置成功证明。',
    auditId:audit.id,importBeforeStateEqualsFrozenLibrary:true,tablesVerified:6,
    auditBoundary:'事务前快照覆盖5个整城表及地点/关系导入记录；其他导入记录以现状与冻结值逐项核验。',otherImportRowsPreserved:otherImports.length,
    tripBaseline:'metadata/content-dates-01/sync-01/live-check.json',trips,preservedVectors,evidenceContentsPreserved:currentEvidence.length,evidenceFetchTimesRefreshed:refreshed,
    failures:[]};
  await writeFile(new URL(folder+'import-audit-baseline.json',import.meta.url),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
}finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
