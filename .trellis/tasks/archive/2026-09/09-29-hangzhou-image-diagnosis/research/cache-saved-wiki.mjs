import assert from 'node:assert/strict';
import fs from 'node:fs';
import pg from 'pg';
import '../../../../apps/server/src/lib/proxy.ts';
import { cacheWikiImage } from '../../../../apps/server/src/integrations/wikimedia/imageCache.ts';

const id = '0ed2a147-4189-4650-aabe-31eabdde4413';
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const row = (await client.query('SELECT user_id,data FROM trips WHERE id=$1', [id])).rows[0];
  assert.equal(row.data.destination, '杭州');
  const next = structuredClone(row.data);
  const changes = [];
  for (const poi of next.overview) {
    if (poi.name !== '岳王庙' || !poi.coverUrl?.startsWith('https://thumb.wikimedia.org/')) continue;
    const url = await cacheWikiImage(poi.coverUrl);
    assert.ok(url, '生产下载器未取到完整图片，停止修复');
    const response = await fetch(new URL(url, 'http://127.0.0.1:5173'));
    assert.equal(response.status, 200);
    changes.push({ name: poi.name, before: poi.coverUrl, after: url });
    poi.coverUrl = url;
  }
  assert.deepEqual(next.days, row.data.days);
  if (changes.length) {
    fs.writeFileSync(`data/backups/image-optimization/${id}-${Date.now()}.json`, JSON.stringify(row), { flag: 'wx' });
    next.updatedAt = Date.now();
    const result = await client.query('UPDATE trips SET data=$1,updated_at=$2 WHERE id=$3 AND user_id=$4 AND data=$5::jsonb',
      [next, new Date(next.updatedAt), id, row.user_id, row.data]);
    assert.equal(result.rowCount, 1);
  }
  console.log(JSON.stringify({ id, changes }));
} finally { await client.end(); }

