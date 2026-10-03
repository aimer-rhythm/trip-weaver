// 单条消息气泡：用户右侧 / AI 左侧。AI 消息若带有「仍然生效」的追问控件，就地渲染控件。
import type { ChatMessage, PlanningBriefPatch } from '@tripweaver/shared';
import { IntakeControls } from './IntakeControls';
import { ChatText } from './ChatText';
import { ChatProgress } from './ChatProgress';

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
    <div className={`chat-msg flex min-w-0 flex-col gap-2 ${isUser ? 'chat-msg-user ml-auto max-w-[88%] items-end' : 'chat-msg-assistant w-full items-start'}`}>
      {message.attachment && <ChatProgress steps={message.attachment.summary} />}
      <div className={`chat-bubble whitespace-pre-wrap break-words rounded-[18px] px-4 py-3 text-[16px] leading-[1.6] text-[var(--color-editor-page-color-96)] ${isUser ? 'bg-[var(--color-editor-page-background-97)]' : 'bg-[var(--color-editor-page-background-95)]'}`}><ChatText text={message.content} /></div>
      {!isUser && Boolean(message.attachment?.references?.some((source) => /^https?:\/\//i.test(source.url))) && (
        <details className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm">
          <summary className="cursor-pointer py-1">参考资料</summary>
          <ul className="mt-2 space-y-2">
            {message.attachment?.references?.filter((source) => /^https?:\/\//i.test(source.url)).map((source) => (
              <li key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer" className="block break-words py-1 underline underline-offset-4">{source.title || '查看来源'}</a></li>
            ))}
          </ul>
        </details>
      )}
      {!isUser && intakeLive && message.intake && (
        <IntakeControls intake={message.intake} disabled={disabled} onPatch={onPatch} onText={onText} />
      )}
    </div>
  );
}
