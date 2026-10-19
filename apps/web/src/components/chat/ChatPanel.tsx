import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ACTIVE_JOB_KEY } from '../../hooks/useGenerationRun';
import { completeFollowUpSuggestions, suggestionText, uid, type ChatAttachment, type DetailChatRequest, type SendMessageResult, type Trip, type TripOperationResult } from '@tripweaver/shared';
import { keys, useConversation } from '../../api/hooks';
import { recoverChat, stopChat, streamChat } from '../../api/detailChat';
import { chatErrorMessage } from '../../lib/chatDerive';
import { ChatInput } from './ChatInput';
import { MessageBubble } from './MessageBubble';
import { FoodCard } from './FoodCard';
import { Button } from '../ui/Button';
import { ChatText } from './ChatText';
import { ChatProgress } from './ChatProgress';
import { EditorIcon } from '../editor/EditorIcon';

interface Props {
  conversationId: string; trip: Trip; dayId?: string; readOnly: boolean; busy: boolean;
  begin: () => Promise<Trip>; end: () => void;
  onTrip: (id: string, result?: TripOperationResult) => Promise<void>;
}
const labels = { food: '推荐美食', explore: '看看沿途玩法', pace: '检查行程节奏', more_food: '再推荐几家', light_food: '换成清淡口味', dinner: '看看晚餐' };
const initialSuggestions: ChatAttachment['suggestions'] = ['food', 'explore', 'pace'];

