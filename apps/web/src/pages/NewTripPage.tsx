// 新建行程（09-26 结构化表单入口，交互参考 Yuntu InputPage 的 4 段胶囊指挥台）：
// 胶囊条每段显示当前值摘要，点击展开对应浮动面板；面板一次只开一个，点外部收起。
// 默认值预填（明天起 3 天），只有「旅行节奏」必须显式选择——它是真实偏好，不替用户默认。
// 提交链路：惰性建会话 → PATCH 写入 Brief 快照（编辑器内嵌对话靠会话关联反查）→ POST /api/generations。
// Brief → GenerateForm 的映射复用 shared 的 briefToGenerateForm，前端不另写一套。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import {
  MAX_TRIP_DAYS,
  PACE_LABELS,
  PACE_OPTIONS,
  PREFERENCE_OPTIONS,
  TRANSPORT_MODES,
  briefToGenerateForm,
  requiredBriefFields,
  type PlanningBriefData,
  type PlanningBriefPatch,
  type TransportMode,
  type TripPace,
} from '@tripweaver/shared';
import { useCoveredCities, useCreateConversation, usePatchBrief, useUsage } from '../api/hooks';
import { GenerationRunPanel } from '../components/GenerationRunPanel';
import { RangeCalendar } from '../components/RangeCalendar';
import { useGenerationRun } from '../hooks/useGenerationRun';
import { TRANSPORT_LABELS } from '../lib/chatDerive';
import { addDays, daysBetween, isISODate, isoDateAfter, shortDate } from '../lib/dates';

type Preference = (typeof PREFERENCE_OPTIONS)[number];
type PanelKey = 'city' | 'date' | 'pace' | 'more';

const PACE_DESCS: Record<TripPace, string> = {
  relaxed: '少走路、慢节奏探索',
  moderate: '经典地标全景体验',
  tight: '高密度、极致高效',
};

const QUICK_DAYS = [2, 3, 5, 7, 10];

