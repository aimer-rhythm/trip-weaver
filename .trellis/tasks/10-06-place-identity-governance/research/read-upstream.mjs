import fs from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
const require = createRequire(path.resolve('apps/server/package.json'));
const {parse} = require('dotenv');
const {Client} = require('pg');
const env = parse(fs.readFileSync('../xhs-travel-pipeline/.env'));
const db = new Client({connectionString: env.DATABASE_URL.replace('postgresql+asyncpg:', 'postgresql:')});
await db.connect();
try {
  await db.query('BEGIN READ ONLY');
  const report = {};
  report.mentions = (await db.query(`SELECT m.id,m.name,m.normalized_name,m.place_type,m.reason,m.evidence_text,n.title,n.source_url
    FROM place_mention m JOIN raw_note n ON n.id=m.raw_note_id
    WHERE n.city='济南' AND (m.name LIKE '%商埠%' OR m.name LIKE '%大明湖%') ORDER BY m.name,m.id`)).rows;
  report.places = (await db.query(`SELECT id,name,normalized_name,city,address,latitude,longitude,place_type,geo_status,amap_poi_id,is_active FROM canonical_place ORDER BY city,id`)).rows;
  fs.writeFileSync('.trellis/tasks/10-06-place-identity-governance/research/upstream-evidence.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({cities:[...new Set(report.places.map(p=>p.city))],count:report.places.length,mentions:report.mentions},null,2));
} finally { await db.query('ROLLBACK'); await db.end(); }
