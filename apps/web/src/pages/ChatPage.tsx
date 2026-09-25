// 新建行程（问答式入口）：对话收集条件 → 常驻可编辑确认卡 → 确认后走既有生成链路。
//
// 边界（PRD R1）：/trips/new 不再有表单。对话只收集与修正条件，
// 行程仍由 POST /api/generations 产出，生成进度复用既有 SSE 时间线。
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { briefToGenerateForm, requiredBriefFields, type PlanningBriefData, type PlanningBriefPatch, type PlanningBriefView } from '@tripweaver/shared';
import {
  useConversation,
  useConversations,
  useCreateConversation,
  useDeleteConversation,
  usePatchBrief,
  useSendMessage,
  useUsage,
} from '../api/hooks';
import { GenerationRunPanel } from '../components/GenerationRunPanel';
import { BriefCard } from '../components/chat/BriefCard';
import { ChatInput } from '../components/chat/ChatInput';
import { ConversationPicker } from '../components/chat/ConversationPicker';
import { MessageBubble } from '../components/chat/MessageBubble';
import { useGenerationRun } from '../hooks/useGenerationRun';
import { activeIntake, canGenerate, chatErrorMessage, isIntakeLive } from '../lib/chatDerive';
import { useQueryClient } from '@tanstack/react-query';
import { keys } from '../api/hooks';

const CONVERSATION_KEY = 'tw.activeConversationId';

/** 开场示例：用户不知道能说什么时，给具体的例子而不是空输入框 */
const EXAMPLES = ['11月去成都玩3天，带2岁小孩', '周末去杭州，不想爬山，想吃本地菜', '下个月去东京 5 天'];

/**
 * 还没建会话时也把确认卡画出来：确认卡是「常驻的状态面板」，不是「有数据才出现的弹窗」。
 * 否则首屏只剩一个输入框，用户完全不知道会被收集哪些条件。
 */
const EMPTY_BRIEF_DATA: PlanningBriefData = { constraints: [] };
const EMPTY_BRIEF: PlanningBriefView = {
  status: 'collecting',
  data: EMPTY_BRIEF_DATA,
  missingFields: requiredBriefFields(EMPTY_BRIEF_DATA),
  updatedAt: 0,
};

