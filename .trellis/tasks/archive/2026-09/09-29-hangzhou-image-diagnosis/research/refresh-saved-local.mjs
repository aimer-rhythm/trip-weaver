import assert from 'node:assert/strict';
import fs from 'node:fs';
import '../../../../apps/server/src/lib/proxy.ts';
import { pool } from '../../../../apps/server/src/db/client.ts';
import { createStoredPlaceLookups } from '../../../../apps/server/src/generation/storedCover.ts';
import { createWikiCoverLookup } from '../../../../apps/server/src/integrations/wikimedia/cover.ts';
const id = process.argv[2];
assert.ok(id);
try {
  const row = (await pool.query('SELECT user_id,data FROM trips WHERE id=$1', [id])).rows[0];
  assert.equal(row.data.destination, '杭州');
  const next = structuredClone(row.data);
  const lookup = createStoredPlaceLookups(next.destination);
  const wiki = createWikiCoverLookup();
  const changes = [];
  for (const poi of next.overview) {
    let local = await lookup.coverFor(poi.name);
    if (!local && !poi.coverUrl && process.argv.includes('--wiki')) {
      const point = await lookup.pointFor(poi.name);
      if (point) local = await wiki.coverFor({ name: poi.name, city: next.destination, ...point });
    }
    if (!local || local === poi.coverUrl) continue;
    const response = await fetch(new URL(local, 'http://127.0.0.1:5173'));
    assert.equal(response.status, 200);
    changes.push({ name: poi.name, before: poi.coverUrl || null, after: local });
    poi.coverUrl = local;
  }
  assert.deepEqual(next.days, row.data.days);
  if (changes.length) {
    fs.writeFileSync(`data/backups/image-optimization/${id}-${Date.now()}.json`, JSON.stringify(row), { flag: 'wx' });
    next.updatedAt = Date.now();
    const result = await pool.query('UPDATE trips SET data=$1,updated_at=$2 WHERE id=$3 AND user_id=$4 AND data=$5::jsonb',
      [next, new Date(next.updatedAt), id, row.user_id, row.data]);
    assert.equal(result.rowCount, 1);
  }
  console.log(JSON.stringify({ id, changes }));
} finally { await pool.end(); }
