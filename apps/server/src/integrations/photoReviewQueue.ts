// 单实例持久后台队列。入队仅写小文件；串行worker绝不由行程等待。
import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { dataStore } from '../lib/dataStore';
import type { MediaStore } from '../lib/mediaStore';
import { createSerialQueue } from '../lib/serialQueue';
import { DAY } from './stockPhotoSupport';
import { PHOTO_REVIEW_VERSION, reviewDigest, reviewName } from './reviewedPhotos';
import { readPhotoJson, writePhotoJson } from './photoReviewIO';
import { DEFAULT_PHOTO_REVIEW_DAILY_PLACES } from './photoReviewPolicy';

const JobSchema = Type.Object({
  version: Type.Literal(PHOTO_REVIEW_VERSION), city: Type.String({ minLength: 1, maxLength: 80 }),
  name: Type.String({ minLength: 1, maxLength: 120 }),
  state: Type.Union([Type.Literal('queued'), Type.Literal('running'), Type.Literal('done'), Type.Literal('failed')]),
  attempts: Type.Integer({ minimum: 0, maximum: 3 }), nextAt: Type.Number(), updatedAt: Type.Number(),
  lastStartedAt: Type.Number(),
  // 额度计数只认首次启动时刻，写一次不再变；缺失时回退 lastStartedAt（旧文件无此字段）。
  countedAt: Type.Optional(Type.Number()),
  priority: Type.Optional(Type.Union([Type.Literal('background'), Type.Literal('trip')])),
});
export type PhotoReviewJob = Static<typeof JobSchema>;
export function createPhotoReviewQueue(options: {
  run: (job: PhotoReviewJob, signal: AbortSignal) => Promise<void>;
  store?: MediaStore; dailyLimit?: number; now?: () => number;
  warn?: (message: string) => void;
}) {
  const store = options.store ?? dataStore, prefix = 'photo-store/review-jobs';
  const now = options.now ?? Date.now, serialize = createSerialQueue(0);
  const fileFor = (city: string, name: string) => `${prefix}/${reviewDigest(JSON.stringify([PHOTO_REVIEW_VERSION, reviewName(city), reviewName(name)]))}.json`;
  let active: Promise<void> | undefined, timer: ReturnType<typeof setInterval> | undefined, stopped = false, saturated = false;
  const controller = new AbortController();
  // 额度按“首次启动”计：重试既不占用额度，也不能把24h窗口向后推移。
  const counted = (job: PhotoReviewJob) => job.countedAt ?? job.lastStartedAt;
  async function jobs(): Promise<PhotoReviewJob[]> {
    let objects: { key: string; size: number }[];
    try { objects = await store.list(prefix); } catch { return []; }
    const rows = await Promise.all(objects
      .filter(object => /^[a-f0-9]{64}\.json$/.test(object.key.slice(object.key.lastIndexOf('/') + 1)))
      .map(object => readPhotoJson(object.key, 8192, store)));
    return rows.filter((v): v is PhotoReviewJob => Value.Check(JobSchema, v));
  }
  async function enqueue(city: string, name: string, priority: 'background' | 'trip' = 'background'): Promise<boolean> {
    return serialize(async () => {
      const file = fileFor(city, name), previous = await readPhotoJson(file, 8192, store);
      if (Value.Check(JobSchema, previous) && (previous.state === 'queued' || previous.state === 'running' || now() - previous.updatedAt < DAY)) {
        // 提升等待任务，不修改退避时间/尝试数/运行租约；旧文件无 priority 按普通任务处理。
        if (priority === 'trip' && previous.priority !== 'trip' && (previous.state === 'queued' || previous.state === 'failed')) {
          await writePhotoJson(file, { ...previous, priority }, store);
        }
        return false;
      }
      // 有界积压；任务中只保存公共地点名，不保存用户/行程/个人密钥。
      if ((await jobs()).filter(j => j.state === 'queued' || j.state === 'running').length >= 200) return false;
      const job: PhotoReviewJob = { version: PHOTO_REVIEW_VERSION, city: city.trim(), name: name.trim(), priority, state: 'queued', attempts: 0, nextAt: now(), updatedAt: now(), lastStartedAt: 0 };
      if (!Value.Check(JobSchema, job)) return false;
      await writePhotoJson(file, job, store);
      return true;
    });
  }
  async function retryNow(city: string, name: string): Promise<boolean> {
    return serialize(async () => {
      const file = fileFor(city, name), job = await readPhotoJson(file, 8192, store);
      if (!Value.Check(JobSchema, job) || job.state !== 'failed' || job.attempts >= 3) return false;
      job.nextAt = now();
      await writePhotoJson(file, job, store);
      return true;
    });
  }
  function tick(): Promise<void> {
    if (active) return active;
    if (stopped) return Promise.resolve();
    active = (async () => {
      const job = await serialize(async () => {
        const all = await jobs();
        // 回收进程中断遗留的 running：租约超时即视为本次尝试失败。
        // 不回收的话，attempts 已满的任务会被下面的 `attempts < 3` 永久排除，卡死在 running 不再重试。
        let recovered = 0;
        for (const stale of all) {
          if (stale.state !== 'running' || now() - stale.updatedAt <= 15 * 60_000) continue;
          stale.state = stale.attempts >= 3 ? 'failed' : 'queued';
          stale.nextAt = stale.state === 'failed' ? now() + 30 * 60_000 * stale.attempts : now();
          stale.updatedAt = now();
          await writePhotoJson(fileFor(stale.city, stale.name), stale, store);
          recovered += 1;
        }
        if (recovered > 0) options.warn?.(`[photo-review] 回收 ${recovered} 个进程中断的任务`);
        const limit = options.dailyLimit ?? DEFAULT_PHOTO_REVIEW_DAILY_PLACES;
        const used = all.filter(j => counted(j) > now() - DAY).length;
        const capacity = used < limit;
        // 饱和期只提醒一次；容量恢复后复位，便于下一次耗尽再次可见。
        if (capacity) saturated = false;
        else if (!saturated) {
          saturated = true;
          options.warn?.(`[photo-review] 滚动24h额度已满 ${used}/${limit}，${all.filter(j => j.attempts === 0).length} 个新地点等待额度释放`);
        }
        // running来自上次进程中断；本实例串行tick，租约超时后可恢复。额度耗尽时只放行重试，绝不放进新任务。
        const next = all.filter(j => j.attempts < 3 && j.nextAt <= now() && (capacity || j.attempts > 0) &&
          (j.state === 'queued' || j.state === 'failed' || j.state === 'running' && now() - j.updatedAt > 15 * 60_000))
          .sort((a, b) => Number(b.priority === 'trip') - Number(a.priority === 'trip') || a.nextAt - b.nextAt)[0];
        if (!next) return undefined;
        next.state = 'running'; next.attempts++; next.updatedAt = now(); next.lastStartedAt = now();
        next.countedAt ??= now();
        await writePhotoJson(fileFor(next.city, next.name), next, store);
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
      await serialize(() => writePhotoJson(fileFor(job.city, job.name), job, store));
    })().catch(() => { options.warn?.('[photo-review] 队列读写失败'); }).finally(() => { active = undefined; });
    return active;
  }
  return {
    enqueue, retryNow, tick, jobs,
    start() { if (!timer && !stopped) { timer = setInterval(() => { void tick(); }, 15_000); timer.unref(); void tick(); } },
    async stop() { stopped = true; if (timer) clearInterval(timer); controller.abort(); await active; },
  };
}
