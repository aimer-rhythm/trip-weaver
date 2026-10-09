// 只读提取已选提及的原笔记正文，供逐项判断分店、入口和观景层；不取作者及原始接口数据。
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from 'pg';
import {parse} from 'dotenv';
import assert from 'node:assert/strict';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../../../../..');
const [filename,...values]=process.argv.slice(2);
assert.match(filename ?? '',/^[a-z0-9-]+\.json$/);
const target=path.join(here,filename);
assert.ok(!fs.existsSync(target),'冻结原文不覆盖；采用新文件名');
const ids=values.flatMap(v=>v.split(','));
assert.ok(ids.length && ids.every(v=>/^\d+$/.test(v)));
const env=parse(fs.readFileSync(path.resolve(root,'../xhs-travel-pipeline/.env')));
const db=new Client({connectionString:env.DATABASE_URL.replace('postgresql+asyncpg:','postgresql:'),connectionTimeoutMillis:10000});
await db.connect();
try {
  await db.query('BEGIN READ ONLY');
  const rows=(await db.query(`SELECT m.id mention_id,m.name,m.evidence_text,n.id note_id,n.title,n.desc,n.source_url,n.img_analysis
    FROM place_mention m JOIN raw_note n ON n.id=m.raw_note_id WHERE m.id=ANY($1::bigint[]) ORDER BY m.id`,[ids])).rows;
  assert.equal(rows.length,new Set(ids).size,'部分原文不存在');
  for(const row of rows) if(row.source_url) {const url=new URL(row.source_url);url.search='';row.source_url=url.href;}
  fs.writeFileSync(target,JSON.stringify(rows,null,2)+'\n');
  console.log(JSON.stringify({file:filename,mentions:rows.map(row=>({id:row.mention_id,name:row.name,characters:row.desc?.length ?? 0}))}));
} finally {await db.query('ROLLBACK');await db.end();}
