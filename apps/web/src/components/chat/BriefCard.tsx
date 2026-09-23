// 行程确认卡：常驻在对话流底部，一眼看到「已确定什么 / 还差什么」。
// PR4：每个字段可点开直接改；约束可单条「本次排除」（文案随 polarity 变）。
import { useState } from 'react';
import {
  BRIEF_MISSING_FIELD_LABELS,
  CONSTRAINT_CATEGORY_LABELS,
  TRANSPORT_MODES,
  TRIP_FOCUS_LABELS,
  TRIP_FOCUS_OPTIONS,
  type PlanningBriefPatch,
  type PlanningBriefView,
} from '@tripweaver/shared';
import { TRANSPORT_LABELS, briefRows, canGenerate, polarityPresentation } from '../../lib/chatDerive';

interface Props {
  brief: PlanningBriefView | null;
  generating: boolean;
  /** 今日生成次数用尽：按钮给出可操作文案，而不是默默置灰 */
  generationExhausted: boolean;
  /** 有一轮编辑/消息在飞时禁用所有输入，避免并发 patch 打架 */
  disabled: boolean;
  onPatch: (patch: PlanningBriefPatch) => void;
  onGenerate: () => void;
}

export function BriefCard({ brief, generating, generationExhausted, disabled, onPatch, onGenerate }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [draftStart, setDraftStart] = useState('');
  const [draftEnd, setDraftEnd] = useState('');

  if (!brief) return null;
  const ready = canGenerate(brief);
  const { constraints } = brief.data;

  const startEdit = (key: string, value: string) => {
    setEditing(key);
    setDraft(value);
    setDraftStart(brief.data.startDate ?? '');
    setDraftEnd(brief.data.endDate ?? '');
  };

  const cancel = () => setEditing(null);

  /** 空文本不提交：服务端把空串当「不改」，提交只会白走一轮 */
  const saveText = (key: 'destination' | 'lodging' | 'extraNotes') => {
    const value = draft.trim();
    if (value) onPatch({ [key]: value });
    cancel();
  };

  const savePartySize = () => {
    const size = Number(draft);
    if (Number.isInteger(size) && size >= 1 && size <= 20) onPatch({ partySize: size });
    cancel();
  };

  const saveDates = () => {
    const patch: PlanningBriefPatch = {};
    if (draftStart) patch.startDate = draftStart;
    if (draftEnd) patch.endDate = draftEnd;
    if (Object.keys(patch).length > 0) onPatch(patch);
    cancel();
  };

  const renderEditor = (key: string) => {
    if (key === 'dates') {
      return (
        <div className="chat-brief-editor">
          <input type="date" aria-label="开始日期" value={draftStart} onChange={(e) => setDraftStart(e.target.value)} />
          <span className="muted">至</span>
          <input type="date" aria-label="结束日期" value={draftEnd} onChange={(e) => setDraftEnd(e.target.value)} />
          <button type="button" className="btn btn-primary" disabled={!draftStart && !draftEnd} onClick={saveDates}>
            保存
          </button>
          <button type="button" className="btn btn-ghost" onClick={cancel}>
            取消
          </button>
        </div>
      );
    }

    if (key === 'tripFocus') {
      return (
        <div className="preset-row">
          {TRIP_FOCUS_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              className={`btn btn-chip ${brief.data.tripFocus === option ? 'is-active' : ''}`}
              onClick={() => {
                onPatch({ tripFocus: option });
                cancel();
              }}
            >
              {TRIP_FOCUS_LABELS[option]}
            </button>
          ))}
        </div>
      );
    }

    if (key === 'transportMode') {
      return (
        <div className="preset-row">
          {TRANSPORT_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              className={`btn btn-chip ${brief.data.transportMode === mode ? 'is-active' : ''}`}
              onClick={() => {
                onPatch({ transportMode: mode });
                cancel();
              }}
            >
              {TRANSPORT_LABELS[mode]}
            </button>
          ))}
        </div>
      );
    }

    if (key === 'partySize') {
      return (
        <div className="chat-brief-editor">
          <input
            type="number"
            min={1}
            max={20}
            aria-label="出行人数"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && savePartySize()}
          />
          <button type="button" className="btn btn-primary" onClick={savePartySize}>
            保存
          </button>
          <button type="button" className="btn btn-ghost" onClick={cancel}>
            取消
          </button>
        </div>
      );
    }

    return (
      <div className="chat-brief-editor">
        <input
          aria-label="修改该字段"
          value={draft}
          maxLength={key === 'extraNotes' ? 200 : 60}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') saveText(key as 'destination' | 'lodging' | 'extraNotes');
            if (e.key === 'Escape') cancel();
          }}
        />
        <button
          type="button"
          className="btn btn-primary"
          disabled={!draft.trim()}
          onClick={() => saveText(key as 'destination' | 'lodging' | 'extraNotes')}
        >
          保存
        </button>
        <button type="button" className="btn btn-ghost" onClick={cancel}>
          取消
        </button>
      </div>
    );
  };

  return (
    <section className="chat-brief" aria-label="行程确认">
      <header className="chat-brief-head">
        <span>📋 行程确认</span>
        <span className={`chat-brief-status ${ready ? 'is-ready' : ''}`}>
          {ready ? '信息齐备' : `还差 ${brief.missingFields.length} 项`}
        </span>
      </header>

      <dl className="chat-brief-rows">
        {briefRows(brief.data).map((row) => (
          <div key={row.key} className={`chat-brief-row ${row.value ? '' : 'is-empty'}`}>
            <dt>{row.label}</dt>
            <dd>
              {editing === row.key ? (
                renderEditor(row.key)
              ) : (
                <button
                  type="button"
                  className="chat-brief-value"
                  disabled={disabled}
                  aria-label={`修改${row.label}`}
                  onClick={() => startEdit(row.key, row.value)}
                >
                  {row.value || '待补充'}
                </button>
              )}
            </dd>
          </div>
        ))}
      </dl>

      {constraints.length > 0 && (
        <ul className="chat-brief-constraints">
          {constraints.map((constraint) => {
            const presentation = polarityPresentation(constraint.polarity);
            return (
              <li key={constraint.id}>
                <span className={`chat-polarity chat-polarity-${constraint.polarity}`}>{presentation.badge}</span>
                <span className="chat-constraint-text">{constraint.valueText}</span>
                <span className="muted">{CONSTRAINT_CATEGORY_LABELS[constraint.category]}</span>
                <button
                  type="button"
                  className="btn btn-ghost chat-constraint-remove"
                  disabled={disabled}
                  onClick={() => onPatch({ removeConstraintIds: [constraint.id] })}
                >
                  {presentation.excludeAction}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {!ready && (
        <p className="chat-brief-missing muted">
          还缺：{brief.missingFields.map((field) => BRIEF_MISSING_FIELD_LABELS[field]).join('、')}
        </p>
      )}

      <button
        type="button"
        className="btn btn-primary btn-block"
        disabled={!ready || generating || generationExhausted}
        onClick={onGenerate}
      >
        {generating
          ? '创建任务中…'
          : generationExhausted
            ? '今日次数已用完'
            : ready
              ? '开始生成 ✨'
              : '条件齐了才能生成'}
      </button>
    </section>
  );
}
