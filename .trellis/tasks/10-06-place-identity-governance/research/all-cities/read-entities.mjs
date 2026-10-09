// 为相似名候选漏掉的已知实体补充只读证据，冻结后不覆盖。
import fs from 'node:fs';
import {parse} from 'dotenv';
import {Client} from 'pg';
import assert from 'node:assert/strict';
const base=new URL('./',import.meta.url);
const [file,...wanted]=process.argv.slice(2);
assert.match(file ?? '',/^[a-z0-9-]+\.json$/);
assert.ok(wanted.length && wanted.every(id=>/^[a-f0-9]{32}$/.test(id)));
const target=new URL(file,base);assert.ok(!fs.existsSync(target),'实体证据不覆盖');
const settings=parse(fs.readFileSync(new URL('../../../../../../xhs-travel-pipeline/.env',base)));
const db=new Client({connectionString:settings.DATABASE_URL.replace('postgresql+asyncpg:','postgresql:'),connectionTimeoutMillis:10000});
await db.connect();
try {
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const entities=(await db.query(`SELECT entity_id,city,canonical_name,aliases,legacy_ids,revision,status,
    primary_place_id,redirect_to,overrides,evidence FROM place_entity WHERE entity_id=ANY($1::text[]) ORDER BY entity_id`,[wanted])).rows;
  assert.equal(entities.length,new Set(wanted).size);
  for(const entity of entities) {
    entity.places=(await db.query(`SELECT m.entity_id,p.id,p.name,p.normalized_name,p.city,p.address,p.latitude,p.longitude,
      p.place_type,p.geo_status,p.amap_poi_id,p.is_active FROM canonical_place p JOIN place_entity_member m ON m.place_id=p.id
      WHERE m.entity_id=$1 ORDER BY p.id`,[entity.entity_id])).rows;
    const names=[...new Set([entity.canonical_name,...entity.aliases,...entity.places.map(p=>p.name)])];
    entity.mentions=(await db.query(`SELECT m.id,n.city,m.name,m.normalized_name,m.place_type,m.reason,m.evidence_text,
      n.id note_id,n.title,split_part(n.source_url,'?',1) source_url FROM place_mention m JOIN raw_note n ON n.id=m.raw_note_id
      WHERE n.city=$1 AND m.name=ANY($2::text[]) ORDER BY m.id`,[entity.city,names])).rows;
  }
  fs.writeFileSync(target,JSON.stringify({capturedAt:new Date().toISOString(),entities},null,2)+'\n');
  console.log(JSON.stringify(entities.map(e=>({name:e.canonical_name,revision:e.revision,places:e.places,mentions:e.mentions}))));
} finally {await db.query('ROLLBACK');await db.end();}
