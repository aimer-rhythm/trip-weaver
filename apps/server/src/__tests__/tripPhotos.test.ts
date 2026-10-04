import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Trip, ResearchPoi } from '@tripweaver/shared';
import { enrichTripPhotos } from '../services/tripPhotoService';
import { reviewFirstLookup } from '../integrations/reviewedPhotos';

const poi = (name: string, extra: Partial<ResearchPoi> = {}): ResearchPoi => ({
  id: name, name, category: 'attraction', intro: '', reservation: 'unknown', sourceLinks: [], ...extra,
});
const trip = (overview?: ResearchPoi[]): Trip => ({
  id: 'old-trip', title: '杭州', destination: '杭州', startDate: '', budgetLevel: '舒适', totalBudget: 0,
  preferences: [], partySize: 2, extraNotes: '', days: [], meta: { usedXhs: false, reviewNotes: [] },
  createdAt: 10, updatedAt: 20, ...(overview ? { overview } : {}),
});
test('只补缺图景点，保留已有图片、相册、署名及原行程快照', async () => {
  const original = trip([poi('西湖'), poi('已有', { coverUrl: '/media/existing.jpg' }),
    poi('相册', { photos: [{ url: '/media/gallery.jpg' }] }), poi('餐厅', { category: 'food' }), poi('西湖')]);
  const before = structuredClone(original), calls: string[] = [];
  const credit = { source: 'pexels' as const, photographer: '作者', sourceUrl: 'https://www.pexels.com/photo/1/',
    license: 'Pexels License', licenseUrl: 'https://www.pexels.com/license/', changes: '' };
  const photo = { url: '/media/reviewed.jpg', attribution: credit };
  const result = await enrichTripPhotos(original, async name => { calls.push(name); return {
    coverUrl: photo.url, coverAttribution: credit, photos: [photo],
  }; });
  assert.deepEqual(calls, ['西湖']);
  assert.deepEqual(original, before);
  assert.equal(result.overview?.[0]?.coverUrl, photo.url);
  assert.deepEqual(result.overview?.[0]?.photos, [photo]);
  assert.deepEqual(result.overview?.slice(1, 4), original.overview?.slice(1, 4));
  assert.equal(result.updatedAt, 20);
  assert.equal(result.days, original.days);
});
test('旧行程刷新后可获得新审核图；缺图不等待后台任务', async () => {
  const original = trip([poi('西湖')]);
  let ready = false, enqueued = 0;
  const lookup = reviewFirstLookup(async () => ready ? { coverUrl: '/media/ready.jpg' } : null,
    async () => { enqueued++; await new Promise(() => {}); });
  assert.equal((await enrichTripPhotos(original, lookup)).overview?.[0]?.coverUrl, undefined);
  assert.equal(enqueued, 1);
  ready = true;
  assert.equal((await enrichTripPhotos(original, lookup)).overview?.[0]?.coverUrl, '/media/ready.jpg');
  assert.equal(original.overview?.[0]?.coverUrl, undefined);
});
test('无概览的旧数据与查询失败仍可读取', async () => {
  const old = trip();
  assert.equal(await enrichTripPhotos(old, async () => { throw new Error('不应查询'); }), old);
  const original = trip([poi('西湖')]);
  assert.deepEqual(await enrichTripPhotos(original, async () => { throw new Error('unavailable'); }), original);
});
