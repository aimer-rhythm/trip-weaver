// 生成进度视图（09-27 改版）：旅行手账氛围 —— 左侧旅程里程碑小径 + 右侧拍立得候选卡片扇形散开。
// 只呈现用户向信息：三阶段进度、友好状态文案（tool label 直译）、候选卡片、耗时；
// token/LLM 请求/system prompt 等开发者信息不再展示（见任务 PRD）。
// 配色只用 tailwind.css @theme 里的语义 token（bg-brand / text-ink-* 等），不硬编码色值。
import { useEffect, useId, useMemo, useState } from 'react';
import {
  GENERATION_TIMEOUT_MINUTES,
  type DataSourceKind,
  type GenerationEvent,
  type GenerationPhase,
} from '@tripweaver/shared';
import { buildTimeline, formatDuration, type TimelineModel } from '../lib/generationTimeline';
import { DATA_SOURCE_LABEL } from '../lib/poi';
import { PoiCover } from './PoiCard';
import { generationCardCaption, selectGenerationCards } from '../lib/generationCards';

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
  title: string;
  pendingHint: string;
  doneHint: string;
  activeFallback: string;
}

const MILESTONES: Milestone[] = [
  { phase: 'research', title: '搜罗全城 · 调研灵感', pendingHint: '即将开始收集城市灵感', doneHint: '已为你收集了丰富的城市灵感', activeFallback: '正在搜罗城市灵感…' },
  { phase: 'plan', title: '串联路线 · 编排日程', pendingHint: '即将为你编排每日路线', doneHint: '每日路线已编排完成', activeFallback: '正在串联每日路线…' },
  { phase: 'review', title: '雕琢题名 · 撰写文案', pendingHint: '即将为你生成专属的旅行记录', doneHint: '旅行记录已撰写完成', activeFallback: '正在雕琢标题与文案…' },
];

