// 独立pg只读冻结。相似名仅用于查证，不自动输出治理决定。
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Client } from 'pg';
import { parse } from 'dotenv';
import { placeNameKey } from '@tripweaver/shared';

const root = new URL('./', import.meta.url);
const inputFile = new URL('retained-place-identity-1791365043338.json', root);
const inputBytes = await readFile(inputFile);
const input = JSON.parse(inputBytes.toString('utf8')) as {rows:Array<{id:string;city:string;name:string;source:string}>};
const digest = (value:string|Buffer) => createHash('sha256').update(value).digest('hex');
const downConfig = parse(await readFile('apps/server/.env'));
const upConfig = parse(await readFile('../xhs-travel-pipeline/.env'));
const down = new Client({connectionString:downConfig.DATABASE_URL,connectionTimeoutMillis:10000});
const up = new Client({connectionString:upConfig.DATABASE_URL!.replace('postgresql+asyncpg:','postgresql:'),connectionTimeoutMillis:10000});
type Data = Record<string, any>;
const pickActivity = (a:Data) => Object.fromEntries(['id','name','category','lat','lng','coordSource','intro','description','notes','address','durationMinutes','canonicalPlaceId']
  .filter(key=>a[key]!==undefined).map(key=>[key,a[key]]));
const sourceUrl = (raw:string|null) => {try {const url=new URL(raw!);url.search='';url.hash='';return url.toString();}catch{return null;}};
try {
  await down.connect();await up.connect();
  await down.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await up.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await down.query("SET LOCAL statement_timeout='30s'");await up.query("SET LOCAL statement_timeout='30s'");
  const cities=[...new Set(input.rows.map(row=>row.city))];
  const stored=(await down.query(`SELECT id,city,name,category,source,verified,lat,lng,payload->>'caseId' case_id,
    payload->'activity' activity,payload->'identity' identity,payload->'aliases' aliases,payload->>'address' address,
    payload->>'canonicalRedirectTo' redirect,payload->'identityWithdrawal' withdrawal,
    embedding IS NOT NULL has_embedding,payload->>'embeddedText' embedded_text
    FROM canonical_places WHERE id=ANY($1::text[]) ORDER BY city,id`,[input.rows.map(row=>row.id)])).rows;
  const entities=(await up.query(`SELECT entity_id,city,canonical_name,aliases,legacy_ids,revision,status,redirect_to,primary_place_id,overrides
    FROM place_entity WHERE city=ANY($1::text[]) ORDER BY city,entity_id`,[cities])).rows;
  const sources=(await up.query(`SELECT id,city,name,normalized_name,address,latitude,longitude,amap_poi_id,place_type,geo_status,is_active
    FROM canonical_place WHERE city=ANY($1::text[]) ORDER BY city,id`,[cities])).rows;
  const members=(await up.query(`SELECT m.place_id,m.entity_id FROM place_entity_member m
    JOIN place_entity e ON e.entity_id=m.entity_id WHERE e.city=ANY($1::text[]) ORDER BY m.place_id`,[cities])).rows;
  const mentions=(await up.query(`SELECT m.*,n.city FROM place_mention m JOIN raw_note n ON n.id=m.raw_note_id
    WHERE n.city=ANY($1::text[]) ORDER BY m.id`,[cities])).rows;
  const notes=(await up.query(`SELECT id,note_id,city,title,"desc",status,source_url,publish_time
    FROM raw_note WHERE city=ANY($1::text[]) ORDER BY id`,[cities])).rows.map(note=>({...note,source_url:sourceUrl(note.source_url)}));
  const reviews=(await up.query(`SELECT id,city,fingerprint,status,detail FROM place_entity_review
    WHERE city=ANY($1::text[]) ORDER BY id`,[cities])).rows;
  const snapshots:Array<Data>=[];
  for(const file of (await readdir('eval/snapshots')).filter(file=>file.endsWith('.json')).sort()) {
    const bytes=await readFile(`eval/snapshots/${file}`),snapshot=JSON.parse(bytes.toString('utf8'));
    if(!cities.includes(snapshot.trip?.destination)) continue;
    for(const [dayIndex,day] of (snapshot.trip.days??[]).entries()) {
      for(const [activityIndex,activity] of (day.activities??[]).entries()) snapshots.push({file,sha256:digest(bytes),caseId:snapshot.caseId,
        city:snapshot.trip.destination,dayIndex,activityIndex,activity:pickActivity(activity)});
    }
  }
  const usedNotes=new Set<string>();
  const groups=input.rows.map(expected=>{
    const row=stored.find(row=>row.id===expected.id);
    if(!row||row.name!==expected.name||row.city!==expected.city||row.source!==expected.source||!row.verified||row.redirect||row.withdrawal) {
      throw new Error(`冻结目标已变化：${expected.id}`);
    }
    row.activity=row.activity?pickActivity(row.activity):null;
    const stem=(name:string)=>{const key=placeNameKey(name),city=placeNameKey(row.city);return key.startsWith(city)?key.slice(city.length):key;};
    const key=stem(row.name);
    // REVIEW主体也必须纳入；待审状态不表示不存在，不能只搜ACTIVE后宣称无候选。
    const candidates=entities.filter(e=>e.city===row.city&&!e.redirect_to&&['ACTIVE','REVIEW'].includes(e.status)
      && [e.canonical_name,...(e.aliases??[])].some(name=>{
        const other=stem(name);return Math.min(key.length,other.length)>=2&&(key.includes(other)||other.includes(key));
      }));
    // 旧抽取已改写normalized_name时，追溯其源及现行根；这仍只是候选，不能以旧归一结论证明同体。
    const normalizedKeys=new Set(mentions.filter(m=>m.city===row.city&&placeNameKey(m.name)===placeNameKey(row.name))
      .map(m=>placeNameKey(m.normalized_name)));
    const linkedSources=sources.filter(s=>s.city===row.city&&(normalizedKeys.has(placeNameKey(s.name))||normalizedKeys.has(placeNameKey(s.normalized_name))));
    for(const member of members.filter(m=>linkedSources.some(s=>String(s.id)===String(m.place_id)))) {
      let entity=entities.find(e=>e.entity_id===member.entity_id);
      const seen=new Set<string>();
      while(entity?.redirect_to) {
        if(seen.has(entity.entity_id)) throw new Error('上游实体重定向环');
        seen.add(entity.entity_id);entity=entities.find(e=>e.entity_id===entity!.redirect_to);
      }
      if(entity&&!candidates.some(e=>e.entity_id===entity.entity_id)) candidates.push(entity);
    }
    const candidateIds=new Set(candidates.map(e=>e.entity_id));
    const sourceIds=new Set(members.filter(m=>candidateIds.has(m.entity_id)).map(m=>String(m.place_id)));
    candidates.forEach(e=>{if(e.primary_place_id!==null)sourceIds.add(String(e.primary_place_id));});
    const matchingSources=sources.filter(s=>s.city===row.city&&(sourceIds.has(String(s.id))||normalizedKeys.has(placeNameKey(s.normalized_name))
      ||placeNameKey(s.name)===placeNameKey(row.name)||placeNameKey(s.normalized_name)===placeNameKey(row.name)));
    const keys=new Set([row.name,...candidates.flatMap(e=>[e.canonical_name,...(e.aliases??[])]),...matchingSources.flatMap(s=>[s.name,s.normalized_name])].map(placeNameKey));
    const matchingMentions=mentions.filter(m=>m.city===row.city&&(keys.has(placeNameKey(m.name))||keys.has(placeNameKey(m.normalized_name))));
    const mentionNoteIds=new Set(matchingMentions.map(m=>String(m.raw_note_id)));
    const matchedNotes=notes.filter(n=>n.city===row.city&&(mentionNoteIds.has(String(n.id))||`${n.title??''}\n${n.desc??''}`.includes(row.name)));
    matchedNotes.forEach(n=>usedNotes.add(String(n.id)));
    return {stored:row,reviewCandidatesAreEvidence:false,candidates,sources:matchingSources,mentions:matchingMentions,
      noteIds:matchedNotes.map(n=>n.id),literalNoteIds:matchedNotes.filter(n=>`${n.title??''}\n${n.desc??''}`.includes(row.name)).map(n=>n.id),
      goldset:snapshots.filter(s=>s.city===row.city&&s.activity.name===row.name),
      reviews:reviews.filter(r=>r.city===row.city&&(r.detail?.entityIds??[]).some((id:string)=>candidateIds.has(id)))};
  });
  const result={readOnly:true,capturedAt:new Date().toISOString(),input:{file:inputFile.pathname,sha256:digest(inputBytes)},
    groups,notes:notes.filter(n=>usedNotes.has(String(n.id))),
    summary:{rows:groups.length,mentions:new Set(groups.flatMap(g=>g.mentions.map(m=>String(m.id)))).size,notes:usedNotes.size,
      goldsetMatches:groups.filter(g=>g.goldset.length).length,candidateGroups:groups.filter(g=>g.candidates.length).length}};
  const file=new URL(`retained-place-sources-${Date.now()}.json`,root);
  await writeFile(file,JSON.stringify(result,null,2),{flag:'wx'});
  console.log(JSON.stringify({file:file.pathname,...result.summary,groups:groups.map(g=>({city:g.stored.city,name:g.stored.name,
    candidates:g.candidates.map(c=>({name:c.canonical_name,sourceId:c.primary_place_id,status:c.status})),
    mentions:g.mentions.length,literalNotes:g.literalNoteIds.length,goldset:g.goldset.length}))}));
} finally {
  await down.query('ROLLBACK').catch(()=>{});await up.query('ROLLBACK').catch(()=>{});
  await down.end();await up.end();
}
