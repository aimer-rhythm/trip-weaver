// 单实例持久后台队列。入队仅写小文件；串行worker绝不由行程等待。
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { createSerialQueue } from '../lib/serialQueue';
import { PHOTO_DATA, DAY } from './stockPhotoSupport';
import { PHOTO_REVIEW_VERSION, reviewDigest, reviewName } from './reviewedPhotos';
import { readPhotoJson, writePhotoJson } from './photoReviewIO';

const JobSchema = Type.Object({
  version: Type.Literal(PHOTO_REVIEW_VERSION), city: Type.String({ minLength: 1, maxLength: 80 }),
  name: Type.String({ minLength: 1, maxLength: 120 }),
  state: Type.Union([Type.Literal('queued'), Type.Literal('running'), Type.Literal('done'), Type.Literal('failed')]),
  attempts: Type.Integer({ minimum: 0, maximum: 3 }), nextAt: Type.Number(), updatedAt: Type.Number(),
  lastStartedAt: Type.Number(),
});
export type PhotoReviewJob = Static<typeof JobSchema>;
export function createPhotoReviewQueue(options: {
  run: (job: PhotoReviewJob, signal: AbortSignal) => Promise<void>;
  dataRoot?: string; dailyLimit?: number; now?: () => number;
  warn?: (message: string) => void;
}) {
  const root = options.dataRoot ?? PHOTO_DATA, dir = path.join(root, 'photo-store/review-jobs');
  const now = options.now ?? Date.now, serialize = createSerialQueue(0);
  const fileFor = (city: string, name: string) => path.join(dir, reviewDigest(JSON.stringify([PHOTO_REVIEW_VERSION, reviewName(city), reviewName(name)])) + '.json');
  let active: Promise<void> | undefined, timer: ReturnType<typeof setInterval> | undefined, stopped = false;
  const controller = new AbortController();
  async function jobs(): Promise<PhotoReviewJob[]> {
    let files: string[];
    try { files = await readdir(dir); } catch { return []; }
    const rows = await Promise.all(files.filter(f => /^[a-f0-9]{64}\.json$/.test(f)).map(f => readPhotoJson(path.join(dir, f), 8192)));
    return rows.filter((v): v is PhotoReviewJob => Value.Check(JobSchema, v));
  }
  async function enqueue(city: string, name: string): Promise<boolean> {
    return serialize(async () => {
      const file = fileFor(city, name), previous = await readPhotoJson(file, 8192);
      if (Value.Check(JobSchema, previous) && (previous.state === 'queued' || previous.state === 'running' || now() - previous.updatedAt < DAY)) return false;
      // 有界积压；任务中只保存公共地点名，不保存用户/行程/个人密钥。
      if ((await jobs()).filter(j => j.state === 'queued' || j.state === 'running').length >= 200) return false;
      const job: PhotoReviewJob = { version: PHOTO_REVIEW_VERSION, city: city.trim(), name: name.trim(), state: 'queued', attempts: 0, nextAt: now(), updatedAt: now(), lastStartedAt: 0 };
      if (!Value.Check(JobSchema, job)) return false;
      await writePhotoJson(file, job);
      return true;
    });
  }
  async function retryNow(city: string, name: string): Promise<boolean> {
    return serialize(async () => {
      const file = fileFor(city, name), job = await readPhotoJson(file, 8192);
      if (!Value.Check(JobSchema, job) || job.state !== 'failed' || job.attempts >= 3) return false;
      job.nextAt = now();
      await writePhotoJson(file, job);
      return true;
    });
  }
  function tick(): Promise<void> {
    if (active) return active;
    if (stopped) return Promise.resolve();
    active = (async () => {
      const job = await serialize(async () => {
        const all = await jobs();
        const capacity = all.filter(j => j.lastStartedAt > now() - DAY).length < (options.dailyLimit ?? 10);
        // running来自上次进程中断；本实例串行tick，租约超时后可恢复。
        const next = all.filter(j => j.attempts < 3 && j.nextAt <= now() && (capacity || j.lastStartedAt > now() - DAY) &&
          (j.state === 'queued' || j.state === 'failed' || j.state === 'running' && now() - j.updatedAt > 15 * 60_000))
          .sort((a, b) => a.nextAt - b.nextAt)[0];
        if (!next) return undefined;
        next.state = 'running'; next.attempts++; next.updatedAt = now(); next.lastStartedAt = now();
        await writePhotoJson(fileFor(next.city, next.name), next);
        return next;
      });
      if (!job || stopped) return;
      try {
        await options.run(job, controller.signal);
        job.state = 'done'; job.nextAt = now() + DAY;
      } catch {
        job.state = 'failed'; job.nextAt = now() + 30 * 60_000 * job.attempts;
        options.warn?.('[photo-review] 后台补图未完成，已保留重试状态');
      }
      job.updatedAt = now();
      await serialize(() => writePhotoJson(fileFor(job.city, job.name), job));
    })().catch(() => { options.warn?.('[photo-review] 队列读写失败'); }).finally(() => { active = undefined; });
    return active;
  }
  return {
    enqueue, retryNow, tick, jobs,
    start() { if (!timer && !stopped) { timer = setInterval(() => { void tick(); }, 15_000); timer.unref(); void tick(); } },
    async stop() { stopped = true; if (timer) clearInterval(timer); controller.abort(); await active; },
  };
}
