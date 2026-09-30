// 同一13候选仅替换已审核图片，生成离线对照快照；不写入旧行程。
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { pool } from '../../../../apps/server/src/db/client.ts';
import { createStoredPlaceLookups } from '../../../../apps/server/src/generation/storedCover.ts';
import { createCuratedCoverLookup } from '../../../../apps/server/src/integrations/curatedPhotos.ts';
const targets = JSON.parse(await fs.readFile('apps/server/src/data/photography/hangzhou-targets.json', 'utf8'));
try {
  const stored = createStoredPlaceLookups('杭州');
  const curated = createCuratedCoverLookup('杭州');
  const current = [];
  for (const target of targets) current.push({ name: target.name, current: await stored.coverFor(target.name), curated: await curated(target.name) });
  await fs.writeFile('data/photo-pilot/current-covers.json', JSON.stringify(current, null, 2));
  const row = (await pool.query('SELECT data FROM trips WHERE id=$1', ['f00889cd-d163-4b3c-b90d-dec61c985b52'])).rows[0];
  assert.ok(row);
  const next = structuredClone(row.data);
  const changes = [];
  for (const poi of next.overview) {
    const photo = await curated(poi.name);
    if (!photo) continue;
    changes.push({ name: poi.name, before: poi.coverUrl || null, after: photo.coverUrl });
    Object.assign(poi, photo);
  }
  assert.deepEqual(next.days, row.data.days);
  const report = { tripId: row.data.id, before: row.data.overview.filter(p => p.coverUrl).length,
    after: next.overview.filter(p => p.coverUrl).length, total: next.overview.length, changes, databaseUpdated: false };
  await fs.writeFile('data/photo-pilot/fixed-comparison.json', JSON.stringify(report, null, 2));
  await fs.writeFile('data/photo-pilot/fixed-trip.json', JSON.stringify(next, null, 2));
  console.log(JSON.stringify(report));
} finally { await pool.end(); }
