// 用实际精选导出创建一次性数据库，再从导入后的 payload 生成只读页面验收数据。
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const require = createRequire(path.join(root, 'apps/server/package.json'));
const { Client } = require('pg');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(root, 'apps/server/.env'), quiet: true });
dotenv.config({ path: path.join(root, '.env'), quiet: true });
const url = new URL(process.env.DATABASE_URL);
url.pathname = '/postgres';
const admin = new Client({ connectionString: url.toString() });
const database = `ranked_real_gallery_${Date.now()}`;
await admin.connect();
await admin.query(`CREATE DATABASE "${database}"`);
url.pathname = `/${database}`;
const env = { ...process.env, DATABASE_URL: url.toString(), MASTER_KEY: 'a'.repeat(64) };
const run = promisify(execFile);
const client = new Client({ connectionString: url.toString() });
try {
  const manifestPath = path.join(here, 'preview/xhs-place-images-beijing.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const groups = new Map();
  for (const image of manifest.images) {
    const group = groups.get(image.placeId) ?? [];
    group.push(image);
    groups.set(image.placeId, group);
  }
  const placePath = path.join(here, 'preview/xhs-places-beijing.json');
  await writeFile(placePath, JSON.stringify({ city: '北京', generatedAt: new Date().toISOString(),
    places: [...groups].map(([id, images]) => ({ id, name: images[0].placeName, category: '文化', lat: 39.9, lng: 116.4, payload: {} })) }));
  for (const [script, file] of [['seed-xhs-places.ts', placePath], ['seed-xhs-place-images.ts', manifestPath]]) {
    await run(process.execPath, ['--import', 'tsx', `apps/server/scripts/${script}`, file], { cwd: root, env, timeout: 60000 });
  }
  await client.connect();
  const rows = (await client.query('SELECT id,name,payload FROM canonical_places WHERE city=$1', ['北京'])).rows;
  const overview = [...groups].map(([id, images]) => {
    const row = rows.find(row => row.id === id);
    assert.deepEqual(row.payload.imageGallery.map(image => image.key), images.map(image => image.key));
    return { id, name: row.name, category: 'attraction', intro: '排行摄影试点 · 来源及顺序来自真实导入结果',
      reservation: 'none', sourceLinks: [], coverUrl: `/media/${row.payload.coverImage}`,
      coverAttribution: row.payload.imageGallery[0].attribution,
      photos: row.payload.imageGallery.map(image => ({ url: `/media/${image.key}`, attribution: image.attribution })) };
  });
  assert.equal(overview.reduce((sum, poi) => sum + poi.photos.length, 0), 8);
  const trip = { id: 'ranked-photos-preview', title: '北京摄影图库验收', destination: '北京', startDate: '2026-10-01',
    partySize: 2, preferences: [], budgetLevel: '舒适', totalBudget: 0, extraNotes: '', createdAt: 0, updatedAt: 0,
    meta: { usedXhs: true, reviewNotes: [] }, overview,
    days: [{ id: 'preview-day', dayIndex: 1, title: '精选照片预览', legs: [], activities: overview.map((poi, index) => ({
      id: `a${index}`, name: poi.name, category: '文化', description: '仅用于查看本次精选照片；可点击图片切换备选。',
      lat: 0, lng: 0, startTime: '', endTime: '', sourceNotes: [],
    })) }],
  };
  await writeFile(path.join(here, 'preview/trip.json'), JSON.stringify(trip));
  console.log('真实导出→隔离数据库导入通过：4 个景点、8 张照片，顺序与来源完整');
} finally {
  await client.end();
  await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
  await admin.end();
}
