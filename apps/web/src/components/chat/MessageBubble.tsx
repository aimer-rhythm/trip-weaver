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
    <div className={`chat-msg ${isUser ? 'chat-msg-user' : 'chat-msg-assistant'}`}>
      <div className="chat-bubble">{message.content}</div>
      {!isUser && intakeLive && message.intake && (
        <IntakeControls intake={message.intake} disabled={disabled} onPatch={onPatch} onText={onText} />
      )}
    </div>
  );
}
