// 生成进度时间线：三阶段分组 + 工具时间线 + 候选卡片实时长出 + 思考折叠 + 用量/取消（PRD F1）
import { useEffect, useMemo, useState } from 'react';
import type { DataSourceKind, GenerationEvent, GenerationPhase } from '@tripweaver/shared';
import { buildTimeline, formatDuration, type TimelineModel } from '../lib/generationTimeline';
import { PoiCard } from './PoiCard';

const PHASE_LABEL: Record<GenerationPhase, string> = {
  research: '调研灵感',
  plan: '编排行程',
  review: '审校把关',
};
const PHASE_ICON: Record<GenerationPhase, string> = { research: '🔍', plan: '🗺️', review: '✅' };

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

function DurationValue({ durationMs, className }: { durationMs: number | undefined; className?: string }) {
  return durationMs === undefined ? null : <span className={className}>{formatDuration(durationMs)}</span>;
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
  const [now, setNow] = useState(() => Date.now());
  const banner = sourceBanner(model.dataSources);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [running]);
  const totalDuration = model.durationMs ?? (running && model.startedAt !== undefined ? Math.max(0, now - model.startedAt) : undefined);

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
            <span className={`gen-phase-state ${block.done ? 'ok' : ''}`}>
              {block.done ? '完成' : <span className="spinner" />}
              <DurationValue
                durationMs={block.durationMs ?? (!block.done && block.startedAt !== undefined ? Math.max(0, now - block.startedAt) : undefined)}
              />
            </span>
          </header>
          {block.note && <p className="gen-note">{block.note}</p>}
          <ul className="gen-items">
            {block.items.map((item) =>
              item.kind === 'tool' ? (
                <li key={item.key} className={`gen-tool ${item.isError ? 'is-error' : ''}`}>
                  <span className="gen-tool-label">
                    {item.running ? <span className="spinner" /> : item.isError ? '⚠' : '·'} {item.label}
                    <DurationValue
                      className="gen-duration"
                      durationMs={item.durationMs ?? (item.running && item.startedAt !== undefined ? Math.max(0, now - item.startedAt) : undefined)}
                    />
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
        <span className="gen-metrics muted">
          {totalDuration !== undefined && <span>总耗时 {formatDuration(totalDuration)}</span>}
          <span>{usageText(model.usage)}</span>
        </span>
        {running && (
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={cancelling}>
            {cancelling ? '取消中…' : '取消生成'}
          </button>
        )}
      </footer>
    </div>
  );
}
