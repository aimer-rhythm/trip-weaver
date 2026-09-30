// 仅修复本任务两份杭州快照：补现有精确本地图，移除已验证失效且身份不符的维基图。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const ids = ['0552c0b3-6446-48b9-bf4b-9a11699ce669', '8ab33003-50c9-4d60-852d-cd1c80cb842f'];
const report = JSON.parse(fs.readFileSync('.trellis/tasks/09-29-hangzhou-image-diagnosis/research/live-hangzhou/result.json', 'utf8'));
const failed = new Set(report.covers.filter(p => p.error || p.status !== 200).map(p => p.url));
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const places = (await client.query("SELECT name,payload FROM canonical_places WHERE city='杭州' AND payload ? 'coverImage'")).rows;
  for (const id of ids) {
    const original = (await client.query('SELECT user_id,data FROM trips WHERE id=$1', [id])).rows[0];
    assert.equal(original.data.destination, '杭州');
    const next = structuredClone(original.data);
    const changes = [];
    for (const poi of next.overview) {
      const matches = places.filter(p => p.name === poi.name || (p.payload.aliases || []).includes(poi.name));
      const before = poi.coverUrl;
      if (matches.length === 1) {
        const key = matches[0].payload.coverImage;
        const root = path.resolve('data/media');
        const file = path.resolve(root, key);
        if (file.startsWith(root + path.sep) && fs.existsSync(file)) {
          const url = '/media/' + key;
          const response = await fetch(new URL(url, 'http://127.0.0.1:5173'));
          assert.equal(response.status, 200);
          assert.match(response.headers.get('content-type') || '', /^image\//);
          poi.coverUrl = url;
        }
      } else if (failed.has(poi.coverUrl)) {
        delete poi.coverUrl;
      }
      if (before !== poi.coverUrl) changes.push({ name: poi.name, before: before || null, after: poi.coverUrl || null });
    }
    assert.deepEqual(next.days, original.data.days);
    if (changes.length) {
      const dir = 'data/backups/image-optimization';
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${id}-${Date.now()}.json`), JSON.stringify(original), { flag: 'wx' });
      next.updatedAt = Date.now();
      const updated = await client.query('UPDATE trips SET data=$1,updated_at=$2 WHERE id=$3 AND user_id=$4 AND data=$5::jsonb',
        [next, new Date(next.updatedAt), id, original.user_id, original.data]);
      assert.equal(updated.rowCount, 1, '并发编辑，停止覆盖');
    }
    console.log(JSON.stringify({ id, changes }));
  }
} finally { await client.end(); }
