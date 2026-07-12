// 生成进度时间线：三阶段分组 + 工具时间线 + 候选卡片实时长出 + 思考折叠 + 用量/取消（PRD F1）
import { useMemo } from 'react';
import type { DataSourceKind, GenerationEvent, GenerationPhase, ResearchPoi } from '@tripweaver/shared';
import { PoiCard } from './PoiCard';

const PHASE_LABEL: Record<GenerationPhase, string> = {
  research: '调研灵感',
  plan: '编排行程',
  review: '审校把关',
};
const PHASE_ICON: Record<GenerationPhase, string> = { research: '🔍', plan: '🗺️', review: '✅' };

interface ToolItem {
  kind: 'tool';
  key: string;
  label: string;
  summary: string;
  isError: boolean;
  running: boolean;
}
interface ThoughtItem {
  kind: 'thought';
  key: string;
  text: string;
}
type TimelineItem = ToolItem | ThoughtItem;

interface PhaseBlock {
  key: string;
  phase: GenerationPhase;
  round: number;
  note?: string;
  done: boolean;
  items: TimelineItem[];
}

export interface TimelineModel {
  dataSources: DataSourceKind[] | null;   // null = job_start 未到；[] = 纯模型知识调研
  candidates: ResearchPoi[];
  phases: PhaseBlock[];
  usage: { tokensIn: number; tokensOut: number; amapCalls: number; searchCalls: number } | null;
  terminal: Extract<GenerationEvent, { type: 'job_done' | 'job_error' | 'job_cancelled' }> | null;
}

/** 从事件流重建时间线（全量重放友好——刷新恢复直接复用） */
export function buildTimeline(events: GenerationEvent[]): TimelineModel {
  const model: TimelineModel = { dataSources: null, candidates: [], phases: [], usage: null, terminal: null };
  let seq = 0;
  for (const ev of events) {
    seq += 1;
    switch (ev.type) {
      case 'job_start':
        model.dataSources = ev.dataSources;
        break;
      case 'phase_start':
        model.phases.push({ key: `${ev.phase}-${ev.round}`, phase: ev.phase, round: ev.round, note: ev.note, done: false, items: [] });
        break;
      case 'phase_end': {
        const block = model.phases.find((p) => p.phase === ev.phase && p.round === ev.round);
        if (block) block.done = true;
        break;
      }
      case 'thought': {
        const block = model.phases.at(-1);
        block?.items.push({ kind: 'thought', key: `t${seq}`, text: ev.text });
        break;
      }
      case 'tool_start': {
        const block = model.phases.find((p) => p.phase === ev.phase && !p.done) ?? model.phases.at(-1);
        block?.items.push({ kind: 'tool', key: ev.toolCallId, label: ev.label, summary: '', isError: false, running: true });
        break;
      }
      case 'tool_end': {
        for (const p of model.phases) {
          const item = p.items.find((i): i is ToolItem => i.kind === 'tool' && i.key === ev.toolCallId);
          if (item) {
            item.summary = ev.summary;
            item.isError = ev.isError;
            item.running = false;
            break;
          }
        }
        break;
      }
      case 'candidate':
        model.candidates.push(ev.poi);
        break;
      case 'usage':
        model.usage = { tokensIn: ev.tokensIn, tokensOut: ev.tokensOut, amapCalls: ev.amapCalls, searchCalls: ev.searchCalls };
        break;
      case 'job_done':
      case 'job_error':
      case 'job_cancelled':
        model.terminal = ev;
        break;
    }
  }
  return model;
}

/** 数据源降级提示：双源齐全不提示；部分/全无时注明本次实际所用 */
function sourceBanner(sources: DataSourceKind[] | null): string | null {
  if (sources === null || sources.length >= 2) return null;
  if (sources.length === 0) return '未配置外部数据源，本次基于模型知识调研。';
  return sources[0] === 'amap'
    ? '全网搜索不可用，本次基于高德地点数据 + 模型知识调研。'
    : '高德地点数据不可用，本次基于全网搜索 + 模型知识调研。';
}

function usageText(usage: TimelineModel['usage']): string {
  if (!usage) return ' ';
  const calls = [usage.amapCalls ? `高德 ${usage.amapCalls} 次` : '', usage.searchCalls ? `搜索 ${usage.searchCalls} 次` : '']
    .filter(Boolean)
    .join('｜');
  return `Token ${usage.tokensIn + usage.tokensOut}（入 ${usage.tokensIn} / 出 ${usage.tokensOut}）${calls ? `｜${calls}` : ''}`;
}

export function GenerationTimeline({
  events,
  onCancel,
  cancelling,
  cancellationError,
}: {
  events: GenerationEvent[];
  onCancel: () => void;
  cancelling: boolean;
  cancellationError: string | null;
}) {
  const model = useMemo(() => buildTimeline(events), [events]);
  const running = model.terminal === null;
  const banner = sourceBanner(model.dataSources);

  return (
    <div className="gen-timeline">
      {banner && <p className="gen-banner">{banner}</p>}

      {model.phases.map((block) => (
        <section key={block.key} className={`gen-phase ${block.done ? 'is-done' : 'is-running'}`}>
          <header className="gen-phase-head">
            <span className="gen-phase-icon">{PHASE_ICON[block.phase]}</span>
            <span className="gen-phase-title">
              {PHASE_LABEL[block.phase]}
              {block.round > 1 && <span className="gen-round">第 {block.round} 轮</span>}
            </span>
            <span className={`gen-phase-state ${block.done ? 'ok' : ''}`}>{block.done ? '完成' : <span className="spinner" />}</span>
          </header>
          {block.note && <p className="gen-note">{block.note}</p>}
          <ul className="gen-items">
            {block.items.map((item) =>
              item.kind === 'tool' ? (
                <li key={item.key} className={`gen-tool ${item.isError ? 'is-error' : ''}`}>
                  <span className="gen-tool-label">
                    {item.running ? <span className="spinner" /> : item.isError ? '⚠' : '·'} {item.label}
                  </span>
                  {item.summary && <span className="gen-tool-summary">{item.summary}</span>}
                </li>
              ) : (
                <li key={item.key} className="gen-thought">
                  <details>
                    <summary>思考过程</summary>
                    <p>{item.text}</p>
                  </details>
                </li>
              ),
            )}
            {!block.items.length && !block.done && <li className="gen-tool muted">准备中…</li>}
          </ul>
          {/* 候选卡片随 candidate 事件实时长出（仅调研阶段产生） */}
          {block.phase === 'research' && model.candidates.length > 0 && (
            <div className="gen-candidates">
              {model.candidates.map((p) => (
                <PoiCard key={p.id} poi={p} compact />
              ))}
            </div>
          )}
        </section>
      ))}
      {!model.phases.length && <p className="gen-note">任务排队中…</p>}

      {running && cancellationError && (
        <p className="form-error" role="alert">
          {cancellationError}
        </p>
      )}

      <footer className="gen-foot">
        <span className="muted">{usageText(model.usage)}</span>
        {running && (
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={cancelling}>
            {cancelling ? '取消中…' : '取消生成'}
          </button>
        )}
      </footer>
    </div>
  );
}
