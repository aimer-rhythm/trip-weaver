// 双库只读汇总；不输出连接信息、原始笔记或来源 token。
import fs from 'node:fs';
import { parse } from 'dotenv';
import { Client } from 'pg';

const root = new URL('../../../../', import.meta.url);
const configs = [
  ['upstream', new URL('../xhs-travel-pipeline/.env', root)],
  ['downstream', new URL('apps/server/.env', root)],
];
const report = { verifiedAt: new Date().toISOString() };
for (const [name, file] of configs) {
  const env = parse(fs.readFileSync(file));
  const db = new Client({ connectionString: env.DATABASE_URL.replace('postgresql+asyncpg:', 'postgresql:') });
  await db.connect();
  try {
    await db.query('BEGIN READ ONLY');
    if (name === 'upstream') {
      report.upstream = {
        cities: (await db.query(`SELECT city,count(*)::int entities,
          count(*) FILTER (WHERE redirect_to IS NULL AND status='ACTIVE')::int active,
          count(*) FILTER (WHERE redirect_to IS NOT NULL)::int redirected,
          count(*) FILTER (WHERE status='REVIEW')::int withheld
          FROM place_entity GROUP BY city ORDER BY city`)).rows,
        members: (await db.query('SELECT count(*)::int count FROM place_entity_member')).rows[0].count,
        reviews: (await db.query('SELECT city,status,count(*)::int count FROM place_entity_review GROUP BY city,status ORDER BY city,status')).rows,
        changes: (await db.query('SELECT change_key,city,rolled_back FROM place_entity_change ORDER BY id')).rows,
      };
    } else {
      report.downstream = {
        city: '济南',
        counts: (await db.query(`SELECT count(*)::int total,
          count(*) FILTER (WHERE payload->>'canonicalRedirectTo' IS NULL AND verified)::int active,
          count(*) FILTER (WHERE payload->>'canonicalRedirectTo' IS NOT NULL)::int redirected,
          count(*) FILTER (WHERE payload->>'canonicalRedirectTo' IS NULL AND verified AND embedding IS NOT NULL)::int embedded
          FROM canonical_places WHERE city='济南'`)).rows[0],
        imports: (await db.query(`SELECT id,created_at,rolled_back_at,
          jsonb_array_length(before_state->'places') before_places,
          jsonb_array_length(after_state->'places') after_places,
          jsonb_array_length(after_state->'evidence') after_evidence
          FROM place_identity_imports WHERE city='济南' ORDER BY created_at`)).rows,
        originalPhotoDifferences: (await db.query(`WITH initial AS (
          SELECT before_state FROM place_identity_imports WHERE city='济南' ORDER BY created_at LIMIT 1
        ), old AS (SELECT jsonb_array_elements(before_state->'places') p FROM initial)
        SELECT old.p->>'id' id,old.p->>'name' name FROM old
        LEFT JOIN canonical_places current ON current.id=old.p->>'id'
        WHERE (old.p->'payload'->'coverImage' IS NOT NULL AND old.p->'payload'->'coverImage' IS DISTINCT FROM current.payload->'coverImage')
          OR (old.p->'payload'->'imageGallery' IS NOT NULL AND old.p->'payload'->'imageGallery' IS DISTINCT FROM current.payload->'imageGallery')`)).rows,
      };
    }
  } finally { await db.query('ROLLBACK'); await db.end(); }
}
fs.writeFileSync(new URL('./governance-state.json', import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
