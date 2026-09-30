// 本任务的单一验收行程：备份后只更新照片字段，CAS 防止覆盖用户同时编辑。
import '../../../../apps/server/src/lib/proxy.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { Value } from '@sinclair/typebox/value';
import { TripSchema, type PoiPhoto } from '@tripweaver/shared';
import { createCuratedCoverLookup } from '../../../../apps/server/src/integrations/curatedPhotos.ts';
import { readPhotoSelection, saveRemotePhoto, writePhotoSelection } from '../../../../apps/server/src/integrations/photoStore.ts';

const id = '5dee10b5-b395-48cd-8fb9-470d4b9e4280';
const originalId = '0552c0b3-6446-48b9-bf4b-9a11699ce669';
const out = path.resolve('.trellis/tasks/09-29-hangzhou-image-diagnosis/research/photo-verification/applied-gallery');
await fs.mkdir(out, { recursive: true });
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const row = (await client.query('SELECT t.user_id,t.data FROM trips t JOIN trips original ON original.id=$2 AND original.user_id=t.user_id WHERE t.id=$1', [id, originalId])).rows[0];
  assert.ok(row, '本任务的验收行程及原归属必须存在');
  const before: unknown = row.data;
  assert.ok(Value.Check(TripSchema, before), '原行程必须通过当前兼容schema');
  const next = structuredClone(before);
  const lookup = createCuratedCoverLookup(next.destination);
  const changes = [];
  for (const poi of next.overview ?? []) {
    if (poi.category !== 'attraction') continue;
    const old = { coverUrl: poi.coverUrl, coverAttribution: poi.coverAttribution, photos: poi.photos };
    const curated = await lookup(poi.name);
    if (curated) Object.assign(poi, curated);
    else if (poi.name === '断桥残雪' && poi.coverUrl === '/media/photography/commons-110356498.webp') {
      // 普通游客照已撤回；复用上游已导入的断桥夕照，竖版保留完整构图。
      const url = '/media/xhs/杭州/072594881c58508fb7b76c320f3c8c20/00.webp';
      await fs.access(path.resolve('data', url.slice(1)));
      poi.coverUrl = url; poi.photos = [{ url }]; delete poi.coverAttribution;
    }
    else if (poi.coverUrl?.startsWith('https://images.pexels.com/')) {
      const saved = await readPhotoSelection(next.destination, poi.name);
      if (saved?.[0]) {
        poi.coverUrl = saved[0].url; poi.coverAttribution = saved[0].attribution; poi.photos = saved;
      } else {
      const photoId = new URL(poi.coverUrl).pathname.match(/^\/photos\/(\d+)\//)?.[1];
      let selected: PoiPhoto = { url: poi.coverUrl, attribution: poi.coverAttribution };
      if (!selected.attribution && photoId && process.env.PEXELS_API_KEY) {
        const response = await fetch(`https://api.pexels.com/v1/photos/${photoId}`, { headers: { Authorization: process.env.PEXELS_API_KEY }, signal: AbortSignal.timeout(8000) });
        assert.equal(response.status, 200, '旧入选图的作者信息读取失败');
        const metadata = await response.json();
        assert.equal(String(metadata.id), photoId);
        assert.equal(typeof metadata.photographer, 'string');
        selected = { url: metadata.src.large2x || poi.coverUrl, attribution: { source: 'pexels', photographer: metadata.photographer,
          sourceUrl: metadata.url, license: 'Pexels License', licenseUrl: 'https://www.pexels.com/license/', changes: '已保存图源提供的尺寸版本，未另行裁切' } };
      }
      const local = await saveRemotePhoto(selected);
      assert.ok(local, `${poi.name}外链保存失败`);
      poi.coverUrl = local.url; poi.coverAttribution = local.attribution; poi.photos = [local];
      await writePhotoSelection(next.destination, poi.name, [local]);
      }
    }
    if (JSON.stringify(old) !== JSON.stringify({ coverUrl: poi.coverUrl, coverAttribution: poi.coverAttribution, photos: poi.photos })) {
      changes.push({ name: poi.name, before: old, after: { coverUrl: poi.coverUrl, coverAttribution: poi.coverAttribution, photos: poi.photos } });
    }
  }
  assert.ok(Value.Check(TripSchema, next));
  assert.deepEqual(next.days, before.days, '活动、路线与时间不变');
  const report = { tripId: id, changes, applied: false };
  await fs.writeFile(path.join(out, 'plan.json'), JSON.stringify(report, null, 2));
  if (process.argv.includes('--apply') && changes.length) {
    const stamp = Date.now();
    await fs.writeFile(path.join(out, `before-${stamp}.json`), JSON.stringify(before, null, 2), { flag: 'wx' });
    next.updatedAt = stamp;
    const result = await client.query('UPDATE trips SET data=$1,updated_at=$2 WHERE id=$3 AND user_id=$4 AND data=$5::jsonb RETURNING id', [next, new Date(stamp), id, row.user_id, before]);
    assert.equal(result.rowCount, 1, '行程被同时编辑，请重新核对后应用');
    report.applied = true;
    await fs.writeFile(path.join(out, 'result.json'), JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify({ tripId: id, applied: report.applied, changes: changes.map(c => ({ name: c.name, photos: c.after.photos?.length ?? 1, cover: c.after.coverUrl })) }));
} finally { await client.end(); }