/** 里程碑线性图标（描边随 currentColor，等待/进行/完成三态由外层 badge 类控色） */
function MilestoneIcon({ phase }: { phase: GenerationPhase }) {
  const common = {
    width: 26,
    height: 26,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  if (phase === 'research') {
    return (
      <svg {...common}>
        <circle cx="11" cy="11" r="6.5" />
        <path d="M15.9 15.9 21 21" />
      </svg>
    );
  }
  if (phase === 'plan') {
    // 设计稿的指南针是彩色圆盘 + 橙指针（不是单色线描），自带颜色不跟状态色
    return (
      <svg {...common} stroke="none" fill="none">
        <circle cx="12" cy="12" r="9.2" fill="#6D9BEE" />
        <circle cx="12" cy="12" r="7.4" fill="#EAF1FF" />
        <path d="m18 6-3.4 8.6L6 18l3.4-8.6Z" fill="#F99364" />
        <path d="m6 18 8.6-3.4-5.2-5.2Z" fill="#536DDA" />
        <circle cx="12" cy="12" r="1.1" fill="#1E3A8A" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

/** 四角星光点（标题两侧装饰） */
function SparkIcon({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2c.6 5.6 4.4 9.4 10 10-5.6.6-9.4 4.4-10 10-.6-5.6-4.4-9.4-10-10 5.6-.6 9.4-4.4 10-10z" />
    </svg>
  );
}

/** 拍立得散落位姿（最多展示最近 5 张候选；按设计稿排布，避免覆盖底部操作区）。 */
const FAN = [
  { left: '1.5%', top: '4.8%', rotate: -7 },
  { left: '36.4%', top: '2.5%', rotate: 8 },
  { left: '68%', top: '5.5%', rotate: 9 },
  { left: '10.8%', top: '44%', rotate: -5 },
  { left: '47.6%', top: '48%', rotate: 6 },
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
  const brushId = useId();
  const [failedCovers, setFailedCovers] = useState<ReadonlySet<string>>(() => new Set());
  const model = useMemo(() => buildTimeline(events), [events]);
  const terminal = model.terminal;
  const running = terminal === null;
  const banner = sourceBanner(model.dataSources);
  // 标题用任务自身参数；恢复/刷新链路 URL 里没有日期，prop 的值只是兜底
  const titleCity = model.destination ?? city;
  const titleDays = model.days ?? days;

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [running]);
  const elapsed = model.durationMs ?? (running && model.startedAt !== undefined ? Math.max(0, now - model.startedAt) : undefined);

  // 保留可用照片：后续无图候选不再把整个画面替换为空白。
  const visibleCandidates = selectGenerationCards(model.candidates, failedCovers, FAN.length);
  const newestId = visibleCandidates.at(-1)?.id;

  return (
    <div
      className="gen-page-root relative flex flex-1 flex-col overflow-hidden"
    >
      {/* 标题区：星形光点 + 笔刷弧线（仅进行中显示，终态有自己的卡片标题） */}
      {!terminal && (
        <header className="gen-header">
          <h1 className="gen-title">
            <SparkIcon className="gen-star gen-star-l" />
            <span>正在为你编织 <strong className="gen-title-city">{titleCity}</strong> 的 {titleDays} 天旅程…</span>
            <SparkIcon className="gen-star gen-star-r" />
          </h1>
          <svg className="gen-title-arc" viewBox="0 0 440 32" fill="none" aria-hidden="true">
            <defs><linearGradient id={brushId}><stop stopColor="#eee5ff" stopOpacity="0" /><stop offset=".35" stopColor="#c9b1fc" /><stop offset=".7" stopColor="#99cfff" /><stop offset="1" stopColor="#c9b1fc" stopOpacity="0" /></linearGradient></defs>
            <path d="M4 29C88 7 183 1 245 6c16 2-10 12 5 9s63-11 70-7-8 7 5 6 65-7 109 3" stroke={`url(#${brushId})`} strokeWidth="4" strokeLinecap="round" />
          </svg>
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
        <main className="gen-main">
          {/* 里程碑小径 */}
          <div className="gen-path">
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
                  {i > 0 && <svg className="gen-step-line" viewBox="0 0 60 100" preserveAspectRatio="none" aria-hidden="true"><path d="M58 0C54 20 8 24 16 54S45 82 58 100" /></svg>}
                  <span className="gen-step-badge" aria-hidden="true">
                    <MilestoneIcon phase={m.phase} />
                    {state === 'active' && <span className="gen-step-halo" />}
                    {state === 'done' && (
                      <span className="gen-step-check">
                        <CheckIcon />
                      </span>
                    )}
                  </span>
                  <div className="gen-step-body">
                    <p className="gen-step-title">
                      {i + 1}. {m.title}
                    </p>
                    <p className={`gen-step-hint ${state === 'active' ? 'gen-step-hint-live' : ''}`}>
                      {hint}
                    </p>
                  </div>
                </div>
              );
            })}
            {model.phases.length === 0 && <p className="gen-queue-hint">任务排队中…</p>}
          </div>

          {/* 拍立得候选卡片 */}
          <div className="gen-fan">
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
                      <PoiCover key={poi.coverUrl} poi={poi} onCoverError={(url) => setFailedCovers(previous => new Set(previous).add(url))} />
                    </div>
                    <figcaption className="gen-polaroid-caption" title={generationCardCaption(poi)}>{generationCardCaption(poi)}</figcaption>
                    {poi.id === newestId && <span className="gen-polaroid-new">new</span>}
                  </figure>
                );
              })
            )}
          </div>
        </main>
      )}

      {/* 底部：耗时 + 取消 */}
      <footer className="gen-footer">
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
              className="gen-cancel-btn"
            >
              {cancelling ? '取消中…' : '取消生成'}
            </button>
            {elapsed !== undefined && (
              <span className="gen-elapsed">已用 {formatDuration(elapsed)}</span>
            )}
          </>
        )}
      </footer>
    </div>
  );
}
