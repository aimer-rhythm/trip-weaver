// 只读诊断：不导入应用数据库启动模块，不执行迁移或调用外部 API。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { normalizePlaceKey } from '../../../../apps/server/src/lib/placeKey.ts';
import { rankPlaces } from '../../../../apps/server/src/generation/retrievalRanking.ts';
import { createPlaceRetriever } from '../../../../apps/server/src/generation/placeRetrieval.ts';

const require = createRequire(path.resolve('apps/server/package.json'));
const { parse } = require('dotenv');
const { Client } = require('pg');
const outDir = path.resolve('.trellis/tasks/10-06-place-identity-governance/research');
const targets = ['大明湖', '大明湖景区', '经三路老商埠', '老商埠'];
const report: Record<string, any> = { generatedAt: new Date().toISOString(), readOnly: true, city: '济南' };
const brief = (p: any) => ({ id: p.id, name: p.name, category: p.category, source: p.source,
  lat: p.lat, lng: p.lng, aliases: p.payload?.aliases, identity: p.payload?.identity,
  redirect: p.payload?.canonicalRedirectTo ?? null, address: p.payload?.address });

const exported = JSON.parse(fs.readFileSync('import/xhs-places-济南.json', 'utf8'));
report.export = { generatedAt: exported.generatedAt, count: exported.count,
  targets: exported.places.filter((p: any) => targets.includes(p.name)).map(brief) };
report.normalizedKeys = targets.map(name => ({ name, key: normalizePlaceKey(name) }));

async function readDb(label: string, envPath: string, run: (client: any) => Promise<void>) {
  const env = parse(fs.readFileSync(envPath));
  if (!env.DATABASE_URL) throw new Error(`${label}: DATABASE_URL 未配置`);
  const client = new Client({ connectionString: env.DATABASE_URL.replace('postgresql+asyncpg:', 'postgresql:'),
    connectionTimeoutMillis: 10000, query_timeout: 15000 });
  try {
    await client.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout = '10s'");
    await run(client);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  }
}

await readDb('upstream', '../xhs-travel-pipeline/.env', async client => {
  report.upstream = (await client.query(`SELECT id, city, name, normalized_name, place_type,
    latitude, longitude, amap_poi_id, is_active, to_jsonb(c)->>'address' AS address
    FROM canonical_place c WHERE city=$1 AND (name LIKE '%大明湖%' OR name LIKE '%商埠%') ORDER BY name, id`, ['济南'])).rows;
});
await readDb('downstream', 'apps/server/.env', async client => {
  const rows = (await client.query(`SELECT id,city,name,category,verified,source,lat,lng,
    jsonb_build_object('aliases',payload->'aliases','identity',payload->'identity',
      'canonicalRedirectTo',payload->'canonicalRedirectTo','address',payload->'address',
      'mentionCount',payload->'mentionCount','recommendScore',payload->'recommendScore') AS payload
    FROM canonical_places WHERE city=$1 ORDER BY name,id`, ['济南'])).rows;
  const active = rows.filter((p: any) => p.payload.canonicalRedirectTo == null);
  report.downstream = { total: rows.length, active: active.length,
    targets: rows.filter((p: any) => targets.includes(p.name)).map(brief),
    related: rows.filter((p: any) => /大明湖|商埠/.test(p.name) && !targets.includes(p.name)).map(brief) };
  const retrieve = createPlaceRetriever({ query: (sql, values) => client.query(sql, values), embed: async () => null });
  report.keywordProbes = [];
  for (const name of targets) {
    const hits = await retrieve([name], { city: '济南', vector: 'off', limit: 8 });
    report.keywordProbes.push({ query: name, results: hits.map(p => ({ id: p.id, name: p.name, category: p.category })) });
  }
  const a = active.find((p: any) => p.name === '经三路老商埠');
  const b = active.find((p: any) => p.name === '老商埠');
  if (a && b) {
    const rad = (n: number) => n * Math.PI / 180;
    const h = Math.sin(rad(a.lat - b.lat) / 2) ** 2
      + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(a.lng - b.lng) / 2) ** 2;
    report.shangbuStoredDistanceKm = Math.round(6371 * 2 * Math.asin(Math.sqrt(h)) * 10) / 10;
  }
  report.retrievalProbe = [targets.slice(0, 2), targets.slice(2)].map(names => {
    const sample = active.filter((p: any) => names.includes(p.name));
    return { names,
      together: rankPlaces(sample, names, [], 8).map(p => ({ id: p.row.id, name: p.row.name, ids: p.ids, aliases: p.aliases })),
      separately: sample.map((p: any) => rankPlaces([p], [p.name], [], 8)[0])
        .map(p => ({ id: p.row.id, name: p.row.name, aliases: p.aliases })) };
  });
  const groups = new Map<string, any[]>();
  for (const row of active) {
    const key = normalizePlaceKey(row.name);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  report.sameTextKeyGroups = [...groups].filter(([, members]) => members.length > 1)
    .map(([key, members]) => ({ key, members: members.map(brief) }));
});
fs.writeFileSync(path.join(outDir, 'identity-audit.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
