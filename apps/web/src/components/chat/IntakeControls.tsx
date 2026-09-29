// 追问控件：由服务端下发的 inputSchema 决定形态（enum → 按钮组，date-range → 日期输入，其余 → 文本框）。
//
// 关键取舍：只有一个缺失字段时走 PATCH /brief（结构化、不经过 LLM、结果精确）；
// 多个字段同时缺时只能给自由文本，走发消息让模型抽。
import { useState, type FormEvent } from 'react';
import type { BriefIntake, BriefMissingField, PlanningBriefPatch } from '@tripweaver/shared';
import { intakeShape } from '../../lib/chatDerive';

interface Props {
  intake: BriefIntake;
  disabled: boolean;
  onPatch: (patch: PlanningBriefPatch) => void;
  onText: (text: string) => void;
}

/** 单项缺失时，追问字段 → Brief 补丁键；dateRange 是合成项，要同时给两个键 */
const MISSING_FIELD_KEY: Record<BriefMissingField, keyof PlanningBriefPatch | null> = {
  destination: 'destination',
  startDate: 'startDate',
  endDate: 'endDate',
  pace: 'pace',
  dateRange: null,
};

export function IntakeControls({ intake, disabled, onPatch, onText }: Props) {
  const [draft, setDraft] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const shape = intakeShape(intake);
  const only = intake.missingFields.length === 1 ? intake.missingFields[0] : undefined;
  const onlyKey = only ? MISSING_FIELD_KEY[only] : null;

  const submitText = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || disabled) return;
    // 只缺一项且该项是普通文本字段 → 结构化写入；否则当自由文本发出去
    if (onlyKey && onlyKey !== 'pace') onPatch({ [onlyKey]: text } as PlanningBriefPatch);
    else onText(text);
    setDraft('');
  };

  /**
   * 选项点击的分流：
   * - canonical（服务端给的字段值）→ 直接 PATCH，精确、不花一次对话轮次
   * - natural（模型给的自然语言候选）→ 当消息发回去让模型解析
   */
  const submitOption = (value: string) => {
    if (disabled) return;
    if (intake.inputSchema.enumKind === 'natural' || !onlyKey) {
      onText(value);
      return;
    }
    onPatch({ [onlyKey]: value } as PlanningBriefPatch);
  };

  const submitDates = (event: FormEvent) => {
    event.preventDefault();
    if (disabled) return;
    const patch: PlanningBriefPatch = {};
    const wantsStart = !only || only === 'startDate' || only === 'dateRange';
    const wantsEnd = !only || only === 'endDate' || only === 'dateRange';
    if (wantsStart && startDate) patch.startDate = startDate;
    if (wantsEnd && endDate) patch.endDate = endDate;
    // 只填了其中一个也提交：先收下能收的，剩下的下一轮继续问
    if (Object.keys(patch).length === 0) return;
    onPatch(patch);
    setStartDate('');
    setEndDate('');
  };

  return (
    <div className={"chat-intake [border:1px_dashed_var(--color-border)] [border-radius:var(--radius)] [padding:10px] flex flex-col [gap:8px] [background:var(--color-card)]"}>
      <p className={"chat-intake-question m-0 [font-size:0.88rem]"}>{intake.question}</p>

      {shape === 'buttons' && intake.inputSchema.enum && (
        <div className={"preset-row flex [gap:8px] flex-wrap"}>
          {intake.inputSchema.enum.map((value, index) => (
            <button
              key={value}
              type="button"
              className={"btn [border:1px_solid_transparent] cursor-pointer [background:none] [color:var(--color-text)] inline-flex items-center [gap:4px] [&:disabled]:[opacity:0.55] [&:disabled]:[cursor:not-allowed] btn-chip [border-color:var(--color-border)] rounded-full [padding:4px_12px] [font-size:0.82rem] [&.is-active]:[background:var(--color-primary)] [&.is-active]:[border-color:var(--color-primary)] [&.is-active]:[color:var(--color-btn-primary-color-3)]"}
              disabled={disabled}
              onClick={() => submitOption(value)}
            >
              {intake.inputSchema.enumLabels?.[index] ?? value}
            </button>
          ))}
        </div>
      )}

      {shape === 'date-range' && (
        <form className={"chat-intake-row flex [gap:8px] items-center flex-wrap [&_input]:flex-1 [&_input]:[min-width:120px] [&_input]:[border:1px_solid_var(--color-border)] [&_input]:[border-radius:var(--radius)] [&_input]:[padding:6px_10px] [&_input]:[font:inherit] [&_input]:[font-size:0.88rem]"} onSubmit={submitDates}>
          <input
            type="date"
            aria-label="开始日期"
            value={startDate}
            disabled={disabled}
            onChange={(e) => setStartDate(e.target.value)}
          />
          <span className={"muted [color:var(--color-muted)] [font-size:0.88rem]"}>至</span>
          <input type="date" aria-label="结束日期" value={endDate} disabled={disabled} onChange={(e) => setEndDate(e.target.value)} />
          <button type="submit" className={"btn [border:1px_solid_transparent] [border-radius:var(--radius)] [padding:8px_14px] [font-size:0.9rem] cursor-pointer inline-flex items-center [gap:4px] [&:disabled]:[opacity:0.55] [&:disabled]:[cursor:not-allowed] btn-primary [background:var(--color-primary)] [color:var(--color-btn-primary-color-3)] [&:not(:disabled):hover]:[background:var(--color-primary-dark)]"} disabled={disabled || (!startDate && !endDate)}>
            确定
          </button>
        </form>
      )}

      {shape === 'text' && (
        <form className={"chat-intake-row flex [gap:8px] items-center flex-wrap [&_input]:flex-1 [&_input]:[min-width:120px] [&_input]:[border:1px_solid_var(--color-border)] [&_input]:[border-radius:var(--radius)] [&_input]:[padding:6px_10px] [&_input]:[font:inherit] [&_input]:[font-size:0.88rem]"} onSubmit={submitText}>
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="直接回答…" maxLength={200} aria-label={intake.question} />
          <button type="submit" className={"btn [border:1px_solid_transparent] [border-radius:var(--radius)] [padding:8px_14px] [font-size:0.9rem] cursor-pointer inline-flex items-center [gap:4px] [&:disabled]:[opacity:0.55] [&:disabled]:[cursor:not-allowed] btn-primary [background:var(--color-primary)] [color:var(--color-btn-primary-color-3)] [&:not(:disabled):hover]:[background:var(--color-primary-dark)]"} disabled={disabled || !draft.trim()}>
            发送
          </button>
        </form>
      )}
    </div>
  );
}
