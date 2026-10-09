// 实库身份和独立图库只读冻结，不导入启动模块；输出省略外链访问参数和用户内容。
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { open, readFile } from 'node:fs/promises';
import { Client } from 'pg';
import { parse } from 'dotenv';
import { loadIndependentPhotoSources } from '../../../../apps/server/src/services/independentPhotoSources';
import { createPlaceIdentityIndex, placeIdentity } from '../../../../apps/server/src/lib/placeIdentity';
import type { RetrievedPlace } from '../../../../apps/server/src/generation/placeRetrieval';

const { values } = parseArgs({ options: { out: { type: 'string' } } });
assert.ok(values.out);
const output = await open(values.out, 'wx');
const configuration = parse(await readFile('apps/server/.env'));
const client = new Client({ connectionString: configuration.DATABASE_URL, connectionTimeoutMillis: 10000 });
const cities = ['北京', '上海', '厦门', '广州', '成都', '杭州', '重庆', '济南', '苏州', '西安', '青岛', '云南'];
try {
  await client.connect();
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const results = [];
  for (const city of cities) {
    const rows = (await client.query<RetrievedPlace>('SELECT id,city,name,verified,payload FROM canonical_places WHERE city=$1', [city])).rows;
    const identities = createPlaceIdentityIndex(rows.filter(row => row.verified || row.payload?.identityWithdrawal));
    const inputs = await loadIndependentPhotoSources(city);
    const catalogs = [...new Map(inputs.sources.map(s => [`${s.kind}:${s.catalogName}`, s])).values()].map(source => ({
      kind: source.kind, name: source.catalogName,
      resolutions: [source.catalogName, ...source.aliases].map(name => {
        const resolved = identities.resolve(city, name);
        return resolved.status === 'resolved' ? { name, status: resolved.status, entityId: resolved.canonicalPlaceId,
          canonicalName: resolved.place.name, revision: placeIdentity(resolved.place).revision } : { name, status: resolved.status };
      }),
      images: inputs.sources.filter(s => s.kind === source.kind && s.catalogName === source.catalogName).map(s => ({
        imageKey: s.imageKey, inputHash: s.inputHash, assetKey: s.assetKey, eligible: s.eligible,
        localPath: s.entry.photo.url.startsWith('/media/') ? `data${s.entry.photo.url}` : null,
        evidence: s.entry.evidence, ...('selectionKey' in s.entry ? { selectionKey: s.entry.selectionKey } : { review: s.entry.review }),
      })),
    }));
    const scoped = rows.filter(row => row.payload?.imageIdentity).map(row => ({ id: row.id, name: row.name,
      verified: row.verified, revision: placeIdentity(row).revision,
      matchedCatalogs: catalogs.filter(c => c.resolutions.some(r => 'entityId' in r && r.entityId === row.id)).map(c => c.name) }));
    const result = { city, catalogs, scoped, warnings: inputs.warnings };
    results.push(result);
    console.log(JSON.stringify({ city, catalogs: catalogs.length, images: inputs.sources.length,
      eligible: inputs.sources.filter(s => s.eligible).length, scoped, warnings: inputs.warnings }));
  }
  await client.query('ROLLBACK');
  await output.writeFile(JSON.stringify({ readOnly: true, byteValidation: true, remoteValidation: 'official_url_hash_only', results }, null, 2));
} finally { await client.query('ROLLBACK').catch(() => {}); await client.end(); await output.close(); }
