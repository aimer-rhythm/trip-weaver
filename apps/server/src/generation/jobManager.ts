// 生成任务管理：内存任务表 + 512 条事件环形缓冲 + Last-Event-ID 重放 + 取消
// 单实例边界（架构 §7）：重启即丢任务 —— 路由层在启动时不做恢复，进行中任务由前端超时兜底
import { uid, type DataSourceKind, type GenerationEvent, type GenerationJobStatus, type GenerationJobView } from '@tripweaver/shared';

const RING_SIZE = 512;
const FINISHED_TTL_MS = 30 * 60 * 1000; // 终态任务保留 30 分钟供刷新恢复

export interface StoredEvent {
  id: number;
  event: GenerationEvent;
}

type Listener = (e: StoredEvent) => void;

export interface Job {
  id: string;
  userId: string;
  status: GenerationJobStatus;
  tripId: string | null;
  createdAt: number;
  abort: AbortController;
  events: StoredEvent[];
  nextEventId: number;
  listeners: Set<Listener>;
}

const jobs = new Map<string, Job>();
const runningByUser = new Map<string, string>();

export function getRunningJobId(userId: string): string | null {
  return runningByUser.get(userId) ?? null;
}

export function createJob(userId: string): Job {
  const job: Job = {
    id: uid(),
    userId,
    status: 'running',
    tripId: null,
    createdAt: Date.now(),
    abort: new AbortController(),
    events: [],
    nextEventId: 1,
    listeners: new Set(),
  };
  jobs.set(job.id, job);
  runningByUser.set(userId, job.id);
  return job;
}

export function getJob(jobId: string, userId: string): Job | null {
  const job = jobs.get(jobId);
  return job && job.userId === userId ? job : null;
}

export function jobView(job: Job): GenerationJobView {
  return { jobId: job.id, status: job.status, tripId: job.tripId, createdAt: job.createdAt };
}

export function emit(job: Job, event: GenerationEvent): void {
  const stored: StoredEvent = { id: job.nextEventId++, event };
  job.events.push(stored);
  if (job.events.length > RING_SIZE) job.events.splice(0, job.events.length - RING_SIZE);
  for (const listener of job.listeners) {
    try {
      listener(stored);
    } catch {
      job.listeners.delete(listener);   // 坏监听器（如已断开的 SSE）绝不能拖垮流水线
    }
  }
}

function finish(job: Job, status: GenerationJobStatus): void {
  job.status = status;
  if (runningByUser.get(job.userId) === job.id) runningByUser.delete(job.userId);
  setTimeout(() => jobs.delete(job.id), FINISHED_TTL_MS).unref?.();
}

export function completeJob(job: Job, tripId: string, dataSources: DataSourceKind[], reviewNotes: string[]): void {
  job.tripId = tripId;
  finish(job, 'done');
  // usedXhs 为旧前端兼容字段（小红书已移除，恒 false）
  emit(job, { type: 'job_done', tripId, usedXhs: false, dataSources, reviewNotes });
}

export function failJob(job: Job, message: string): void {
  finish(job, 'error');
  emit(job, { type: 'job_error', message });
}

export function cancelJob(job: Job): void {
  finish(job, 'cancelled');
  emit(job, { type: 'job_cancelled' });
}

/** 重放 afterId 之后的事件，再挂实时监听；返回退订函数 */
export function subscribe(job: Job, afterId: number, listener: Listener): () => void {
  for (const stored of job.events) {
    if (stored.id > afterId) listener(stored);
  }
  job.listeners.add(listener);
  return () => job.listeners.delete(listener);
}

export function isTerminal(status: GenerationJobStatus): boolean {
  return status !== 'running';
}
