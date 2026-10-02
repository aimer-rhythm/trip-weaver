import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  PHOTO_REVIEW_VERSION, createReviewedCoverLookup, eligibleReview, rankReviewedPhotos,
  reviewDigest, writeReviewedCatalog, type ReviewedPhoto, type VisualReview,
} from '../integrations/reviewedPhotos';

const review: VisualReview = {
  identity: 'match', evidence: '目标建筑主体与作品地点一致', singlePhoto: true, clear: true,
  representative: 'strong', composition: 'strong', light: 'adequate',
  obstruction: false, unrelatedPortrait: false, view: '正面日景', reason: '主体结构清楚',
};
function entry(id: string, override: Partial<VisualReview> = {}): ReviewedPhoto {
  return { photo: { url: `/media/remote-photos/${id}.jpg`, attribution: {
    source: 'pexels', photographer: '作者', sourceUrl: `https://www.pexels.com/photo/${id}/`,
    license: 'Pexels License', licenseUrl: 'https://www.pexels.com/license/', changes: '尺寸版本',
  } }, sha256: reviewDigest(id), review: { ...review, ...override }, model: 'test-vision',
  reviewedAt: '2026-10-01T00:00:00Z', evidence: '作品页面地点说明' };
}
test('地点、代表性先于光线；未知地点、遮挡和人物主角不能通过', () => {
  const representative = entry('landmark', { light: 'weak' });
  const sunset = entry('sunset', { representative: 'adequate', light: 'strong' });
  const wrong = entry('wrong', { identity: 'mismatch', light: 'strong' });
  assert.deepEqual(rankReviewedPhotos([sunset, wrong, representative]), [representative, sunset]);
  for (const change of [{ identity: 'unknown' as const }, { representative: 'weak' as const },
    { unrelatedPortrait: true }, { obstruction: true }, { singlePhoto: false }, { clear: false }]) {
    assert.equal(eligibleReview({ ...review, ...change }), false);
  }
});
test('读新版跨源图库，跳过损坏文件与重复视角；旧版和同城近邻不绕过审核', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'reviewed-photos-'));
  try {
    await mkdir(path.join(root, 'media/remote-photos'), { recursive: true });
    const bytes = Buffer.from([255, 216, 255, 1, 2, 3]);
    const first = entry('first'); first.sha256 = reviewDigest(bytes);
    await writeFile(path.join(root, first.photo.url.slice(1)), bytes);
    const broken = entry('broken', { light: 'strong' });
    await writeReviewedCatalog({ version: PHOTO_REVIEW_VERSION, city: '北京', name: '故宫', aliases: ['故宫博物院'], entries: [broken, first] }, root);
    const lookup = createReviewedCoverLookup('北京', { dataRoot: root });
    assert.equal((await lookup('故宫博物院（午后参观）'))?.coverUrl, first.photo.url);
    assert.equal(await lookup('景山公园'), null);
    assert.equal(await createReviewedCoverLookup('南京', { dataRoot: root })('故宫'), null);
    const old = createReviewedCoverLookup('北京', { dataRoot: root, load: async () => [{ version: 'old', city: '北京', name: '故宫', entries: [first] }] });
    assert.equal(await old('故宫'), null);
    const ambiguous = createReviewedCoverLookup('北京', { dataRoot: root, load: async () => ['甲', '乙'].map(name => ({ version: PHOTO_REVIEW_VERSION, city: '北京', name, aliases: ['故宫'], entries: [first] })) });
    assert.equal(await ambiguous('故宫'), null);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('Unsplash只采用最终候选；失败补位，同任务重复读取不重复上报', async () => {
  const make = (id: string, view: string) => {
    const e = entry(id, { view });
    e.photo = { url: `https://images.unsplash.com/${id}?ixid=original`, attribution: {
      source: 'unsplash', photographer: '作者', sourceUrl: `https://unsplash.com/photos/${id}?utm_source=tripweaver&utm_medium=referral`,
      photographerUrl: 'https://unsplash.com/@author?utm_source=tripweaver&utm_medium=referral',
      license: 'Unsplash License', licenseUrl: 'https://unsplash.com/license?utm_source=tripweaver&utm_medium=referral', changes: '官方版本',
    } };
    e.downloadLocation = `https://api.unsplash.com/photos/${id}/download?ixid=original`;
    return e;
  };
  const entries = [make('a', '日景'), make('b', '夜景'), make('c', '细节'), make('d', '内景'), make('e', '日景')];
  const calls: string[] = [];
  const lookup = createReviewedCoverLookup('北京', {
    load: async () => [{ version: PHOTO_REVIEW_VERSION, city: '北京', name: '故宫', aliases: [], entries }],
    adoptUnsplash: async e => { calls.push(e.photo.url); return true; },
  });
  const result = await lookup('故宫');
  assert.equal(result?.photos?.length, 3);
  assert.equal(calls.length, 3);
  assert.deepEqual(await lookup('故宫'), result);
  assert.equal(calls.length, 3);
  const failed = createReviewedCoverLookup('北京', { load: async () => [{ version: PHOTO_REVIEW_VERSION, city: '北京', name: '故宫', aliases: [], entries }], adoptUnsplash: async () => false });
  assert.equal(await failed('故宫'), null);
});
