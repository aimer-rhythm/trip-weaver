// 编辑器内嵌对话面板（09-24 R2/R4）：行程页左侧常驻，边看图边聊、直接发起按需修改。
// 09-26 起为对话的唯一入口（收集型对话页已删除，行程创建走首页城市选择 + 结构化表单）。
// 复用 MessageBubble / ChatInput 与 useSendMessage / usePatchBrief，不复制消息流逻辑。
//
// 结果处理：
//   - editResult：服务端已落版本链下一版 → 失效行程缓存并跳转到新版本（编辑器随之重载）
//   - autoStartedJobId：用户又把条件聊齐触发了重新生成 → 跳 /trips/new 由其恢复逻辑接管进度
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { keys, useConversation, usePatchBrief, useSendMessage } from '../../api/hooks';
import { activeIntake, chatErrorMessage, isIntakeLive } from '../../lib/chatDerive';
import { ACTIVE_JOB_KEY } from '../../hooks/useGenerationRun';
import { ChatInput } from './ChatInput';
import { MessageBubble } from './MessageBubble';

interface Props {
  conversationId: string;
  /** 当前打开的行程版本 id：编辑产出新版本后据此判断是否要跳转 */
  currentTripId: string;
}

export function ChatPanel({ conversationId, currentTripId }: Props) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const detail = useConversation(conversationId);
  const sendMessage = useSendMessage();
  const patchBrief = usePatchBrief();

  const [error, setError] = useState<string | null>(null);
  const [pendingText, setPendingText] = useState<string | null>(null);
  const streamRef = useRef<HTMLDivElement | null>(null);

  const messages = detail.data?.messages ?? [];
  const busy = sendMessage.isPending || patchBrief.isPending;

  // 新消息到达后滚到底部
  useEffect(() => {
    streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight });
  }, [messages.length, pendingText, busy]);

  const sendText = async (text: string) => {
    setError(null);
    setPendingText(text);
    try {
      const result = await sendMessage.mutateAsync({ id: conversationId, text });
      if (result.autoStartedJobId) {
        // 写回 ACTIVE_JOB_KEY 后跳对话页，由其恢复逻辑接管进度（不在这里复制 SSE 视图）
        sessionStorage.setItem(ACTIVE_JOB_KEY, result.autoStartedJobId);
        navigate('/trips/new');
        return;
      }
      if (result.editResult && result.editResult.tripId !== currentTripId) {
        await qc.invalidateQueries({ queryKey: keys.trips });
        // 旧版本的版本链缓存已过时（多了新一版），一并失效
        await qc.invalidateQueries({ queryKey: keys.tripVersions(currentTripId) });
        navigate(`/trips/${result.editResult.tripId}`);
        return;
      }
    } catch (err) {
      setError(chatErrorMessage(err));
    } finally {
      setPendingText(null);
    }
  };

  const applyPatch = async (patch: Parameters<typeof patchBrief.mutateAsync>[0]['patch']) => {
    setError(null);
    try {
      await patchBrief.mutateAsync({ id: conversationId, patch });
    } catch (err) {
      setError(chatErrorMessage(err));
    }
  };

  const liveIntake = activeIntake(messages);

  return (
    <div className={"chat-panel flex-1 flex flex-col min-h-0 [padding:10px] [gap:8px] [&_.chat-stream]:p-0"}>
      <div className={"chat-stream flex flex-col [gap:10px] flex-1 min-h-0 overflow-y-auto [padding:4px_0_12px]"} ref={streamRef}>
        {detail.isPending && <div className={"page-loading [padding:20vh_16px] text-center [color:var(--color-muted)]"}>正在加载对话…</div>}
        {detail.isError && <p className={"form-error [color:var(--color-danger)] [font-size:0.85rem] m-0"}>{chatErrorMessage(detail.error)}</p>}
        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            intakeLive={Boolean(liveIntake) && isIntakeLive(messages, message)}
            disabled={busy}
            onPatch={(patch) => void applyPatch(patch)}
            onText={(text) => void sendText(text)}
          />
        ))}
        {pendingText && (
          <div className={"chat-msg flex flex-col [gap:6px] [max-width:86%] chat-msg-user [align-self:flex-end] items-end [&_.chat-bubble]:[background:var(--color-primary)] [&_.chat-bubble]:[border-color:var(--color-primary)] [&_.chat-bubble]:[color:var(--color-btn-primary-color-3)]"}>
            <div className={"chat-bubble [padding:8px_12px] [border-radius:var(--radius)] [border:1px_solid_var(--color-border)] [background:var(--color-card)] [font-size:0.9rem] [white-space:pre-wrap] [word-break:break-word]"}>{pendingText}</div>
          </div>
        )}
        {busy && (
          <div className={"chat-msg flex flex-col [gap:6px] [max-width:86%] chat-msg-assistant [align-self:flex-start] items-start"}>
            <div className={"chat-bubble [padding:8px_12px] [border-radius:var(--radius)] [border:1px_solid_var(--color-border)] [background:var(--color-card)] [white-space:pre-wrap] [word-break:break-word] muted [color:var(--color-muted)] [font-size:0.88rem]"}>正在理解…</div>
          </div>
        )}
      </div>
      {error && <p className={"form-error [color:var(--color-danger)] [font-size:0.85rem] m-0"}>{error}</p>}
      <ChatInput disabled={busy} sending={busy} onSend={(text) => void sendText(text)} />
    </div>
  );
}
