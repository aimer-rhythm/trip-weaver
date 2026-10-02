import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createPhotoReviewQueue } from '../integrations/photoReviewQueue';
import { reviewFirstLookup } from '../integrations/reviewedPhotos';

test('缺图查询不等待入队/审图，已有图片不入队', async () => {
  let calls = 0;
  const lookup = reviewFirstLookup(async () => null, async () => { calls++; await new Promise(() => {}); });
  assert.equal(await lookup('故宫'), null);
  assert.equal(calls, 1);
  const hit = reviewFirstLookup(async () => ({ coverUrl: '/media/known.webp' }), async () => { throw new Error('不应入队'); });
  assert.equal((await hit('故宫'))?.coverUrl, '/media/known.webp');
});
test('跨请求去重、队列重建恢复、串行执行与每日有界处理', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'photo-queue-'));
  let at = 1_800_000_000_000, calls = 0;
  try {
    const first = createPhotoReviewQueue({ dataRoot: root, now: () => at, run: async () => {} });
    const queued = await Promise.all([first.enqueue('北京', '故宫'), first.enqueue('北京', '故宫')]);
    assert.deepEqual(queued, [true, false]);
    await first.stop();
    const restarted = createPhotoReviewQueue({ dataRoot: root, now: () => at, dailyLimit: 1, run: async () => { calls++; } });
    await Promise.all([restarted.tick(), restarted.tick()]);
    assert.equal(calls, 1);
    assert.equal((await restarted.jobs())[0]?.state, 'done');
    assert.equal(await restarted.enqueue('北京', '故宫'), false);
    await restarted.enqueue('北京', '天坛');
    await restarted.tick(); assert.equal(calls, 1);
    at += 86400001;
    await restarted.tick(); assert.equal(calls, 2);
    await restarted.stop();
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('失败有退避，最多三次；不会因同地连续生成绕过退避', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'photo-queue-fail-'));
  let at = 1_800_000_000_000, calls = 0;
  const queue = createPhotoReviewQueue({ dataRoot: root, dailyLimit: 1, now: () => at, run: async () => { calls++; throw new Error('model unavailable'); } });
  try {
    await queue.enqueue('北京', '故宫'); await queue.tick();
    assert.equal(await queue.enqueue('北京', '故宫'), false);
    await queue.tick(); assert.equal(calls, 1);
    at += 1800001; await queue.tick(); assert.equal(calls, 2);
    at += 3600001; await queue.tick(); assert.equal(calls, 3);
    at += 5400001; await queue.tick(); assert.equal(calls, 3);
    assert.equal(await queue.retryNow('北京', '故宫'), false, '手动重试也不能绕过三次上限');
    assert.equal((await queue.jobs())[0]?.state, 'failed');
  } finally { await queue.stop(); await rm(root, { recursive: true, force: true }); }
});
