import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { reviewPhotoCandidates, type PhotoCandidate, type PhotoCollectionConfig } from '../integrations/photoCollection';
import { createReviewedCoverLookup, type VisualReview } from '../integrations/reviewedPhotos';
const config: PhotoCollectionConfig = { baseUrl: 'https://review.example/v1', apiKey: 'test', model: 'vision', pexelsKey: '', pixabayKey: '', unsplashKey: '' };
const review: VisualReview = { identity: 'match', evidence: '可辨认本景点建筑', singlePhoto: true, clear: true,
  representative: 'strong', composition: 'strong', light: 'adequate', obstruction: false, unrelatedPortrait: false, view: '正面-日景', reason: '主体清晰、无明显遮挡' };
test('真实图片输入、审核缓存按地点/模型隔离、未知不入选、失败不写空覆盖', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'photo-collect-'));
  let calls = 0;
  try {
    await mkdir(path.join(root, 'media/photography'), { recursive: true });
    await writeFile(path.join(root, 'media/photography/pexels-1.webp'), Buffer.from('RIFF0000WEBPfixture'));
    const candidate: PhotoCandidate = { photo: { url: '/media/photography/pexels-1.webp', attribution: { source: 'pexels', photographer: '作者', sourceUrl: 'https://www.pexels.com/photo/1/', license: 'Pexels License', licenseUrl: 'https://www.pexels.com/license/', changes: '原尺寸' } }, evidence: '来源指出北京故宫，仍须看图判断' };
    const options = { dataRoot: root, signal: new AbortController().signal,
      review: async (_c: PhotoCollectionConfig, _city: string, name: string, _p: PhotoCandidate, image: string) => {
        calls++; assert.match(image, /^data:image\/webp;base64,/);
        return { ...review, identity: name === '故宫' ? 'match' as const : 'unknown' as const };
      } };
    await reviewPhotoCandidates('北京', '故宫', [candidate], config, options);
    assert.ok(await createReviewedCoverLookup('北京', { dataRoot: root })('故宫'));
    await reviewPhotoCandidates('北京', '故宫', [candidate], config, options); assert.equal(calls, 1);
    await reviewPhotoCandidates('北京', '景山', [candidate], config, options); assert.equal(calls, 2);
    assert.equal(await createReviewedCoverLookup('北京', { dataRoot: root })('景山'), null);
    await assert.rejects(reviewPhotoCandidates('北京', '故宫', [candidate], { ...config, model: 'new-vision' }, { ...options, review: async () => { throw new Error('unavailable'); } }));
    assert.ok(await createReviewedCoverLookup('北京', { dataRoot: root })('故宫'));
    assert.equal((await readdir(path.join(root, 'photo-store/visual-reviews'))).length, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});
