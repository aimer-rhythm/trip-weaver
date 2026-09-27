// 生成进度视图（09-27 改版）：旅行手账氛围 —— 左侧旅程里程碑小径 + 右侧拍立得候选卡片扇形散开。
// 只呈现用户向信息：三阶段进度、友好状态文案（tool label 直译）、候选卡片、耗时；
// token/LLM 请求/system prompt 等开发者信息不再展示（见任务 PRD）。
// 配色只用 tailwind.css @theme 里的语义 token（bg-brand / text-ink-* 等），不硬编码色值。
import { useEffect, useMemo, useState } from 'react';
import {
  GENERATION_TIMEOUT_MINUTES,
  type DataSourceKind,
  type GenerationEvent,
  type GenerationPhase,
} from '@tripweaver/shared';
import { buildTimeline, formatDuration, type TimelineModel } from '../lib/generationTimeline';
import { DATA_SOURCE_LABEL } from '../lib/poi';
import { PoiCover } from './PoiCard';

interface Props {
  events: GenerationEvent[];
  /** 标题所需：目的地与天数（由表单页传入） */
  city: string;
  days: number;
  cancelling: boolean;
  cancellationError: string | null;
  onCancel: () => void;
  /** 终态后回到可重新发起的状态 */
  onReset: () => void;
  onOpenTrip: (tripId: string) => void;
}

interface Milestone {
  phase: GenerationPhase;
  icon: string;
  title: string;
  pendingHint: string;
  doneHint: string;
  activeFallback: string;
}

const MILESTONES: Milestone[] = [
  { phase: 'research', icon: '🔍', title: '搜罗全城 · 调研灵感', pendingHint: '即将开始收集城市灵感', doneHint: '已为你收集了丰富的城市灵感', activeFallback: '正在搜罗城市灵感…' },
  { phase: 'plan', icon: '🧭', title: '串联路线 · 编排日程', pendingHint: '即将为你编排每日路线', doneHint: '每日路线已编排完成', activeFallback: '正在串联每日路线…' },
  { phase: 'review', icon: '📝', title: '雕琢题名 · 撰写文案', pendingHint: '即将为你生成专属的旅行记录', doneHint: '旅行记录已撰写完成', activeFallback: '正在雕琢标题与文案…' },
];

/** 拍立得散落位姿（最多展示最近 6 张候选；确定性排布，避免重渲染抖动） */
const FAN = [
  { left: '2%', top: '8%', rotate: -8 },
  { left: '35%', top: '0%', rotate: 5 },
  { left: '64%', top: '10%', rotate: 10 },
  { left: '10%', top: '50%', rotate: -5 },
  { left: '42%', top: '44%', rotate: 3 },
  { left: '66%', top: '54%', rotate: -9 },
];

type MilestoneState = 'pending' | 'active' | 'done';

function milestoneState(model: TimelineModel, phase: GenerationPhase): MilestoneState {
  const last = model.phases.filter((b) => b.phase === phase).at(-1);
  if (!last) return 'pending';
  return last.done ? 'done' : 'active';
}

/** 进行中里程碑的友好状态行：取最近一个工具事件 label 直译；无则阶段兜底文案 */
function activeStatusLine(model: TimelineModel, phase: GenerationPhase, fallback: string): string {
  const block = model.phases.filter((b) => b.phase === phase).at(-1);
  const tool = block?.items.filter((i) => i.kind === 'tool').at(-1);
  return tool && tool.kind === 'tool' ? `正在${tool.label}…` : fallback;
}

/** 数据源降级提示：双源齐全不提示；部分/全无时注明本次实际所用 */
function sourceBanner(sources: DataSourceKind[] | null): string | null {
  if (sources === null || sources.length >= 2) return null;
  const only = sources[0];
  if (only === undefined) return '未配置外部数据源，本次基于模型知识调研。';
  return only === 'websearch'
    ? '地点数据源不可用，本次基于全网搜索 + 模型知识调研。'
    : `全网搜索不可用，本次基于${DATA_SOURCE_LABEL[only]} + 模型知识调研。`;
}