export function ChatPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [conversationId, setConversationId] = useState<string | null>(() => sessionStorage.getItem(CONVERSATION_KEY));
  const [error, setError] = useState<string | null>(null);
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [doneTripId, setDoneTripId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const streamRef = useRef<HTMLDivElement | null>(null);

  const list = useConversations();
  const usage = useUsage();
  const detail = useConversation(conversationId);
  const createConversation = useCreateConversation();
  const deleteConversation = useDeleteConversation();
  const sendMessage = useSendMessage();
  const patchBrief = usePatchBrief();

  const openTrip = useCallback((tripId: string) => setDoneTripId(tripId), []);
  const run = useGenerationRun({ onDone: openTrip });

  const messages = detail.data?.messages ?? [];
  const brief = detail.data?.conversation.brief ?? EMPTY_BRIEF;
  const chatUsage = list.data?.chatUsage;
  const generationExhausted = usage.data?.remaining === 0;
  const busy = sendMessage.isPending || patchBrief.isPending || createConversation.isPending;

  // 生成成功：先让结果卡片可见，再跳编辑器（与原表单页的停留时长一致）
  useEffect(() => {
    if (!doneTripId) return;
    const timer = setTimeout(() => navigate(`/trips/${doneTripId}`), 1800);
    return () => clearTimeout(timer);
  }, [doneTripId, navigate]);

  // 新消息到达后滚到底部
  useEffect(() => {
    streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight });
  }, [messages.length, pendingText, busy, conversationId]);

  const rememberConversation = useCallback((id: string | null) => {
    if (id) sessionStorage.setItem(CONVERSATION_KEY, id);
    else sessionStorage.removeItem(CONVERSATION_KEY);
    setConversationId(id);
  }, []);

  /** 惰性建会话：只在真的要发第一条消息时创建，避免留下一堆空会话行 */
  const ensureConversation = useCallback(async (): Promise<string> => {
    if (conversationId) return conversationId;
    const created = await createConversation.mutateAsync();
    rememberConversation(created.id);
    return created.id;
  }, [conversationId, createConversation, rememberConversation]);

  const sendText = useCallback(
    async (text: string) => {
      setError(null);
      setPendingText(text);
      try {
        const id = await ensureConversation();
        const result = await sendMessage.mutateAsync({ id, text });
        // R3：服务端判信息齐备已自动起生成任务，前端直接接管进度
        if (result.autoStartedJobId) run.adopt(result.autoStartedJobId);
        // R1：按需修订落了新版本，跳转到新版本编辑页（版本链切换）
        if (result.editResult && result.editResult.tripId !== detail.data?.latestTrip?.id) {
          qc.invalidateQueries({ queryKey: keys.trips });
          navigate(`/trips/${result.editResult.tripId}`);
        }
      } catch (err) {
        setPendingText(null);
        setError(chatErrorMessage(err));
        return;
      }
      setPendingText(null);
    },
    [ensureConversation, sendMessage, run, qc, navigate, detail.data?.latestTrip?.id],
  );

  /** 确认卡上的编辑：还没建会话时先建（让用户不聊天也能先点选条件） */
  const applyPatch = useCallback(
    async (patch: PlanningBriefPatch) => {
      setError(null);
      try {
        const id = await ensureConversation();
        await patchBrief.mutateAsync({ id, patch });
      } catch (err) {
        setError(chatErrorMessage(err));
      }
    },
    [ensureConversation, patchBrief],
  );

  const generate = useCallback(() => {
    if (!brief || !canGenerate(brief)) return;
    run.start({ ...briefToGenerateForm(brief.data), ...(conversationId ? { conversationId } : {}) });
  }, [brief, conversationId, run]);

  const startNewConversation = useCallback(() => {
    setError(null);
    setPendingText(null);
    rememberConversation(null);
  }, [rememberConversation]);

  const removeConversation = useCallback(
    async (id: string) => {
      if (!window.confirm('删除这条对话？已经生成的行程不会受影响。')) return;
      try {
        await deleteConversation.mutateAsync(id);
      } catch (err) {
        setError(chatErrorMessage(err));
        return;
      }
      if (id === conversationId) startNewConversation();
    },
    [conversationId, deleteConversation, startNewConversation],
  );

  // ---------- 生成中 / 结果视图 ----------
  if (run.restoring) {
    return (
      <div className="page">
        <div className="page-loading">正在恢复生成进度…</div>
      </div>
    );
  }

  if (run.jobId) {
    return (
      <div className="page chat-page">
        <div className="page-head">
          <h1>智能生成中</h1>
        </div>
        <GenerationRunPanel
          events={run.events}
          cancelling={run.cancelPending}
          cancellationError={run.cancellationError}
          onCancel={run.cancel}
          onReset={run.reset}
          onOpenTrip={(tripId) => navigate(`/trips/${tripId}`)}
        />
      </div>
    );
  }

  // ---------- 对话视图 ----------
  const liveIntake = activeIntake(messages);
  const showEmptyState = messages.length === 0 && !pendingText;

  return (
    <div className="page chat-page is-chat">
      <div className="page-head">
        <h1>新建行程</h1>
        <div className="page-head-actions">
          {usage.data && (
            <span className="quota-inline muted">
              今日剩余 {usage.data.remaining} / {usage.data.dailyLimit} 次生成
              {chatUsage && ` · 对话 ${chatUsage.usedToday} / ${chatUsage.dailyLimit} 轮`}
            </span>
          )}
          {conversationId && (
            <button type="button" className="btn btn-ghost" onClick={startNewConversation}>
              新对话
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={() => setPickerOpen(true)}>
            历史对话
          </button>
        </div>
      </div>

      <div className="chat-stream" ref={streamRef}>
        {conversationId && detail.isPending && messages.length === 0 && (
          <div className="page-loading">正在加载对话…</div>
        )}
        {conversationId && detail.isError && (
          <p className="form-error">
            {chatErrorMessage(detail.error)}
            <button type="button" className="btn btn-ghost" onClick={startNewConversation}>
              开始新对话
            </button>
          </p>
        )}

        {showEmptyState && (
          <div className="chat-empty">
            <p className="chat-empty-title">用一句话说说你的行程</p>
            <p className="muted">我会边聊边把条件记进下面的确认卡，齐了再开始生成。</p>
            <div className="preset-row">
              {EXAMPLES.map((example) => (
                <button key={example} type="button" className="btn btn-chip" disabled={busy} onClick={() => void sendText(example)}>
                  {example}
                </button>
              ))}
            </div>
          </div>
        )}

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
          <div className="chat-msg chat-msg-user">
            <div className="chat-bubble">{pendingText}</div>
          </div>
        )}
        {busy && <div className="chat-msg chat-msg-assistant"><div className="chat-bubble muted">正在理解…</div></div>}
      </div>

      {error && <p className="form-error">{error}</p>}
      {run.errorMessage && <p className="form-error">{run.errorMessage}</p>}

      <BriefCard
        brief={brief}
        generating={run.starting}
        generationExhausted={generationExhausted}
        disabled={busy}
        onPatch={(patch) => void applyPatch(patch)}
        onGenerate={generate}
      />

      <ChatInput disabled={busy} sending={busy} onSend={(text) => void sendText(text)} />

      {pickerOpen && (
        <ConversationPicker
          conversations={list.data?.conversations ?? []}
          activeId={conversationId}
          loading={list.isPending}
          onSelect={(id) => {
            setError(null);
            rememberConversation(id);
            setPickerOpen(false);
          }}
          onDelete={(id) => void removeConversation(id)}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
