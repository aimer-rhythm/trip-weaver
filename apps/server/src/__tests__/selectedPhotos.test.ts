import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Value } from '@sinclair/typebox/value';
import beijing from '../data/photography/beijing-selected.json';
import { createSelectedPhotoLibrary, selectedFirstLookup, SelectedLibrarySchema, type SelectedLibrary } from '../integrations/selectedPhotos';
import { createReviewedCoverLookup, PHOTO_REVIEW_VERSION, reviewDigest, type PhotoAsset, type ReviewedPhoto } from '../integrations/reviewedPhotos';

function asset(id: string): SelectedLibrary['places'][number]['photos'][number] {
  return { photo: { url: `/media/remote-photos/${id}.jpg`, attribution: {
    source: 'pexels', sourceUrl: `https://www.pexels.com/photo/${id}/`, photographer: '作者',
    license: 'Pexels License', licenseUrl: 'https://www.pexels.com/license/', changes: '尺寸版本',
  } }, sha256: reviewDigest(id), selectionKey: reviewDigest(id), identity: 'verified', evidence: '已选作品的建筑主体与来源记录相符' };
}
function library(photos: ReturnType<typeof asset>[] = []): SelectedLibrary {
  return { version: 1, city: '北京', snapshotId: 'user-snapshot', selectedAt: '2026-10-01',
    places: [{ name: '天坛公园', aliases: ['天坛'], photos, excluded: [] }] };
}
test('人工选图优先，只有一张也不混入模型图；损坏图片补位，别名共用结果', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'selected-photos-'));
  try {
    await mkdir(path.join(root, 'media/remote-photos'), { recursive: true });
    const bytes = Buffer.from([255, 216, 255, 7, 8, 9]);
    const chosen = asset('chosen'); chosen.sha256 = reviewDigest(bytes);
    await writeFile(path.join(root, chosen.photo.url.slice(1)), bytes);
    const selected = createSelectedPhotoLibrary('北京', { library: library([asset('missing'), chosen]), dataRoot: root });
    let fallbackCalls = 0, enqueues = 0;
    const lookup = selectedFirstLookup(selected, async () => { fallbackCalls++; return null; }, async () => { enqueues++; });
    assert.equal((await lookup('天坛'))?.coverUrl, chosen.photo.url);
    assert.equal((await lookup('天坛公园（上午）'))?.photos?.length, 1);
    assert.equal(fallbackCalls, 0);
    assert.equal(enqueues, 0);
    assert.equal(await createSelectedPhotoLibrary('南京', { library: library([chosen]), dataRoot: root }).coverFor('天坛'), null);
    assert.equal(await selected.coverFor('天坛和故宫'), null);
    await writeFile(path.join(root, chosen.photo.url.slice(1)), Buffer.from('changed'));
    const broken = createSelectedPhotoLibrary('北京', { library: library([chosen]), dataRoot: root });
    const seen: string[] = [];
    const missing = selectedFirstLookup(broken, async name => { seen.push(name); return null; }, async name => { seen.push(name); });
    assert.equal(await missing('天坛'), null);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(seen, ['天坛公园', '天坛公园']);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('同地点曾排除的作品不能从审核补图库回来，补位发生在三图截断之前', async () => {
  const data = library();
  const make = (id: string): ReviewedPhoto => ({ ...asset(id), provider: 'amap',
    photo: { url: `https://aos-comment.amap.com/poi/${id}.jpg` },
    model: 'test', reviewedAt: '2026-10-02', evidence: 'test', review: {
      identity: 'match', evidence: '来源与主体一致', singlePhoto: true, clear: true,
      representative: 'strong', composition: 'strong', light: 'strong', obstruction: false,
      unrelatedPortrait: false, view: id, reason: '主体清楚',
    } });
  const entries = ['rejected', 'held', 'valid', 'last'].map(make);
  data.places[0]!.excluded = entries.slice(0, 2).map(e => ({ url: e.photo.url, sourceUrl: '', sha256: e.sha256 }));
  const selected = createSelectedPhotoLibrary('北京', { library: data });
  const reviewed = createReviewedCoverLookup('北京', { acceptPhoto: selected.acceptSupplement,
    load: async () => [{ version: PHOTO_REVIEW_VERSION, city: '北京', name: '天坛公园', aliases: [], entries }] });
  const result = await selectedFirstLookup(selected, reviewed, async () => assert.fail('已有补图不应入队'))('天坛');
  assert.deepEqual(new Set(result?.photos?.map(p => p.url)), new Set(entries.slice(2).map(e => e.photo.url)));
  assert.equal(selected.acceptSupplement('景山', entries[0]!), true, '反馈只对目标景点生效');
  const external = asset('work');
  data.places[0]!.excluded.push({ url: '', sha256: '', sourceUrl: external.photo.attribution!.sourceUrl + '?utm_source=old' });
  assert.equal(createSelectedPhotoLibrary('北京', { library: data }).acceptSupplement('天坛', external), false);
});
test('人工选图保留稳定顺序及三图上限；Unsplash采用失败补位、别名不重复上报', async () => {
  const photos = ['a', 'b', 'c', 'd', 'e'].map(id => {
    const p = asset(id);
    p.photo = { url: `https://images.unsplash.com/${id}?ixid=original`, attribution: {
      source: 'unsplash', photographer: '作者', sourceUrl: `https://unsplash.com/photos/${id}?utm_source=tripweaver&utm_medium=referral`,
      photographerUrl: 'https://unsplash.com/@author?utm_source=tripweaver&utm_medium=referral',
      license: 'Unsplash License', licenseUrl: 'https://unsplash.com/license?utm_source=tripweaver&utm_medium=referral', changes: '官方图',
    } };
    p.downloadLocation = `https://api.unsplash.com/photos/${id}/download?ixid=original`;
    return p;
  });
  const calls: PhotoAsset[] = [];
  const selected = createSelectedPhotoLibrary('北京', { library: library(photos), adoptUnsplash: async p => { calls.push(p); return p !== photos[0]; } });
  const result = await selected.coverFor('天坛');
  assert.deepEqual(result?.photos?.map(p => p.url), photos.slice(1, 4).map(p => p.photo.url));
  assert.equal((await selected.coverFor('天坛公园'))?.coverUrl, photos[1]!.photo.url);
  assert.equal(calls.length, 4);
});
test('小红书同笔记不同照片不连带排除，明确图片URL和摘要仍生效', () => {
  const data = library();
  const sourceUrl = 'https://www.xiaohongshu.com/explore/shared-note';
  const rejected = asset('rejected-xhs');
  rejected.photo.attribution = { source: 'xhs', sourceUrl, photographer: '原笔记作者',
    license: '原导入授权状态', licenseUrl: sourceUrl, changes: '原图' };
  const sibling = { ...rejected, sha256: reviewDigest('another-image'),
    photo: { ...rejected.photo, url: '/media/xhs/another-image.webp' } };
  data.places[0]!.excluded.push({ url: rejected.photo.url, sha256: rejected.sha256, sourceUrl });
  const selected = createSelectedPhotoLibrary('北京', { library: data });
  assert.equal(selected.acceptSupplement('天坛', sibling), true);
  assert.equal(selected.acceptSupplement('天坛', rejected), false);
  assert.equal(selected.acceptSupplement('天坛', { ...sibling, sha256: rejected.sha256 }), false);
  assert.equal(selected.acceptSupplement('景山', rejected), true);
});
test('正式快照有来源追溯；显式别名不把长城段落、孔庙和国子监合并', () => {
  assert.ok(Value.Check(SelectedLibrarySchema, beijing));
  assert.equal(beijing.snapshotId, 'selection-1790858017388-0f757c8f-e438-4948-a879-da04c94d7a7f');
  assert.ok(beijing.places.some(p => p.name === '故宫博物院' && p.photos.length === 3));
  const selected = createSelectedPhotoLibrary('北京');
  assert.equal(selected.canonicalName('中国国家博物馆'), '国家博物馆');
  assert.equal(selected.canonicalName('八达岭'), '八达岭长城');
  assert.equal(selected.canonicalName('慕田峪'), '慕田峪长城');
  assert.equal(selected.canonicalName('孔庙'), '孔庙');
  assert.equal(selected.canonicalName('天安门城楼'), '天安门城楼');
  const conflicting = library();
  conflicting.places.push({ name: '另一景点', aliases: ['天坛'], photos: [], excluded: [] });
  assert.equal(createSelectedPhotoLibrary('北京', { library: conflicting }).canonicalName('天坛'), '天坛');
});