export function NewTripPage() {
  const navigate = useNavigate();
  const [params, setSearchParams] = useSearchParams();
  const city = params.get('city')?.trim() ?? '';

  const covered = useCoveredCities();
  const usage = useUsage();
  const createConversation = useCreateConversation();
  const patchBrief = usePatchBrief();

  // 首页胶囊可带 start/end/pace/partySize/preferences/transport 预填（均需校验，不可信输入）
  const [startDate, setStartDate] = useState(() => {
    const s = params.get('start');
    return s && isISODate(s) ? s : isoDateAfter(1);
  });
  const [endDate, setEndDate] = useState(() => {
    const s = params.get('start');
    const e = params.get('end');
    if (s && e && isISODate(s) && isISODate(e)) {
      const n = daysBetween(s, e);
      if (n >= 1 && n <= MAX_TRIP_DAYS) return e;
    }
    return isoDateAfter(3);
  });
  const [pace, setPace] = useState<TripPace | null>(() => {
    const p = params.get('pace');
    return (PACE_OPTIONS as readonly string[]).includes(p ?? '') ? (p as TripPace) : null;
  });
  const [preferences, setPreferences] = useState<Preference[]>(() => {
    const raw = params.get('preferences');
    if (!raw) return [];
    return raw.split(',').filter((p): p is Preference => (PREFERENCE_OPTIONS as readonly string[]).includes(p));
  });
  const [partySize, setPartySize] = useState(() => {
    const n = Number(params.get('partySize'));
    return Number.isInteger(n) && n >= 1 && n <= 20 ? n : 2;
  });
  const [transportMode, setTransportMode] = useState<TransportMode | null>(() => {
    const t = params.get('transport');
    return (TRANSPORT_MODES as readonly string[]).includes(t ?? '') ? (t as TransportMode) : null;
  });
  const [lodging, setLodging] = useState('');
  const [extraNotes, setExtraNotes] = useState('');
  const [activePanel, setActivePanel] = useState<PanelKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [doneTripId, setDoneTripId] = useState<string | null>(null);
  const [autoStarting, setAutoStarting] = useState(false);
  const deckRef = useRef<HTMLDivElement>(null);

  const openTrip = useCallback((tripId: string) => setDoneTripId(tripId), []);
  const run = useGenerationRun({ onDone: openTrip });

  // 生成成功：先让结果卡片可见，再跳编辑器（与原入口的停留时长一致）
  useEffect(() => {
    if (!doneTripId) return;
    const timer = setTimeout(() => navigate(`/trips/${doneTripId}`), 1800);
    return () => clearTimeout(timer);
  }, [doneTripId, navigate]);

  // 点胶囊条外部收起面板（Yuntu 同交互）
  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (deckRef.current && !deckRef.current.contains(e.target as Node)) setActivePanel(null);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  const days = daysBetween(startDate, endDate);

  const briefData = useMemo<PlanningBriefData>(() => {
    return {
      destination: city,
      constraints: [],
      startDate,
      endDate,
      days,
      ...(pace ? { pace } : {}),
      ...(preferences.length > 0 ? { preferences } : {}),
      partySize,
      ...(transportMode ? { transportMode } : {}),
      ...(lodging.trim() ? { lodging: lodging.trim() } : {}),
      ...(extraNotes.trim() ? { extraNotes: extraNotes.trim() } : {}),
    };
  }, [city, startDate, endDate, days, pace, preferences, partySize, transportMode, lodging, extraNotes]);

  const ready = requiredBriefFields(briefData).length === 0;
  const generationExhausted = usage.data?.remaining === 0;
  const busy = createConversation.isPending || patchBrief.isPending || run.starting;

  const togglePanel = (key: PanelKey) => setActivePanel((cur) => (cur === key ? null : key));
  const togglePreference = (option: Preference) =>
    setPreferences((prev) => (prev.includes(option) ? prev.filter((p) => p !== option) : [...prev, option]));

  const submit = async () => {
    if (!ready || busy || generationExhausted) return;
    setError(null);
    try {
      const conversation = await createConversation.mutateAsync(`${city} · ${days}天行程`);
      // Brief 快照：表单字段整包写入（一次 PATCH = 一条对话记录，留档生成输入）
      const patch: PlanningBriefPatch = { destination: city, startDate, endDate, days, partySize };
      if (briefData.pace) patch.pace = briefData.pace;
      if (briefData.preferences) patch.preferences = briefData.preferences;
      if (briefData.transportMode) patch.transportMode = briefData.transportMode;
      if (briefData.lodging) patch.lodging = briefData.lodging;
      if (briefData.extraNotes) patch.extraNotes = briefData.extraNotes;
      await patchBrief.mutateAsync({ id: conversation.id, patch });
      run.start({ ...briefToGenerateForm(briefData), conversationId: conversation.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败，请稍后重试');
    }
  };

  // 首页衔底带 autostart=1 直达：必填项已经齐了，到站就提交，不再让用户点第二次开始生成。
  // 提交后清掉该参数，避免刷新页面又跑一次生成。restoring 期间先等快照（上次任务的恢复可能直接跳走），
  // 否则会与恢复流程抢着发一次生成。（无依赖数组：每渲染后只做一次很轻的守卫检查）
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current || run.restoring) return;
    if (params.get('autostart') !== '1') return;
    if (!ready || busy || generationExhausted) return;
    autoStarted.current = true;
    setAutoStarting(true);
    setSearchParams(
      (prev) => {
        prev.delete('autostart');
        return prev;
      },
      { replace: true },
    );
    void submit().finally(() => setAutoStarting(false));
  });

  // ---------- 生成中 / 结果视图 ----------
  if (run.restoring) {
    return (
      <div className="page">
        <div className="page-loading">正在恢复生成进度…</div>
      </div>
    );
  }

  // 首页点了「开始规划」直接过来：先用启动态占位，不让用户看到一闪而过的表单
  if (autoStarting && !run.jobId) {
    return (
      <div className="page">
        <div className="page-loading">正在启动生成…</div>
      </div>
    );
  }

  if (run.jobId) {
    return (
      <GenerationRunPanel
        events={run.events}
        city={city}
        days={days}
        cancelling={run.cancelPending}
        cancellationError={run.cancellationError}
        onCancel={run.cancel}
        onReset={run.reset}
        onOpenTrip={(tripId) => navigate(`/trips/${tripId}`)}
      />
    );
  }

  // ---------- 表单视图 ----------
  if (covered.isPending) {
    return (
      <div className="page">
        <div className="page-loading">加载中…</div>
      </div>
    );
  }
  // 直达链接防护：城市参数缺失或不在已覆盖列表 → 回首页重选
  if (!city || (covered.data && !covered.data.cities.includes(city))) {
    return <Navigate to="/" replace />;
  }

  const paceSummary = `${pace ? PACE_LABELS[pace] : '选择节奏'} · ${partySize} 人`;
  const moreSummary = [
    preferences.length > 0 ? preferences.join('·') : '偏好不限',
    transportMode ? TRANSPORT_LABELS[transportMode] : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="page">
      <div className="page-head">
        <h1>{city}之旅</h1>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="capsule-deck" ref={deckRef}>
          <button
            type="button"
            className={`capsule-segment ${activePanel === 'city' ? 'is-open' : ''}`}
            aria-expanded={activePanel === 'city'}
            onClick={() => togglePanel('city')}
          >
            <span className="capsule-label">目的地</span>
            <span className="capsule-value">{city}</span>
          </button>

          <button
            type="button"
            className={`capsule-segment ${activePanel === 'date' ? 'is-open' : ''}`}
            aria-expanded={activePanel === 'date'}
            onClick={() => togglePanel('date')}
          >
            <span className="capsule-label">出行日期</span>
            <span className="capsule-value">
              {shortDate(startDate)} ~ {shortDate(endDate)} · {days} 天
            </span>
          </button>

          <button
            type="button"
            className={`capsule-segment ${activePanel === 'pace' ? 'is-open' : ''}`}
            aria-expanded={activePanel === 'pace'}
            onClick={() => togglePanel('pace')}
          >
            <span className="capsule-label">节奏与同行</span>
            <span className={`capsule-value ${pace ? '' : 'is-empty'}`}>{paceSummary}</span>
          </button>

          <button
            type="button"
            className={`capsule-segment ${activePanel === 'more' ? 'is-open' : ''}`}
            aria-expanded={activePanel === 'more'}
            onClick={() => togglePanel('more')}
          >
            <span className="capsule-label">偏好与更多</span>
            <span className="capsule-value">{moreSummary}</span>
          </button>

          <button type="submit" className="btn btn-primary capsule-submit" disabled={!ready || busy || generationExhausted}>
            {busy ? '创建任务中…' : generationExhausted ? '今日次数已用完' : '开始生成 ✨'}
          </button>

          {activePanel === 'city' && (
            <div className="capsule-panel">
              <p className="capsule-panel-title">切换目的地（仅列已覆盖城市）</p>
              <div className="city-grid">
                {covered.data?.cities.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`btn btn-chip ${c === city ? 'is-active' : ''}`}
                    onClick={() => {
                      setSearchParams({ city: c });
                      setActivePanel('date');
                    }}
                  >
                    {c}
                  </button>
                ))}
              </div>
              <div className="capsule-panel-foot">
                <button type="button" className="btn btn-ghost" onClick={() => setActivePanel('date')}>
                  下一步：出行日期 →
                </button>
              </div>
            </div>
          )}

          {activePanel === 'date' && (
            <div className="capsule-panel">
              <p className="capsule-panel-title">出发与返回日期（单次最多 {MAX_TRIP_DAYS} 天）</p>
              <RangeCalendar
                startDate={startDate}
                endDate={endDate}
                maxDays={MAX_TRIP_DAYS}
                onRangeChange={(s, e) => {
                  setStartDate(s);
                  setEndDate(e);
                }}
              />
              <div className="capsule-quick-row">
                <span className="muted">常用跨度：</span>
                {QUICK_DAYS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`btn btn-chip ${days === n ? 'is-active' : ''}`}
                    onClick={() => setEndDate(addDays(startDate, n - 1))}
                  >
                    {n}天
                  </button>
                ))}
              </div>
              <div className="capsule-panel-foot">
                <button type="button" className="btn btn-ghost" onClick={() => setActivePanel('pace')}>
                  下一步：节奏与同行 →
                </button>
              </div>
            </div>
          )}

          {activePanel === 'pace' && (
            <div className="capsule-panel">
              <p className="capsule-panel-title">旅行节奏</p>
              <div className="capsule-card-row">
                {PACE_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={`capsule-choice-card ${pace === option ? 'is-active' : ''}`}
                    aria-pressed={pace === option}
                    onClick={() => setPace(option)}
                  >
                    <span className="capsule-choice-title">{PACE_LABELS[option]}</span>
                    <span className="capsule-choice-desc muted">{PACE_DESCS[option]}</span>
                  </button>
                ))}
              </div>
              <p className="capsule-panel-title">同行人数</p>
              <div className="capsule-stepper">
                <button
                  type="button"
                  className="btn btn-ghost"
                  aria-label="减少人数"
                  disabled={partySize <= 1}
                  onClick={() => setPartySize((n) => Math.max(1, n - 1))}
                >
                  −
                </button>
                <span className="capsule-stepper-value">{partySize} 人同行</span>
                <button
                  type="button"
                  className="btn btn-ghost"
                  aria-label="增加人数"
                  disabled={partySize >= 20}
                  onClick={() => setPartySize((n) => Math.min(20, n + 1))}
                >
                  ＋
                </button>
              </div>
              <div className="capsule-panel-foot">
                <button type="button" className="btn btn-ghost" onClick={() => setActivePanel('more')}>
                  下一步：偏好与更多 →
                </button>
              </div>
            </div>
          )}

          {activePanel === 'more' && (
            <div className="capsule-panel">
              <p className="capsule-panel-title">偏好（多选）</p>
              <div className="preset-row">
                {PREFERENCE_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={`btn btn-chip ${preferences.includes(option) ? 'is-active' : ''}`}
                    aria-pressed={preferences.includes(option)}
                    onClick={() => togglePreference(option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
              <p className="capsule-panel-title">出行方式（缺省公共交通）</p>
              <div className="preset-row">
                {TRANSPORT_MODES.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={`btn btn-chip ${transportMode === mode ? 'is-active' : ''}`}
                    aria-pressed={transportMode === mode}
                    onClick={() => setTransportMode((prev) => (prev === mode ? null : mode))}
                  >
                    {TRANSPORT_LABELS[mode]}
                  </button>
                ))}
              </div>
              <label className="capsule-field">
                住宿位置（可选，酒店名或大致区域）
                <input value={lodging} maxLength={60} onChange={(e) => setLodging(e.target.value)} placeholder="留空由 AI 建议区域" />
              </label>
              <label className="capsule-field">
                补充说明（可选，如「带 2 岁小孩」「不想爬山」）
                <textarea
                  value={extraNotes}
                  maxLength={200}
                  rows={3}
                  onChange={(e) => setExtraNotes(e.target.value)}
                  placeholder="其他要求直接写在这里"
                />
              </label>
              <div className="capsule-panel-foot">
                <button type="button" className="btn btn-ghost" onClick={() => setActivePanel(null)}>
                  完成
                </button>
              </div>
            </div>
          )}
        </div>

        {error && <p className="form-error">{error}</p>}
        {run.errorMessage && <p className="form-error">{run.errorMessage}</p>}
      </form>
    </div>
  );
}

