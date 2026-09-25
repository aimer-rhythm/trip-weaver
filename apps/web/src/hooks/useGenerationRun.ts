// 生成任务的前端生命周期：刷新恢复 / SSE 全量重放 / 取消。
//
// 从原 PlannerPage 抽出并保持行为不变（sessionStorage 键、lastEventId=0 全量重放语义、
// 409 接管进行中任务、404 视为任务丢失）。问答式入口直接复用，不要复制第二份。
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { GenerationEvent } from '@tripweaver/shared';
import { ApiError } from '../api/client';
import { fetchJobSnapshot, keys, useCancelGeneration, useStartGeneration, type GenerationRequest } from '../api/hooks';

export const ACTIVE_JOB_KEY = 'tw.activeJobId';

export interface GenerationRun {
  jobId: string | null;
  events: GenerationEvent[];
  /** 首次挂载时正在查快照（决定重连 / 跳走 / 全新开始） */
  restoring: boolean;
  starting: boolean;
  cancelPending: boolean;
  cancellationError: string | null;
  /** 发起失败的可操作提示（配额 / 未配置 AI / 登录过期等） */
  errorMessage: string | null;
  start: (form: GenerationRequest) => void;
  /** 接管已在跑的任务（服务端自动触发场景） */
  adopt: (jobId: string) => void;
  cancel: () => void;
  /** 结束当前任务视图，回到可重新发起的状态 */
  reset: () => void;
}

interface Options {
  /** 生成成功后的落地动作（通常是跳转行程编辑器） */
  onDone: (tripId: string) => void;
}