const submitBtnCls =
  'rounded-full bg-gradient-to-r from-brand-light to-brand px-8 py-2.5 text-[0.9rem] font-bold text-white shadow-md transition-transform hover:scale-[1.03] active:scale-95';

export function GenerationRunPanel({ events, city, days, cancelling, cancellationError, onCancel, onReset, onOpenTrip }: Props) {
  const model = useMemo(() => buildTimeline(events), [events]);
  const terminal = model.terminal;
  const running = terminal === null;
  const banner = sourceBanner(model.dataSources);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [running]);
  const elapsed = model.durationMs ?? (running && model.startedAt !== undefined ? Math.max(0, now - model.startedAt) : undefined);

  // 拍立得只展示最近 6 张；最后一张带 new 爆炸贴
  const visibleCandidates = model.candidates.slice(-FAN.length);
  const newestId = model.candidates.at(-1)?.id;

  return (
    <div
      className="gen-page-root relative flex flex-1 flex-col overflow-hidden bg-canvas bg-cover bg-center"
      style={{ backgroundImage: "url('/home-bg.png')" }}
    >
      {/* 标题区：呼吸光晕 + 纸飞机（仅进行中显示，终态有自己的卡片标题） */}
      {!terminal && (
        <header className="relative z-10 flex flex-col items-center gap-2 px-6 pt-10 text-center">
          <h1 className="gen-title m-0 font-bold text-ink">
            <span className="gen-plane" aria-hidden="true">✈️</span>
            正在为你编织 {city} 的 {days} 天旅程…
            <span aria-hidden="true">✨</span>
            <span className="gen-plane gen-plane-r" aria-hidden="true">✈️</span>
          </h1>
          <span className="gen-title-arc" aria-hidden="true" />
          {banner && <p className="m-0 rounded-full bg-white/60 px-4 py-1 text-[0.8rem] text-ink-muted backdrop-blur-md">{banner}</p>}
        </header>
      )}

      {terminal ? (
        /* ---------- 终态视图（成功 / 失败 / 取消） ---------- */
        <main className="relative z-10 flex flex-1 items-center justify-center px-6">
          <div className="w-[min(460px,100%)] rounded-[20px] border border-white/50 bg-white/75 p-8 text-center shadow-[0_8px_32px_rgba(0,0,0,0.08)] backdrop-blur-xl">
            {terminal.type === 'job_done' && (
              <>
                <p className="m-0 mb-2 text-xl font-bold text-ink">行程已生成！正在打开编辑器…</p>
                {terminal.reviewNotes.length > 0 && (
                  <ul className="m-0 mb-4 list-none p-0 text-left text-[0.88rem] text-ink-soft">
                    {terminal.reviewNotes.map((note, i) => (
                      <li key={i} className="py-0.5">📝 {note}</li>
                    ))}
                  </ul>
                )}
                <button type="button" onClick={() => onOpenTrip(terminal.tripId)} className={submitBtnCls}>
                  立即打开
                </button>
              </>
            )}
            {terminal.type === 'job_error' && (
              <>
                <p className="m-0 mb-2 text-xl font-bold text-ink">生成失败</p>
                <p className="m-0 mb-4 text-[0.88rem] text-ink-soft">{terminal.message}（失败不计入今日配额）</p>
                <button type="button" onClick={onReset} className={submitBtnCls}>
                  返回重试
                </button>
              </>
            )}
            {terminal.type === 'job_cancelled' && (
              <>
                <p className="m-0 mb-2 text-xl font-bold text-ink">已取消</p>
                <p className="m-0 mb-4 text-[0.88rem] text-ink-soft">
                  {terminal.reason === 'timeout'
                    ? `生成超过 ${GENERATION_TIMEOUT_MINUTES} 分钟未完成，系统已自动取消。本次不计入今日配额，可稍后重新生成。`
                    : '你已取消本次生成。本次不计入今日配额。'}
                </p>
                <button type="button" onClick={onReset} className={submitBtnCls}>
                  返回表单
                </button>
              </>
            )}
          </div>
        </main>
      ) : (
        /* ---------- 进行中：左里程碑小径 + 右拍立得 ---------- */
        <main className="relative z-10 mx-auto flex w-full max-w-6xl min-h-0 flex-1 flex-col gap-6 px-6 py-8 sm:flex-row sm:gap-10">
          {/* 里程碑小径 */}
          <div className="gen-path flex w-full flex-col sm:w-[40%] sm:justify-center">
            {MILESTONES.map((m, i) => {
              const state = milestoneState(model, m.phase);
              const hint =
                state === 'done'
                  ? m.doneHint
                  : state === 'active'
                    ? activeStatusLine(model, m.phase, m.activeFallback)
                    : m.pendingHint;
              return (
                <div key={m.phase} className={`gen-step is-${state}`}>
                  {i > 0 && <span className="gen-step-line" aria-hidden="true" />}
                  <span className="gen-step-badge" aria-hidden="true">
                    {state === 'done' ? '✓' : m.icon}
                    {state === 'active' && <span className="gen-step-halo" />}
                  </span>
                  <div className="min-w-0">
                    <p className="m-0 text-[1.05rem] font-bold text-ink-strong">
                      {i + 1}. {m.title}
                    </p>
                    <p className={`m-0 mt-1 text-[0.82rem] text-ink-hint ${state === 'active' ? 'gen-step-hint-live' : ''}`}>
                      {hint}
                    </p>
                  </div>
                </div>
              );
            })}
            {model.phases.length === 0 && <p className="m-0 text-[0.85rem] text-ink-hint">任务排队中…</p>}
          </div>

          {/* 拍立得候选卡片 */}
          <div className="relative min-h-[320px] min-w-0 flex-1">
            {visibleCandidates.length === 0 ? (
              /* 候选未到时先放 3 张虚线空相框，避免右侧长时间全空 */
              FAN.slice(0, 3).map((pose, i) => (
                <div
                  key={i}
                  className="gen-polaroid gen-polaroid-ghost"
                  style={{ left: pose.left, top: pose.top, transform: `rotate(${pose.rotate}deg)` }}
                  aria-hidden="true"
                >
                  <div className="gen-polaroid-photo" />
                  <div className="gen-polaroid-caption gen-ghost-bar" />
                </div>
              ))
            ) : (
              visibleCandidates.map((poi, i) => {
                const pose = FAN[i % FAN.length]!;
                return (
                  <figure
                    key={poi.id}
                    className="gen-polaroid"
                    style={{ left: pose.left, top: pose.top, transform: `rotate(${pose.rotate}deg)` }}
                  >
                    <div className="gen-polaroid-photo">
                      <PoiCover poi={poi} />
                    </div>
                    <figcaption className="gen-polaroid-caption">{poi.name}</figcaption>
                    {poi.id === newestId && <span className="gen-polaroid-new">new</span>}
                  </figure>
                );
              })
            )}
          </div>
        </main>
      )}

      {/* 底部：耗时 + 取消 */}
      <footer className="relative z-10 flex flex-col items-center gap-2 pb-8">
        {cancellationError && (
          <p className="m-0 rounded-full bg-white/70 px-4 py-1 text-[0.82rem] text-red-600 backdrop-blur-md" role="alert">
            {cancellationError}
          </p>
        )}
        {running && (
          <>
            <button
              type="button"
              onClick={onCancel}
              disabled={cancelling}
              className="rounded-full border border-white/50 bg-white/70 px-7 py-2 text-[0.88rem] text-ink-muted backdrop-blur-md transition-colors hover:bg-white/90 disabled:opacity-50"
            >
              {cancelling ? '取消中…' : '取消生成'}
            </button>
            {elapsed !== undefined && (
              <span className="text-[0.78rem] text-ink-faint">已用 {formatDuration(elapsed)}</span>
            )}
          </>
        )}
      </footer>
    </div>
  );
}
