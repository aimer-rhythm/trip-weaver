// 单条消息气泡：用户右侧 / AI 左侧。AI 消息若带有「仍然生效」的追问控件，就地渲染控件。
import type { ChatMessage, PlanningBriefPatch } from '@tripweaver/shared';
import { IntakeControls } from './IntakeControls';

interface Props {
  message: ChatMessage;
  /** 该消息的 intake 是否仍然生效（回答过就收起，避免重复点击） */
  intakeLive: boolean;
  disabled: boolean;
  onPatch: (patch: PlanningBriefPatch) => void;
  onText: (text: string) => void;
}

export function MessageBubble({ message, intakeLive, disabled, onPatch, onText }: Props) {
  const isUser = message.role === 'user';
  return (
    <div className={`chat-msg flex flex-col [gap:6px] [max-width:86%] ${isUser ? "chat-msg-user [align-self:flex-end] items-end [&_.chat-bubble]:[background:var(--color-primary)] [&_.chat-bubble]:[border-color:var(--color-primary)] [&_.chat-bubble]:[color:var(--color-btn-primary-color-3)]" : "chat-msg-assistant [align-self:flex-start] items-start"}`}>
      <div className={"chat-bubble [padding:8px_12px] [border-radius:var(--radius)] [border:1px_solid_var(--color-border)] [background:var(--color-card)] [font-size:0.9rem] [white-space:pre-wrap] [word-break:break-word]"}>{message.content}</div>
      {!isUser && intakeLive && message.intake && (
        <IntakeControls intake={message.intake} disabled={disabled} onPatch={onPatch} onText={onText} />
      )}
    </div>
  );
}