export function ChatPanel({ conversationId, trip, dayId, readOnly, busy, begin, end, onTrip }: Props) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const detail = useConversation(conversationId);
  const [pending, setPending] = useState<{ input: DetailChatRequest; text: string; summary: string[]; state: 'running' | 'stopped' | 'error' } | null>(null);
  const [error, setError] = useState('');
  const [restoreDraft, setRestoreDraft] = useState<{ text: string; key: number }>();
  const [stopping, setStopping] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const scroll = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const controller = useRef<AbortController | null>(null);
  const submitting = useRef(false);
  const allMessages = detail.data?.messages ?? [];
  const generated = allMessages.findIndex((message) => message.relatedTripId);
  // relatedTripId 也会标在真实修改回答上；仅跳过无附件的初始关联记录，不能把最新回答截掉。
  const messages = generated < 0 || allMessages[generated]?.attachment ? allMessages : allMessages.slice(generated + 1);
  const latestMessage = pending ? undefined : messages.at(-1);
  const latestSuggestions = latestMessage?.role === 'assistant' && latestMessage.attachment && !latestMessage.attachment.clarification
    ? completeFollowUpSuggestions(latestMessage.attachment.suggestions, {
      trip, dayId: latestMessage.attachment.dayId, answer: latestMessage.content,
      question: [...messages].reverse().find((message) => message.role === 'user')?.content ?? '',
    }) : [];
  const running = pending?.state === 'running';
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (following.current) scroll.current?.scrollTo({ top: scroll.current.scrollHeight });
  }, [messages.length, pending]);

  const accept = async (result: SendMessageResult) => {
    await qc.invalidateQueries({ queryKey: keys.conversation(conversationId) });
    void qc.invalidateQueries({ queryKey: keys.me });
    if (result.autoStartedJobId) { sessionStorage.setItem(ACTIVE_JOB_KEY, result.autoStartedJobId); navigate('/trips/new'); }
    if (result.editResult && result.editResult.tripId !== trip.id) await onTrip(result.editResult.tripId);
    setPending(null);
  };
  const send = async (text: string, suggestion?: DetailChatRequest['suggestion'], retry?: DetailChatRequest, scopeDayId: string | null = dayId ?? null) => {
    if (submitting.current || busy || readOnly) return;
    submitting.current = true; setError(''); setStopping(false);
    let input: DetailChatRequest | undefined;
    let acquired = false;
    try {
      const saved = await begin();
      acquired = true;
      input = retry ?? { requestId: uid(), text, tripId: saved.id, updatedAt: saved.updatedAt, ...(scopeDayId ? { dayId: scopeDayId } : {}), ...(suggestion ? { suggestion } : {}) };
      setPending({ input, text: '', summary: [], state: 'running' });
      controller.current = new AbortController();
      const result = await streamChat(conversationId, input, controller.current.signal, (event) => {
        if (event.type === 'answer_delta') setPending((p) => p ? { ...p, text: p.text + event.text } : p);
        if (event.type === 'progress') setPending((p) => p ? { ...p, summary: [...p.summary, event.text] } : p);
      });
      await accept(result);
    } catch (err) {
      const recovered = input ? await recoverChat(conversationId, input.requestId).catch(() => null) : null;
      if (recovered) {
        try { await accept(recovered); return; }
        catch { err = new Error('结果已保存，页面同步失败，请重试'); }
      }
      const message = chatErrorMessage(err);
      setError(message);
      setPending((p) => p ? { ...p, state: message.includes('已停止') ? 'stopped' : 'error' } : p);
      if (!input) setRestoreDraft({ text, key: Date.now() });
    } finally { controller.current = null; submitting.current = false; setStopping(false); if (acquired) end(); }
  };
  const renderSuggestions = (suggestions: ChatAttachment['suggestions'], scopeDayId: string | undefined, initial = false) => {
    const scopeDay = trip.days.find((d) => d.id === scopeDayId);
    const choices = suggestions.filter((suggestion) => initial || typeof suggestion !== 'string').slice(0, 3).map((suggestion) => typeof suggestion === 'string'
      ? { kind: suggestion, label: labels[suggestion], text: suggestionText(suggestion, scopeDay?.dayIndex) }
      : suggestion);
    if (!choices.length) return null;
    return <div className="chat-suggestions mt-4 flex flex-wrap gap-2" aria-label={initial ? '起始建议' : '后续建议'}>
      {choices.map(({ kind, label, text }) => <Button variant="plain" key={text} className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-solid border-white bg-[var(--color-editor-page-background-95)] px-2.5 py-2 text-left text-[16px] text-[var(--color-editor-page-color-96)] hover:bg-[var(--color-editor-page-background-97)] disabled:opacity-50" disabled={busy || readOnly || running || Boolean(scopeDayId && !scopeDay)} onClick={() => void send(text, kind, undefined, scopeDayId ?? null)}>
        <EditorIcon name={kind === 'food' || kind === 'more_food' ? 'food' : kind === 'pace' || kind === 'dinner' ? 'clock' : kind === 'follow_up' ? 'sparkle' : 'pin'} />{label}
      </Button>)}
    </div>;
  };

  return <div className="chat-panel flex min-h-0 flex-1 flex-col gap-4 p-5 text-[16px] leading-[1.6] max-sm:p-4">
    <div ref={scroll} className="chat-stream flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto py-2 [scrollbar-width:thin] [scrollbar-color:var(--color-editor-page-scrollbar-color-65)_transparent]" onScroll={() => {
      const node = scroll.current;
      const near = !node || node.scrollHeight - node.clientHeight - node.scrollTop < 70;
      following.current = near; setAtBottom(near);
    }}>
      {detail.isPending && <p>正在加载对话…</p>}
      {detail.isError && <p role="alert">对话加载失败 <Button variant="ghost" onClick={() => void detail.refetch()}>重试</Button></p>}
      {!detail.isPending && !detail.isError && <div className="chat-welcome pb-3 pt-5">
        <h2 className="m-0 flex items-start gap-3 text-[18px] font-semibold leading-[1.6]"><span className="mt-1 text-brand" aria-hidden="true"><EditorIcon name="sparkle" /></span>行程已生成，可以继续完善沿途安排。</h2>
        <p className="mb-0 mt-5 text-[16px] leading-[1.8] text-ink-muted">我为你整理了 {trip.days.length} 天的行程安排，已包含主要景点与交通安排，你可以根据需要进一步调整。</p>
        {messages.length === 0 && !pending && renderSuggestions(initialSuggestions, dayId, true)}</div>}
      {messages.map((message) => <div key={message.id} className="min-w-0">
        <MessageBubble message={message} />
        {message.attachment?.notice && <p className="mb-0 mt-3 rounded-2xl bg-[var(--color-editor-page-background-97)] px-4 py-3 text-[14px] text-ink-muted">{message.attachment.notice}</p>}
        {message.attachment?.candidates.map((candidate) => <FoodCard key={candidate.id} candidate={candidate} trip={trip} conversationId={conversationId} disabled={busy || readOnly} readOnly={readOnly} begin={begin} end={end} onTrip={onTrip} />)}
        {message.role === 'assistant' && message.attachment && (message.attachment.clarification ? <div className="chat-answer-options mt-4 flex flex-wrap gap-2" role="group" aria-label={message.attachment.clarification.question}>
          {message.attachment.clarification.options.map((option) => <Button key={option} variant="plain" className="min-h-11 rounded-full border border-solid border-white bg-[var(--color-editor-page-background-95)] px-4 py-2 text-left text-[16px] text-brand hover:bg-[var(--color-editor-page-background-97)]" disabled={busy || readOnly || running || message.id !== messages.at(-1)?.id} onClick={() => void send(option, undefined, undefined, message.attachment?.dayId ?? null)}>{option}</Button>)}
        </div> : message.id === latestMessage?.id && latestSuggestions.length > 0 ? <div><p className="mb-0 mt-4 text-[14px] text-ink-muted">你可能还想要：</p>{renderSuggestions(latestSuggestions, message.attachment.dayId)}</div> : null)}
      </div>)}
      {pending && <>
        <div className="chat-bubble self-end max-w-[88%] whitespace-pre-wrap break-words rounded-[18px] bg-[var(--color-editor-page-background-97)] px-4 py-3 text-[16px] text-[var(--color-editor-page-color-96)]">{pending.input.text}</div>
        <div className="min-w-0">
          <ChatProgress key={`${pending.input.requestId}:${pending.state}`} steps={pending.summary} state={pending.state} />
          <div className="chat-bubble whitespace-pre-wrap break-words rounded-[18px] bg-[var(--color-editor-page-background-95)] px-4 py-3 text-[16px] leading-[1.6] text-[var(--color-editor-page-color-96)]"><ChatText text={pending.text || (running ? '正在准备回答…' : '')} /></div>
          {!running && <div className="mt-2 flex flex-wrap items-center gap-2"><span className="text-ink-muted">{pending.state === 'stopped' ? '已停止' : '回答中断'}</span><Button variant="ghost" className="text-[16px]" disabled={busy || readOnly} onClick={() => void send(pending.input.text, pending.input.suggestion, pending.input)}>重试</Button><Button variant="ghost" className="text-[16px]" onClick={() => setRestoreDraft({ text: pending.input.text, key: Date.now() })}>恢复编辑</Button></div>}
        </div>
      </>}
    </div>
    {!atBottom && <Button variant="ghost" className="min-h-11 self-center rounded-full text-[16px] text-brand" onClick={() => { following.current = true; setAtBottom(true); scroll.current?.scrollTo({ top: scroll.current.scrollHeight }); }}>回到最新 ↓</Button>}
    {error && <p className="m-0 text-[16px] text-[var(--color-danger)]" role="alert">{error}</p>}
    {readOnly && <p className="m-0 text-[16px] text-ink-muted">返回最新版本或恢复此版本后继续对话</p>}
    <ChatInput disabled={readOnly || detail.isPending || detail.isError || (busy && !running)} sending={running} stopping={stopping} restoreDraft={restoreDraft} onSend={(text) => void send(text)} onStop={() => {
      if (!pending || stopping) return;
      setStopping(true);
      void stopChat(conversationId, pending.input.requestId).catch(() => { controller.current?.abort(); });
    }} />
  </div>;
}
