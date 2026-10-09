// 只读核查短名单中的明确类型异常/外市来源；原文原行不变。
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Client} from 'pg';
import {parse} from 'dotenv';
const root=new URL('./',import.meta.url),folder=new URL('cleaning-scope/run-1791371057197/',root);
const input=JSON.parse(await readFile(new URL('input.json',folder),'utf8'));
const names=['天棒老火锅（老店）','绍友老火锅','王胖娃面','唐红英火锅（临江门店）','秋孃孃火锅',
  '惠火锅（解放碑店）','秋姐三样菜','烤匠麻辣烤鱼（观音桥大融城店）','莲藕抄手','李若桃','一只酸奶牛','孔二火锅',
  '山东大厦','北海公园','什刹海','雍和宫'];
const selected=input.sources.filter(s=>(s.city==='重庆'&&names.includes(s.name))
  ||(s.city==='济南'&&s.name==='山东大厦')||(s.city==='成都'&&['北海公园','什刹海','雍和宫'].includes(s.name)));
const config=parse(await readFile('../xhs-travel-pipeline/.env'));
const db=new Client({connectionString:config.DATABASE_URL.replace('postgresql+asyncpg:','postgresql:'),connectionTimeoutMillis:10000});
try{
  await db.connect();await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await db.query("SET LOCAL statement_timeout='30s'");
  const all=(await db.query(`SELECT m.*,n.city note_city FROM place_mention m JOIN raw_note n ON n.id=m.raw_note_id
    WHERE n.city=ANY($1::text[]) ORDER BY m.id`,[[...new Set(selected.map(s=>s.city))]])).rows;
  const pairs=selected.map(s=>({source:s,mentions:all.filter(m=>m.note_city===s.city&&[s.name,s.normalized_name].some(n=>n===m.name||n===m.normalized_name))}));
  const noteIds=[...new Set(pairs.flatMap(p=>p.mentions.map(m=>m.raw_note_id)))];
  const notes=(await db.query('SELECT id,city,title,"desc",status FROM raw_note WHERE id=ANY($1::bigint[]) ORDER BY id',[noteIds])).rows;
  const contaminatedNoteIds=notes.filter(n=>n.city==='成都'&&/北京/.test(`${n.title}\n${n.desc}`)).map(n=>n.id);
  const relatedMentions=all.filter(m=>contaminatedNoteIds.includes(m.raw_note_id));
  const relatedSources=input.sources.filter(s=>s.city==='成都'&&relatedMentions.some(m=>[s.name,s.normalized_name].some(n=>n===m.name||n===m.normalized_name)));
  const output={readOnly:true,capturedAt:new Date().toISOString(),pairs,notes,relatedMentions,relatedSources};
  const bytes=JSON.stringify(output,null,2)+'\n';
  await writeFile(new URL('priority-evidence-01.json',folder),bytes,{flag:'wx'});
  console.log(JSON.stringify({sources:pairs.length,notes:notes.length,relatedMentions:relatedMentions.length,
    relatedSources:relatedSources.length,sha256:createHash('sha256').update(bytes).digest('hex'),
    noteHeads:notes.map(n=>({id:n.id,city:n.city,title:n.title}))},null,2));
}finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
