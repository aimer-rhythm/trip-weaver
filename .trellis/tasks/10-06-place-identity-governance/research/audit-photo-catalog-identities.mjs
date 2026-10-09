// 只读核实人工图库与正式身份的三组差异；不依图库alias自动生成合并决定。
import { readFile, writeFile } from 'node:fs/promises';
import { Client } from 'pg';
import { parse } from 'dotenv';
const city = '北京', pattern = '国博|国家博物|景山|王府井';
const report = { readOnly: true, capturedAt: new Date().toISOString(), city };
async function readDatabase(file, work) {
  const settings = parse(await readFile(file));
  const client = new Client({ connectionString: settings.DATABASE_URL.replace('postgresql+asyncpg:', 'postgresql:'), connectionTimeoutMillis: 10000 });
  try {
    await client.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout='20s'");
    await work(client);
  } finally { await client.query('ROLLBACK').catch(() => {}); await client.end(); }
}
await readDatabase('apps/server/.env', async client => {
  report.downstream = (await client.query(`SELECT id,city,name,category,source,verified,lat,lng,
    jsonb_build_object('identity',payload->'identity','aliases',payload->'aliases','canonicalRedirectTo',payload->'canonicalRedirectTo',
      'sourcePlaceId',payload->'sourcePlaceId','address',payload->'address','mentionSources',payload->'mentionSources') payload
    FROM canonical_places WHERE city=$1 AND (name ~ $2 OR (payload->'identity')::text ~ $2) ORDER BY name,id`, [city, pattern])).rows;
});
await readDatabase('../xhs-travel-pipeline/.env', async client => {
  const entities = (await client.query(`SELECT entity_id,city,canonical_name,primary_place_id,aliases,legacy_ids,revision,status,redirect_to,overrides,evidence
    FROM place_entity WHERE city=$1 AND (canonical_name ~ $2 OR aliases::text ~ $2) ORDER BY entity_id`, [city, pattern])).rows;
  const ids = entities.map(e => e.entity_id);
  const sources = (await client.query(`SELECT p.id,p.name,p.normalized_name,p.city,p.address,p.latitude,p.longitude,p.amap_poi_id,
    p.place_type,p.geo_status,p.is_active,em.entity_id FROM canonical_place p LEFT JOIN place_entity_member em ON em.place_id=p.id
    WHERE p.city=$1 AND (p.name ~ $2 OR em.entity_id=ANY($3::text[])) ORDER BY p.id`, [city, pattern, ids])).rows;
  const mentions = (await client.query(`SELECT m.id,m.raw_note_id,m.name,m.normalized_name,m.reason,m.evidence_text,m.mention_type,m.fact_type,m.fact_value,
    n.title,n.desc,n.img_analysis,split_part(n.source_url,'?',1) source_url
    FROM place_mention m JOIN raw_note n ON n.id=m.raw_note_id
    WHERE n.city=$1 AND (m.name ~ $2 OR m.normalized_name=ANY($3::text[])) ORDER BY m.id`,
    [city, pattern, sources.map(p => p.normalized_name)])).rows;
  const reviews = (await client.query(`SELECT id,status,detail FROM place_entity_review
    WHERE city=$1 AND (detail->'entityIds') ?| $2::text[] ORDER BY id`, [city, ids])).rows;
  report.upstream = { entities, sources, mentions, reviews };
});
const filename = `photo-catalog-identity-audit-${Date.now()}.json`;
await writeFile(new URL(filename, import.meta.url), JSON.stringify(report, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ filename, downstream: report.downstream.map(p => ({id:p.id,name:p.name,source:p.source,identity:p.payload.identity,redirect:p.payload.canonicalRedirectTo})),
  upstreamEntities: report.upstream.entities.map(e => ({id:e.entity_id,name:e.canonical_name,revision:e.revision,status:e.status,redirect:e.redirect_to})),
  sourceCount: report.upstream.sources.length, mentions: report.upstream.mentions.length, notes: new Set(report.upstream.mentions.map(m=>m.raw_note_id)).size,
  reviews: report.upstream.reviews.map(r=>({id:r.id,status:r.status,assessment:r.detail.assessment})) }));
