// 只读查找待审主体被名称规范化隐藏的原始提及；匹配只提供线索，不判实体相同。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Client} from 'pg';
import {parse} from 'dotenv';
const base=new URL('./',import.meta.url);
const [filename,auditRun]=process.argv.slice(2);
assert.match(filename ?? '',/^[a-z0-9-]+\.json$/);
assert.match(auditRun ?? '',/^run-\d{2}$/);
const target=new URL(filename,base);assert.ok(!fs.existsSync(target),'冻结证据不能覆盖');
const auditFile=`audit/${auditRun}/snapshot.json`,bytes=fs.readFileSync(new URL(auditFile,base));
const audit=JSON.parse(bytes);assert.equal(audit.readOnly,true);
const entities=new Map(audit.entities.map(e=>[e.entity_id,e]));
const root=id=>{const seen=new Set();while(entities.get(id)?.redirect_to){assert.ok(!seen.has(id));seen.add(id);id=entities.get(id).redirect_to;}assert.ok(entities.has(id));return id;};
const pendingRoots=new Set(audit.reviews.filter(r=>r.status==='PENDING').flatMap(r=>r.currentEntityIds));
const ids=audit.entities.filter(e=>pendingRoots.has(root(e.entity_id))).map(e=>e.entity_id);
assert.ok(ids.length>0&&ids.length<=1000);
const settings=parse(fs.readFileSync(new URL('../../../../../../xhs-travel-pipeline/.env',base)));
const db=new Client({connectionString:settings.DATABASE_URL.replace('postgresql+asyncpg:','postgresql:'),connectionTimeoutMillis:10000});
await db.connect();
try {
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await db.query("SET LOCAL statement_timeout='20s'");
  const rows=(await db.query(`SELECT em.entity_id,p.id source_place_id,p.name source_place_name,p.city,
    m.id mention_id,m.name,m.normalized_name,m.evidence_text,n.id note_id,n.title,n.desc,
    split_part(n.source_url,'?',1) source_url,n.img_analysis
    FROM place_entity_member em JOIN canonical_place p ON p.id=em.place_id
    JOIN place_mention m ON m.normalized_name=p.normalized_name
    JOIN raw_note n ON n.id=m.raw_note_id AND n.city=p.city
    WHERE em.entity_id=ANY($1::text[]) AND m.name<>p.name
    ORDER BY p.city,p.id,m.id`,[ids])).rows;
  for(const row of rows) row.current_entity_id=root(row.entity_id);
  const result={capturedAt:new Date().toISOString(),readOnly:true,
    candidateMeaning:'same_normalized_name_only_requires_individual_source_review',
    auditFile,auditSha256:createHash('sha256').update(bytes).digest('hex'),rows};
  fs.writeFileSync(target,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({file:filename,rows:rows.length,notes:new Set(rows.map(r=>r.note_id)).size,
    byCity:[...new Set(rows.map(r=>r.city))].map(city=>({city,mentions:rows.filter(r=>r.city===city).length})),
    variants:rows.map(r=>({city:r.city,source:r.source_place_name,name:r.name,mention:r.mention_id,note:r.note_id}))}));
} finally {try{await db.query('ROLLBACK');}finally{await db.end();}}
