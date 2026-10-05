import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createPhotoReviewQueue } from '../integrations/photoReviewQueue';
import { reviewFirstLookup } from '../integrations/reviewedPhotos';

test('默认滚动预算允许50个地点，第51个等待窗口释放', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'photo-budget-'));
  let at = 1_800_000_000_000, calls = 0;
  const queue = createPhotoReviewQueue({ dataRoot: root, now: () => at, run: async () => { calls++; } });
  try {
    for (let i = 0; i < 51; i++) await queue.enqueue('杭州', `景点${i}`);
    for (let i = 0; i < 51; i++) await queue.tick();
    assert.equal(calls, 50);
    at += 86_400_001;
    await queue.tick();
    assert.equal(calls, 51);
  } finally { await queue.stop(); await rm(root, { recursive: true, force: true }); }
});

test('旧队列任务提升行程优先级并跨重启保留，不改变退避与尝试数', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'photo-priority-'));
  const at = 1_800_000_000_000, seen: string[] = [];
  const first = createPhotoReviewQueue({ dataRoot: root, now: () => at, run: async () => {} });
  try {
    await first.enqueue('北京', '预热');
    await first.enqueue('杭州', '西湖');
    const dir = path.join(root, 'photo-store/review-jobs');
    for (const f of await readdir(dir)) {
      const file = path.join(dir, f), job = JSON.parse(await readFile(file, 'utf8'));
      delete job.priority;
      await writeFile(file, JSON.stringify(job));
    }
    const before = (await first.jobs()).find(j => j.name === '西湖')!;
    assert.equal(await first.enqueue('杭州', '西湖', 'trip'), false);
    assert.deepEqual((await first.jobs()).find(j => j.name === '西湖'), { ...before, priority: 'trip' });
    await first.stop();
    const restarted = createPhotoReviewQueue({ dataRoot: root, dailyLimit: 1, now: () => at,
      run: async job => { seen.push(job.name); throw new Error('失败'); } });
    try {
      await restarted.tick();
      assert.deepEqual(seen, ['西湖']);
      const failed = (await restarted.jobs()).find(j => j.name === '西湖');
      await restarted.enqueue('杭州', '西湖', 'trip');
      await restarted.tick();
      assert.deepEqual(seen, ['西湖']);
      assert.deepEqual((await restarted.jobs()).find(j => j.name === '西湖'), failed);
    } finally { await restarted.stop(); }
  } finally { await first.stop(); await rm(root, { recursive: true, force: true }); }
});

test('额度耗尽的窗口不被重试刷新，新地点等窗口滑出即可启动', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'photo-retry-window-'));
  let at = 1_800_000_000_000;
  const seen: string[] = [];
  const queue = createPhotoReviewQueue({ dataRoot: root, dailyLimit: 1, now: () => at,
    run: async job => { seen.push(job.name); if (job.name === '甲') throw new Error('源不可用'); } });
  try {
    await queue.enqueue('杭州', '甲');
    await queue.enqueue('杭州', '乙');
    await queue.tick();
    assert.deepEqual(seen, ['甲']);
    at += 23 * 3600_000;
    await queue.tick();
    assert.deepEqual(seen, ['甲', '甲'], '窗口末尾允许重试，但不放进新任务');
    at += 3600_001;
    await queue.tick();
    assert.deepEqual(seen, ['甲', '甲', '乙'], '重试不得把窗口向后推移，首次启动满24h后新地点应能启动');
  } finally { await queue.stop(); await rm(root, { recursive: true, force: true }); }
});

test('重试不占用额度，也不刷新额度计数时间', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'photo-retry-count-'));
  let at = 1_800_000_000_000;
  const start = at;
  const queue = createPhotoReviewQueue({ dataRoot: root, dailyLimit: 1, now: () => at, run: async () => { throw new Error('源不可用'); } });
  try {
    await queue.enqueue('杭州', '甲');
    await queue.tick();
    const first = (await queue.jobs())[0]!;
    assert.equal(first.countedAt, start);
    at += 30 * 60_000 + 1;
    await queue.tick();
    const retried = (await queue.jobs())[0]!;
    assert.equal(retried.attempts, 2);
    assert.equal(retried.lastStartedAt, at, 'lastStartedAt 仍反映真实最后启动时间');
    assert.equal(retried.countedAt, start, '额度计数时间只写一次');
  } finally { await queue.stop(); await rm(root, { recursive: true, force: true }); }
});

test('额度耗尽只提醒一次，容量恢复后再次耗尽重新提醒', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'photo-warn-'));
  let at = 1_800_000_000_000;
  const warnings: string[] = [];
  const queue = createPhotoReviewQueue({ dataRoot: root, dailyLimit: 1, now: () => at,
    run: async () => {}, warn: message => warnings.push(message) });
  const saturated = () => warnings.filter(m => m.includes('额度已满'));
  try {
    await queue.enqueue('杭州', '甲');
    await queue.enqueue('杭州', '乙');
    await queue.tick();
    await queue.tick();
    await queue.tick();
    assert.equal(saturated().length, 1);
    assert.match(saturated()[0]!, /^\[photo-review\]/);
    assert.match(saturated()[0]!, /1\/1/);
    assert.match(saturated()[0]!, /1 个新地点/);
    at += 86_400_001;
    await queue.tick();
    await queue.tick();
    assert.equal(saturated().length, 2, '容量恢复后再次耗尽应重新提醒');
  } finally { await queue.stop(); await rm(root, { recursive: true, force: true }); }
});

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