function formatResetTime(resetAt: number): string {
  const d = new Date(resetAt);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function cancellationErrorMessage(error: unknown): string {
  if (error instanceof ApiError || error instanceof Error) return error.message;
  return '取消请求失败，请重试';
}

export function useGenerationRun({ onDone }: Options): GenerationRun {
  const qc = useQueryClient();
  const startMutation = useStartGeneration();
  const cancel = useCancelGeneration();

  const [jobId, setJobId] = useState<string | null>(null);
  const [events, setEvents] = useState<GenerationEvent[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(() => Boolean(sessionStorage.getItem(ACTIVE_JOB_KEY)));

  const activeJobIdRef = useRef<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const resetCancel = cancel.reset;
  const clearJob = useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    sessionStorage.removeItem(ACTIVE_JOB_KEY);
    activeJobIdRef.current = null;
    setJobId(null);
    setEvents([]);
    resetCancel();
  }, [resetCancel]);

  // 刷新恢复：先查快照，再决定重连 SSE / 跳走 / 什么也不做
  useEffect(() => {
    const saved = sessionStorage.getItem(ACTIVE_JOB_KEY);
    if (!saved) return;
    let alive = true;
    fetchJobSnapshot(saved)
      .then((snap) => {
        if (!alive) return;
        if (snap.status === 'running') {
          activeJobIdRef.current = saved;
          setJobId(saved); // 重连 SSE：全量重放重建时间线
        } else if (snap.status === 'done' && snap.tripId) {
          sessionStorage.removeItem(ACTIVE_JOB_KEY);
          onDoneRef.current(snap.tripId);
        } else {
          sessionStorage.removeItem(ACTIVE_JOB_KEY);
        }
      })
      .catch(() => sessionStorage.removeItem(ACTIVE_JOB_KEY))
      .finally(() => alive && setRestoring(false));
    return () => {
      alive = false;
    };
  }, []);

  // SSE：EventSource 断线自带 Last-Event-ID 重连；首连用 lastEventId=0 全量重放
  useEffect(() => {
    if (!jobId) return;
    const es = new EventSource(`/api/generations/${jobId}/events?lastEventId=0`);
    eventSourceRef.current = es;
    let gotTerminal = false;
    let opened = false;

    es.onopen = () => {
      // 首连时事件数组本来就是空的（start 时已清过），不能再清：
      // 若 onopen 晚于首批 message 到达，清空会把 job_start 丢掉（降级标注消失、阶段内容错位）。
      // 只有重连才清空重建，避免全量重放重复追加。
      if (opened) setEvents([]);
      opened = true;
    };
    es.onmessage = (msg) => {
      let ev: GenerationEvent;
      try {
        ev = JSON.parse(msg.data) as GenerationEvent;
      } catch {
        return; // 坏帧丢弃，不影响后续事件
      }
      setEvents((prev) => [...prev, ev]);
      if (ev.type === 'job_done' || ev.type === 'job_error' || ev.type === 'job_cancelled') {
        gotTerminal = true;
        es.close();
        if (eventSourceRef.current === es) eventSourceRef.current = null;
        sessionStorage.removeItem(ACTIVE_JOB_KEY);
        void qc.invalidateQueries({ queryKey: keys.usage });
        if (ev.type === 'job_done') {
          void qc.invalidateQueries({ queryKey: keys.trips });
          onDoneRef.current(ev.tripId);
        }
      }
    };
    es.onerror = () => {
      if (gotTerminal) return;
      // 浏览器会自动重连；若任务已不在（服务重启/过期），快照 404 时收尾
      fetchJobSnapshot(jobId).catch((err) => {
        if (err instanceof ApiError && err.status === 404) {
          es.close();
          if (eventSourceRef.current === es) eventSourceRef.current = null;
          setEvents((prev) => [
            ...prev,
            { type: 'job_error', message: '任务已丢失（服务可能重启过），本次不计入配额，请重新生成' },
          ]);
          sessionStorage.removeItem(ACTIVE_JOB_KEY);
        }
      });
    };
    return () => {
      es.close();
      if (eventSourceRef.current === es) eventSourceRef.current = null;
    };
  }, [jobId, qc]);

  const start = useCallback(
    (form: GenerationRequest) => {
      setErrorMessage(null);
      startMutation.mutate(form, {
        onSuccess: ({ jobId: id }) => {
          resetCancel();
          sessionStorage.setItem(ACTIVE_JOB_KEY, id);
          setEvents([]);
          activeJobIdRef.current = id;
          setJobId(id);
        },
        onError: (err) => {
          if (!(err instanceof ApiError)) {
            setErrorMessage('网络异常，请稍后重试');
            return;
          }
          if (err.status === 429) {
            const resetAt = typeof err.data?.resetAt === 'number' ? err.data.resetAt : null;
            setErrorMessage(`今日生成次数已用完${resetAt ? `，${formatResetTime(resetAt)} 后重置` : ''}。已有行程仍可继续编辑。`);
          } else if (err.status === 400 && err.data?.code === 'no_llm') {
            setErrorMessage(
              err.data?.hasSiteKey
                ? '站点 AI 配置异常，请联系站长。'
                : '本站未配置 AI 服务：普通用户请联系站长开通；也可以在「设置 → 高级选项」填入自己的 API Key 立即使用。',
            );
          } else if (err.status === 409 && typeof err.data?.jobId === 'string') {
            // 已有任务进行中 → 直接接管进度
            const id = err.data.jobId;
            resetCancel();
            sessionStorage.setItem(ACTIVE_JOB_KEY, id);
            setEvents([]);
            activeJobIdRef.current = id;
            setJobId(id);
          } else if (err.status === 401) {
            setErrorMessage('登录已过期，请刷新页面重新登录。');
          } else {
            setErrorMessage(err.message);
          }
        },
      });
    },
    [resetCancel, startMutation],
  );

  const cancelCurrent = useCallback(() => {
    if (!jobId || cancel.isPending) return;
    const cancelledJobId = jobId;
    cancel.mutate(cancelledJobId, {
      onSuccess: (snapshot) => {
        // mutation.reset() 只重置展示状态，不会中止已经发出的轮询；忽略旧任务的迟到回调
        if (snapshot.status !== 'cancelled' || activeJobIdRef.current !== cancelledJobId) return;
        eventSourceRef.current?.close();
        eventSourceRef.current = null;
        setEvents((previous) => {
          const alreadyTerminal = previous.some(
            (event) => event.type === 'job_done' || event.type === 'job_error' || event.type === 'job_cancelled',
          );
          return alreadyTerminal ? previous : [...previous, { type: 'job_cancelled', reason: 'user' }];
        });
        sessionStorage.removeItem(ACTIVE_JOB_KEY);
        void qc.invalidateQueries({ queryKey: keys.usage });
      },
    });
  }, [cancel, jobId, qc]);

  /** 接管一个已在跑的任务（R3：服务端自动触发的生成，前端直接进进度视图） */
  const adopt = useCallback(
    (id: string) => {
      resetCancel();
      sessionStorage.setItem(ACTIVE_JOB_KEY, id);
      setEvents([]);
      activeJobIdRef.current = id;
      setJobId(id);
    },
    [resetCancel],
  );

  return {
    jobId,
    events,
    restoring,
    starting: startMutation.isPending,
    cancelPending: cancel.isPending,
    cancellationError: cancel.error ? cancellationErrorMessage(cancel.error) : null,
    errorMessage,
    start,
    adopt,
    cancel: cancelCurrent,
    reset: clearJob,
  };
}
