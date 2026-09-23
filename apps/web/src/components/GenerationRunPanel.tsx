// 生成进度视图：SSE 时间线 + 终态结果卡片 + 取消。
// 从原 PlannerPage 的「运行/结果视图」抽出，行为不变；问答式入口直接复用。
import { GENERATION_TIMEOUT_MINUTES, type GenerationEvent } from '@tripweaver/shared';
import { GenerationTimeline } from './GenerationTimeline';

interface Props {
  events: GenerationEvent[];
  cancelling: boolean;
  cancellationError: string | null;
  onCancel: () => void;
  /** 终态后回到可重新发起的状态 */
  onReset: () => void;
  onOpenTrip: (tripId: string) => void;
}

export function GenerationRunPanel({ events, cancelling, cancellationError, onCancel, onReset, onOpenTrip }: Props) {
  const terminal = events.find(
    (ev): ev is Extract<GenerationEvent, { type: 'job_done' | 'job_error' | 'job_cancelled' }> =>
      ev.type === 'job_done' || ev.type === 'job_error' || ev.type === 'job_cancelled',
  );

  return (
    <>
      <GenerationTimeline
        events={events}
        onCancel={onCancel}
        cancelling={cancelling}
        cancellationError={cancellationError}
      />

      {terminal?.type === 'job_done' && (
        <div className="gen-result gen-result-ok">
          <p className="gen-result-title">行程已生成！正在打开编辑器…</p>
          {terminal.reviewNotes.length > 0 && (
            <ul className="gen-review-notes">
              {terminal.reviewNotes.map((note, i) => (
                <li key={i}>📝 {note}</li>
              ))}
            </ul>
          )}
          <button type="button" className="btn btn-primary" onClick={() => onOpenTrip(terminal.tripId)}>
            立即打开
          </button>
        </div>
      )}

      {terminal?.type === 'job_error' && (
        <div className="gen-result gen-result-err">
          <p className="gen-result-title">生成失败</p>
          <p className="muted">{terminal.message}（失败不计入今日配额）</p>
          <button type="button" className="btn btn-primary" onClick={onReset}>
            返回重试
          </button>
        </div>
      )}

      {terminal?.type === 'job_cancelled' && (
        <div className="gen-result">
          <p className="gen-result-title">已取消</p>
          <p className="muted">
            {terminal.reason === 'timeout'
              ? `生成超过 ${GENERATION_TIMEOUT_MINUTES} 分钟未完成，系统已自动取消。本次不计入今日配额，可稍后重新生成。`
              : '你已取消本次生成。本次不计入今日配额。'}
          </p>
          <button type="button" className="btn btn-primary" onClick={onReset}>
            返回对话
          </button>
        </div>
      )}
    </>
  );
}
