// 本任务的一次性修复：仅为用户指定行程采用两张已确认归属的本地图。
// 默认预览；--apply 保存备份后修改。不会执行迁移、调用外部图库或修改活动。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'dotenv';
import pg from 'pg';

const id = '0552c0b3-6446-48b9-bf4b-9a11699ce669';
const names = ['灵隐寺', '虎跑公园'];
const config = parse(fs.readFileSync('apps/server/.env'));
const client = new pg.Client({ connectionString: config.DATABASE_URL });
await client.connect();
try {
  const original = (await client.query('SELECT id,user_id,data,updated_at FROM trips WHERE id=$1', [id])).rows[0];
  assert.ok(original, '指定行程不存在');
  assert.equal(original.data.destination, '杭州');
  const rows = (await client.query(
    `SELECT name,payload->>'coverImage' AS key FROM canonical_places
     WHERE city='杭州' AND name=ANY($1::text[]) AND payload ? 'coverImage'`, [names],
  )).rows;
  const next = structuredClone(original.data);
  const changes = [];
  for (const name of names) {
    const matches = rows.filter(row => row.name === name);
    assert.equal(matches.length, 1, `${name}需要唯一明确的本地图`);
    const key = matches[0].key;
    const mediaRoot = path.resolve('data/media');
    const file = path.resolve(mediaRoot, key);
    assert.ok(file.startsWith(mediaRoot + path.sep) && fs.statSync(file).isFile());
    const url = `${(config.MEDIA_BASE_URL || '/media').replace(/\/+$/, '')}/${key}`;
    const response = await fetch(new URL(url, 'http://127.0.0.1:5173'), { signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /^image\/webp/);
    await response.arrayBuffer();
    const poi = next.overview.find(p => p.name === name);
    assert.ok(poi, `${name}不在原行程候选中`);
    if (poi.coverUrl !== url) {
      changes.push({ name, before: poi.coverUrl ?? null, after: url });
      poi.coverUrl = url;
    }
  }
  assert.deepEqual(next.days, original.data.days);
  console.log(JSON.stringify({ tripId: id, changes, apply: process.argv.includes('--apply') }, null, 2));
  if (process.argv.includes('--apply') && changes.length) {
    const backupDir = path.resolve('data/backups/trip-covers');
    fs.mkdirSync(backupDir, { recursive: true });
    const backup = path.join(backupDir, `${id}-${Date.now()}.json`);
    fs.writeFileSync(backup, JSON.stringify(original, null, 2) + '\n', { flag: 'wx' });
    next.updatedAt = Date.now();
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE trips SET data=$1,updated_at=$2 WHERE id=$3 AND user_id=$4 AND data=$5::jsonb`,
      [next, new Date(next.updatedAt), id, original.user_id, original.data],
    );
    assert.equal(result.rowCount, 1, '行程已被并发编辑，终止本次补图');
    await client.query('COMMIT');
    console.log(`已更新 ${changes.length} 个封面，原始备份：${backup}`);
  }
} finally {
  await client.query('ROLLBACK');
  await client.end();
}
