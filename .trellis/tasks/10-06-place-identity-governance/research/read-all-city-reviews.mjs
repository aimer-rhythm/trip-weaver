// 为全城治理冻结只读证据；原始提及保留，来源 URL 去查询参数，不打印敏感数据。
import fs from 'node:fs';
import { parse } from 'dotenv';
import { Client } from 'pg';
const root = new URL('../../../../', import.meta.url);
const output = new URL('./all-cities/', import.meta.url);
const env = parse(fs.readFileSync(new URL('../xhs-travel-pipeline/.env', root)));
const db = new Client({ connectionString: env.DATABASE_URL.replace('postgresql+asyncpg:', 'postgresql:') });
const key = name => String(name ?? '').normalize('NFKC').replace(/\s+/gu, '').toLowerCase();
await db.connect();
try {
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const reviews = (await db.query(`SELECT id,fingerprint,city,status,detail FROM place_entity_review
    WHERE status='PENDING' ORDER BY city,id`)).rows;
  const wanted = [...new Set(reviews.flatMap(row => row.detail.entityIds ?? []))];
  const entities = (await db.query(`SELECT entity_id,city,canonical_name,aliases,legacy_ids,revision,status,
    primary_place_id,redirect_to,overrides,evidence FROM place_entity WHERE entity_id=ANY($1::text[]) ORDER BY city,entity_id`, [wanted])).rows;
  const places = (await db.query(`SELECT m.entity_id,p.id,p.name,p.normalized_name,p.city,p.address,p.latitude,p.longitude,
    p.place_type,p.geo_status,p.amap_poi_id,p.is_active FROM canonical_place p JOIN place_entity_member m ON m.place_id=p.id
    WHERE m.entity_id=ANY($1::text[]) ORDER BY p.city,p.id`, [wanted])).rows;
  const mentions = (await db.query(`SELECT m.id,n.city,m.name,m.normalized_name,m.place_type,m.reason,m.evidence_text,
    n.id note_id,n.title,split_part(n.source_url,'?',1) source_url FROM place_mention m JOIN raw_note n ON n.id=m.raw_note_id
    ORDER BY m.id DESC`)).rows;
  for (const entity of entities) {
    entity.places = places.filter(place => place.entity_id === entity.entity_id);
    const names = new Set([entity.canonical_name,...entity.aliases,...entity.places.map(p=>p.name)].map(key));
    entity.mentions = mentions.filter(m=>m.city===entity.city && names.has(key(m.name))).slice(0,20);
  }
  const report = { capturedAt:new Date().toISOString(), reviews, entities };
  fs.mkdirSync(output,{recursive:true});
  const target = new URL('source-snapshot.json',output);
  if (fs.existsSync(target)) throw new Error('全城源证据已冻结，请新建版本，不能覆盖');
  fs.writeFileSync(target,JSON.stringify(report,null,2));
  const byId = new Map(entities.map(e=>[e.entity_id,e]));
  fs.writeFileSync(new URL('review-list.md',output), '# 全城待核实地点\n\n' + reviews.map(r=>
    `- ${r.id} ${r.city}：${r.detail.entityIds.map(id=>byId.get(id)?.canonical_name??id).join(' / ')}`).join('\n')+'\n');
  console.log(JSON.stringify({reviews:reviews.length,entities:entities.length,sourcePlaces:places.length,
    withMentions:entities.filter(e=>e.mentions.length).length,cities:[...new Set(reviews.map(r=>r.city))]},null,2));
} finally { await db.query('ROLLBACK'); await db.end(); }
