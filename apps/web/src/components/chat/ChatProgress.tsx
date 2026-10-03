import { useState } from 'react';
import { EditorIcon } from '../editor/EditorIcon';

interface Props {
  steps: string[];
  state?: 'running' | 'stopped' | 'error' | 'completed';
}

/** 过程来自服务端真实阶段事件；与正文分开，完成后仍可展开回看。 */
export function ChatProgress({ steps, state = 'completed' }: Props) {
  const running = state === 'running';
  const [expanded, setExpanded] = useState(running);
  if (!steps.length) return null;
  const status = running ? '处理中' : state === 'stopped' ? '已停止' : state === 'error' ? '已中断' : '已完成';
  return <details className="group chat-progress mb-2 w-full min-w-0 rounded-2xl border border-solid border-hairline-divider bg-white/40 px-3 text-[16px] text-ink-muted" open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand [&::-webkit-details-marker]:hidden">
      <span className={running ? 'text-brand motion-safe:animate-pulse' : 'text-brand'} aria-hidden="true"><EditorIcon name="sparkle" /></span>
      <span className="min-w-0 flex-1">思考过程 <span className="text-[14px]">· {status} · {steps.length} 步</span></span>
      <svg className="transition-transform group-open:rotate-180" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </summary>
    <ol className="mb-3 mt-1 list-none space-y-3 border-0 border-l border-solid border-hairline-divider pl-4">
      {steps.map((step, index) => <li key={index} className="relative break-words leading-relaxed">
        <span aria-hidden="true" className={`absolute -left-[21px] top-2.5 h-2 w-2 rounded-full ${running && index === steps.length - 1 ? 'bg-brand motion-safe:animate-pulse' : 'bg-ink-muted/40'}`} />
        {step}
      </li>)}
    </ol>
  </details>;
}
