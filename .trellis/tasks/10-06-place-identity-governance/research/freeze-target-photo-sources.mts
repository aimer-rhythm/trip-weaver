// 单城指定主体的独立图库及现行身份只读快照；不运行迁移。
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { readFile, open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { parse } from 'dotenv';
import type { PlaceRow } from '../../../../apps/server/src/generation/retrievalRanking';
import { createPlaceIdentityIndex, placeIdentity, placeNames } from '../../../../apps/server/src/lib/placeIdentity';
import { loadIndependentPhotoSources, photoIdentityDigest } from '../../../../apps/server/src/services/independentPhotoSources';
import { loadIndependentPhotoAssignments } from '../../../../apps/server/src/services/independentPhotoIdentity';

const { values } = parseArgs({ options: { city: { type: 'string' }, name: { type: 'string', multiple: true }, out: { type: 'string' } } });
assert.ok(values.city && values.name?.length && values.out);
const root = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(root, values.out);
assert.ok(out.startsWith(root + path.sep));
const pointer = JSON.parse(await readFile(path.join(root, 'cleaning-scope/current.json'), 'utf8'));
assert.ok(!pointer.policy.excludedCities.includes(values.city));
const output = await open(out, 'wx');
const client = new Client({ connectionString: parse(await readFile('apps/server/.env')).DATABASE_URL, connectionTimeoutMillis: 10000 });
try {
  await client.connect(); await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const rows = (await client.query<PlaceRow>('SELECT id,city,name,category,source,verified,payload,lat,lng FROM canonical_places WHERE city=$1', [values.city])).rows;
  const index = createPlaceIdentityIndex(rows.filter(r => r.verified || r.payload?.identityWithdrawal));
  const inputs = await loadIndependentPhotoSources(values.city);
  assert.deepEqual(inputs.warnings, []);
  const assignments = await loadIndependentPhotoAssignments(client, values.city);
  const entities = values.name.map(name => {
    const resolved = index.resolve(values.city!, name); assert.ok(resolved.status === 'resolved', name);
    const place = resolved.place;
    const sources = inputs.sources.filter(s => [s.catalogName, ...s.aliases].some(n => {
      const result = index.resolve(values.city!, n); return result.status === 'resolved' && result.canonicalPlaceId === place.id;
    }));
    return { entityId: place.id, name: place.name, revision: placeIdentity(place).revision, identity: placeIdentity(place),
      aliases: placeNames(place), lat: place.lat, lng: place.lng, category: place.category, verified: place.verified,
      payloadDigest: photoIdentityDigest(place.payload), currentImageFields: { coverImage: place.payload?.coverImage ?? null,
        amapPhoto: place.payload?.amapPhoto ?? null, imageGallery: place.payload?.imageGallery ?? null },
      independentSources: sources,
      relatedAssetSources: inputs.sources.filter(s => sources.some(t => t.assetKey === s.assetKey)).map(s => ({
        imageKey: s.imageKey, assetKey: s.assetKey, catalogName: s.catalogName, eligible: s.eligible })),
      assignments: assignments.filter(a => sources.some(s => s.imageKey === a.image_key || s.assetKey === a.asset_key)) };
  });
  const report = { readOnly: true, city: values.city, capturedAt: new Date().toISOString(), inputDigest: photoIdentityDigest(inputs),
    sourceImages: inputs.sources.length, reviewedCatalogs: inputs.reviewed.length,
    sourceCatalogs: inputs.reviewed.map(c => ({ name: c.name, aliases: c.aliases, images: c.entries.length })),
    cityAssignments: assignments.length, entities, warnings: inputs.warnings };
  await output.writeFile(JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ out: values.out, city: values.city, entities: entities.map(e => ({ id: e.entityId, name: e.name,
    revision: e.revision, sources: e.independentSources.length, eligible: e.independentSources.filter(s => s.eligible).length, assignments: e.assignments.length })) }));
} finally { await client.query('ROLLBACK').catch(() => {}); await client.end(); await output.close(); }
