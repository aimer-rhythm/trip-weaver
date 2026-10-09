// 冻结重庆缺失精确匹配、分店限定和组合范围的原始提及，只读业务库。
import fs from 'node:fs';
import {Client} from 'pg';
import {parse} from 'dotenv';
import assert from 'node:assert/strict';
const base=new URL('./',import.meta.url);
const target=new URL('chongqing-batch14-variant-context.json',base);
assert.ok(!fs.existsSync(target),'冻结证据不能覆盖');
const env=parse(fs.readFileSync(new URL('../../../../../../xhs-travel-pipeline/.env',base)));
const db=new Client({connectionString:env.DATABASE_URL.replace('postgresql+asyncpg:','postgresql:'),connectionTimeoutMillis:10000});
await db.connect();
try {
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const rows=(await db.query(`SELECT m.id mention_id,m.name,m.normalized_name,m.evidence_text,
    n.id note_id,n.title,n.desc,split_part(n.source_url,'?',1) source_url,n.img_analysis
    FROM place_mention m JOIN raw_note n ON n.id=m.raw_note_id
    WHERE n.city=$1 AND m.name ~ $2 ORDER BY m.id`,['重庆','江北国际机场|铜元局|这很山城|临江门|长嘉汇|金刚碑|我爱重庆|范嬢|范孃|北仓'])).rows;
  fs.writeFileSync(target,JSON.stringify(rows,null,2)+'\n');
  console.log(JSON.stringify(rows.map(r=>({id:r.mention_id,name:r.name,normalized:r.normalized_name,note:r.note_id,text:r.evidence_text}))));
} finally {await db.query('ROLLBACK');await db.end();}
