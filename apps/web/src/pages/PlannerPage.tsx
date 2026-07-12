// 新建行程：规划表单 → 生成进度（SSE 时间线）→ 完成跳编辑器（PRD F1/F8）
// 刷新恢复：jobId 存 sessionStorage，回来先查快照再决定重连/跳转/回表单
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  BUDGET_LEVELS,
  MAX_TRIP_DAYS,
  PREFERENCE_OPTIONS,
  type BudgetLevel,
  type GenerateForm,
  type GenerationEvent,
} from '@tripweaver/shared';
import { ApiError } from '../api/client';
import { fetchJobSnapshot, keys, useCancelGeneration, useStartGeneration, useUsage } from '../api/hooks';
import { GenerationTimeline } from '../components/GenerationTimeline';

const JOB_KEY = 'tw.activeJobId';

function formatResetTime(resetAt: number): string {
  const d = new Date(resetAt);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function cancellationErrorMessage(error: unknown): string {
  if (error instanceof ApiError || error instanceof Error) return error.message;
  return '取消请求失败，请重试';
}

export function PlannerPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const usage = useUsage();
  const start = useStartGeneration();
  const cancel = useCancelGeneration();
  const resetCancel = cancel.reset;

  // 表单态
  const [destination, setDestination] = useState('');
  const [days, setDays] = useState(3);
  const [startDate, setStartDate] = useState('');
  const [budgetLevel, setBudgetLevel] = useState<BudgetLevel>('舒适');
  const [totalBudget, setTotalBudget] = useState('');
  const [preferences, setPreferences] = useState<string[]>([]);
  const [partySize, setPartySize] = useState(2);
  const [extraNotes, setExtraNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  // 运行态
  const [jobId, setJobId] = useState<string | null>(null);
  const [events, setEvents] = useState<GenerationEvent[]>([]);
  const [restoring, setRestoring] = useState(() => Boolean(sessionStorage.getItem(JOB_KEY)));
  const doneTripRef = useRef<string | null>(null);
  const activeJobIdRef = useRef<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const clearJob = useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    sessionStorage.removeItem(JOB_KEY);
    activeJobIdRef.current = null;
    setJobId(null);
    setEvents([]);
    resetCancel();
  }, [resetCancel]);

  // 刷新恢复：先查快照
  useEffect(() => {
    const saved = sessionStorage.getItem(JOB_KEY);
    if (!saved) return;
    let alive = true;
    fetchJobSnapshot(saved)
      .then((snap) => {
        if (!alive) return;
        if (snap.status === 'running') {
          activeJobIdRef.current = saved;
          setJobId(saved);            // 重连 SSE，全量重放重建时间线
        } else if (snap.status === 'done' && snap.tripId) {
          sessionStorage.removeItem(JOB_KEY);
          navigate(`/trips/${snap.tripId}`, { replace: true });
        } else {
          sessionStorage.removeItem(JOB_KEY);
        }
      })
      .catch(() => sessionStorage.removeItem(JOB_KEY))
      .finally(() => alive && setRestoring(false));
    return () => {
      alive = false;
    };
  }, [navigate]);

  // SSE 订阅：EventSource 断线自带 Last-Event-ID 重连；首连用 lastEventId=0 全量重放
  useEffect(() => {
    if (!jobId) return;
    const es = new EventSource(`/api/generations/${jobId}/events?lastEventId=0`);
    eventSourceRef.current = es;
    let gotTerminal = false;

    es.onopen = () => setEvents([]);   // 每次（重）连都全量重放，清空重建防重复
    es.onmessage = (msg) => {
      const ev = JSON.parse(msg.data) as GenerationEvent;
      setEvents((prev) => [...prev, ev]);
      if (ev.type === 'job_done' || ev.type === 'job_error' || ev.type === 'job_cancelled') {
        gotTerminal = true;
        es.close();
        if (eventSourceRef.current === es) eventSourceRef.current = null;
        sessionStorage.removeItem(JOB_KEY);
        void qc.invalidateQueries({ queryKey: keys.usage });
        if (ev.type === 'job_done') {
          void qc.invalidateQueries({ queryKey: keys.trips });
          doneTripRef.current = ev.tripId;
          setTimeout(() => navigate(`/trips/${ev.tripId}`), 1800);   // 稍作停留展示审校提示，随后跳编辑器
        }
      }
    };
    es.onerror = () => {
      // 浏览器会自动重连；若任务已不在（服务重启/过期），快照 404 时收尾
      if (gotTerminal) return;
      fetchJobSnapshot(jobId).catch((err) => {
        if (err instanceof ApiError && err.status === 404) {
          es.close();
          if (eventSourceRef.current === es) eventSourceRef.current = null;
          setEvents((prev) => [...prev, { type: 'job_error', message: '任务已丢失（服务可能重启过），本次不计入配额，请重新生成' }]);
          sessionStorage.removeItem(JOB_KEY);
        }
      });
    };
    return () => {
      es.close();
      if (eventSourceRef.current === es) eventSourceRef.current = null;
    };
  }, [jobId, navigate, qc]);

  const togglePreference = (p: string) =>
    setPreferences((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : prev.length < 7 ? [...prev, p] : prev));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const form: GenerateForm = {
      destination: destination.trim(),
      days,
      startDate,
      budgetLevel,
      totalBudget: Number(totalBudget) || 0,
      preferences: preferences as GenerateForm['preferences'],
      partySize,
      extraNotes: extraNotes.trim(),
    };
    if (!form.destination) {
      setFormError('请填写目的地');
      return;
    }
    start.mutate(form, {
      onSuccess: ({ jobId: id }) => {
        resetCancel();
        sessionStorage.setItem(JOB_KEY, id);
        setEvents([]);
        activeJobIdRef.current = id;
        setJobId(id);
      },
      onError: (err) => {
        if (!(err instanceof ApiError)) {
          setFormError('网络异常，请稍后重试');
          return;
        }
        if (err.status === 429) {
          const resetAt = typeof err.data?.resetAt === 'number' ? err.data.resetAt : null;
          setFormError(`今日生成次数已用完${resetAt ? `，${formatResetTime(resetAt)} 后重置` : ''}。已有行程仍可继续编辑。`);
        } else if (err.status === 400 && err.data?.code === 'no_llm') {
          setFormError(
            err.data?.hasSiteKey
              ? '站点 AI 配置异常，请联系站长。'
              : '本站未配置 AI 服务：普通用户请联系站长开通；也可以在「设置 → 高级选项」填入自己的 API Key 立即使用。',
          );
        } else if (err.status === 409 && typeof err.data?.jobId === 'string') {
          // 已有任务进行中 → 直接接管进度
          const id = err.data.jobId;
          resetCancel();
          sessionStorage.setItem(JOB_KEY, id);
          setEvents([]);
          activeJobIdRef.current = id;
          setJobId(id);
        } else if (err.status === 401) {
          setFormError('登录已过期，请刷新页面重新登录。');
        } else {
          setFormError(err.message);
        }
      },
    });
  };

  const onCancel = () => {
    if (!jobId || cancel.isPending) return;
    const cancelledJobId = jobId;
    cancel.mutate(cancelledJobId, {
      onSuccess: (snapshot) => {
        // mutation.reset() 只重置展示状态，不会中止已经发出的轮询；忽略旧任务的迟到回调。
        if (snapshot.status !== 'cancelled' || activeJobIdRef.current !== cancelledJobId) return;
        eventSourceRef.current?.close();
        eventSourceRef.current = null;
        setEvents((previousEvents) => {
          const alreadyTerminal = previousEvents.some(
            (event) => event.type === 'job_done' || event.type === 'job_error' || event.type === 'job_cancelled',
          );
          return alreadyTerminal ? previousEvents : [...previousEvents, { type: 'job_cancelled' }];
        });
        sessionStorage.removeItem(JOB_KEY);
        void qc.invalidateQueries({ queryKey: keys.usage });
      },
    });
  };

  if (restoring) {
    return (
      <div className="page">
        <div className="page-loading">正在恢复生成进度…</div>
      </div>
    );
  }

  // ---------- 运行/结果视图 ----------
  if (jobId) {
    const terminal = events.find(
      (ev): ev is Extract<GenerationEvent, { type: 'job_done' | 'job_error' | 'job_cancelled' }> =>
        ev.type === 'job_done' || ev.type === 'job_error' || ev.type === 'job_cancelled',
    );
    return (
      <div className="page">
        <div className="page-head">
          <h1>智能生成中</h1>
        </div>

        <GenerationTimeline
          events={events}
          onCancel={onCancel}
          cancelling={cancel.isPending}
          cancellationError={cancel.error ? cancellationErrorMessage(cancel.error) : null}
        />

        {terminal?.type === 'job_done' && (
          <div className="gen-result gen-result-ok">
            <p className="gen-result-title">行程已生成！正在打开编辑器…</p>
            {terminal.reviewNotes.length > 0 && (
              <ul className="gen-review-notes">
                {terminal.reviewNotes.map((n, i) => (
                  <li key={i}>📝 {n}</li>
                ))}
              </ul>
            )}
            <button type="button" className="btn btn-primary" onClick={() => navigate(`/trips/${terminal.tripId}`)}>
              立即打开
            </button>
          </div>
        )}
        {terminal?.type === 'job_error' && (
          <div className="gen-result gen-result-err">
            <p className="gen-result-title">生成失败</p>
            <p className="muted">{terminal.message}（失败不计入今日配额）</p>
            <button type="button" className="btn btn-primary" onClick={clearJob}>
              返回重试
            </button>
          </div>
        )}
        {terminal?.type === 'job_cancelled' && (
          <div className="gen-result">
            <p className="gen-result-title">已取消</p>
            <p className="muted">本次不计入今日配额。</p>
            <button type="button" className="btn btn-primary" onClick={clearJob}>
              返回表单
            </button>
          </div>
        )}
      </div>
    );
  }

  // ---------- 表单视图 ----------
  const remaining = usage.data?.remaining;
  const quotaExhausted = remaining === 0;
  return (
    <div className="page planner-page">
      <div className="page-head">
        <h1>新建行程</h1>
        {usage.data && (
          <span className="quota-inline muted">
            今日剩余 {usage.data.remaining} / {usage.data.dailyLimit} 次
            {quotaExhausted && `（${formatResetTime(usage.data.resetAt)} 重置）`}
          </span>
        )}
      </div>

      <form className="form planner-form" onSubmit={submit}>
        <label>
          目的地 *
          <input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="如：东京、成都、大理" maxLength={40} />
        </label>

        <div className="form-grid-2">
          <label>
            天数（1–{MAX_TRIP_DAYS}）
            <input
              type="number"
              min={1}
              max={MAX_TRIP_DAYS}
              value={days}
              onChange={(e) => setDays(Math.min(MAX_TRIP_DAYS, Math.max(1, Number(e.target.value) || 1)))}
            />
          </label>
          <label>
            出发日期（可选）
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
        </div>

        <label>
          预算档位
          <div className="preset-row">
            {BUDGET_LEVELS.map((b) => (
              <button key={b} type="button" className={`btn btn-chip ${budgetLevel === b ? 'is-active' : ''}`} onClick={() => setBudgetLevel(b)}>
                {b}
              </button>
            ))}
          </div>
        </label>

        <div className="form-grid-2">
          <label>
            总预算（元/人，可选）
            <input type="number" min={0} value={totalBudget} onChange={(e) => setTotalBudget(e.target.value)} placeholder="不填则按档位估算" />
          </label>
          <label>
            出行人数
            <input
              type="number"
              min={1}
              max={20}
              value={partySize}
              onChange={(e) => setPartySize(Math.min(20, Math.max(1, Number(e.target.value) || 1)))}
            />
          </label>
        </div>

        <label>
          旅行偏好（可多选）
          <div className="preset-row">
            {PREFERENCE_OPTIONS.map((p) => (
              <button key={p} type="button" className={`btn btn-chip ${preferences.includes(p) ? 'is-active' : ''}`} onClick={() => togglePreference(p)}>
                {p}
              </button>
            ))}
          </div>
        </label>

        <label>
          补充要求（可选，≤200 字）
          <input value={extraNotes} onChange={(e) => setExtraNotes(e.target.value)} maxLength={200} placeholder="如：带 3 岁小孩、不吃辣、想看海" />
        </label>

        {formError && <p className="form-error">{formError}</p>}
        <button type="submit" className="btn btn-primary btn-block" disabled={start.isPending || quotaExhausted}>
          {start.isPending ? '创建任务中…' : quotaExhausted ? '今日次数已用完' : '开始生成 ✨'}
        </button>
        <p className="muted planner-hint">生成通常需要 1–3 分钟，期间可随时取消；取消与失败不计入次数。</p>
      </form>
    </div>
  );
}
