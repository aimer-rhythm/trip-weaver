// 对话内修订确认卡（PR6）：模型识别出「改已有行程」后给一个显式确认入口。
//
// 为什么不自动重跑：修订会消耗一次生成配额、且不再是原来那份行程，
// 必须由用户明确点头（与「开始生成」同一原则）。
interface Props {
  currentVersion: number;
  notes: string;
  busy: boolean;
  generationExhausted: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}

export function RevisionCard({ currentVersion, notes, busy, generationExhausted, onConfirm, onDismiss }: Props) {
  return (
    <section className="chat-revision" aria-label="行程修订确认">
      <p className="chat-revision-title">✏️ 按这些意见改一版？</p>
      <p className="chat-revision-notes">{notes}</p>
      <p className="muted">会生成 v{currentVersion + 1}，现在的 v{currentVersion} 保留，可随时切回去对比。</p>
      <div className="chat-revision-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || generationExhausted}
          onClick={onConfirm}
        >
          {generationExhausted ? '今日次数已用完' : busy ? '创建任务中…' : `生成 v${currentVersion + 1} ✨`}
        </button>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={onDismiss}>
          先不改
        </button>
      </div>
    </section>
  );
}
