import type { DataSourceKind, GenerationEvent, GenerationPhase, ResearchPoi } from '@tripweaver/shared';

export interface ToolItem {
  kind: 'tool';
  key: string;
  label: string;
  summary: string;
  isError: boolean;
  running: boolean;
  startedAt?: number;
  durationMs?: number;
}

export interface ThoughtItem {
  kind: 'thought';
  key: string;
  text: string;
}

/** LLM 请求上下文节点（09-20 调试视图）：llm_request 到达即长出，llm_response 回填结果 */
export interface LlmRequestItem {
  kind: 'llm';
  key: string;
  turn: number;
  model: string;
  systemPrompt: string;
  messages: unknown[];
  tools: unknown[];
  running: boolean;
  stopReason?: string;
  tokensIn?: number;
  tokensOut?: number;
  errorMessage?: string;
  startedAt?: number;
  durationMs?: number;
}

export type TimelineItem = ToolItem | ThoughtItem | LlmRequestItem;

export interface PhaseBlock {
  key: string;
  phase: GenerationPhase;
  round: number;
  note?: string;
  done: boolean;
  items: TimelineItem[];
  startedAt?: number;
  durationMs?: number;
}

export interface TimelineModel {
  dataSources: DataSourceKind[] | null;
  candidates: ResearchPoi[];
  phases: PhaseBlock[];
  usage: { tokensIn: number; tokensOut: number; amapCalls: number; searchCalls: number } | null;
  terminal: Extract<GenerationEvent, { type: 'job_done' | 'job_error' | 'job_cancelled' }> | null;
  startedAt?: number;
  durationMs?: number;
}

function eventDuration(explicit: number | undefined, startedAt: number | undefined, endedAt: number | undefined): number | undefined {
  if (explicit !== undefined) return Math.max(0, explicit);
  if (startedAt === undefined || endedAt === undefined) return undefined;
  return Math.max(0, endedAt - startedAt);
}

/** 从事件流重建时间线；只依赖服务端事件，刷新重放可得到相同的已完成耗时。 */
export function buildTimeline(events: GenerationEvent[]): TimelineModel {
  const model: TimelineModel = { dataSources: null, candidates: [], phases: [], usage: null, terminal: null };
  let seq = 0;
  for (const ev of events) {
    seq += 1;
    switch (ev.type) {
      case 'job_start':
        model.dataSources = ev.dataSources;
        model.startedAt = ev.at;
        break;
      case 'phase_start':
        model.phases.push({
          key: `${ev.phase}-${ev.round}`,
          phase: ev.phase,
          round: ev.round,
          note: ev.note,
          done: false,
          items: [],
          startedAt: ev.at,
        });
        break;
      case 'phase_end': {
        const block = model.phases.find((phase) => phase.phase === ev.phase && phase.round === ev.round);
        if (block) {
          block.done = true;
          block.durationMs = eventDuration(ev.durationMs, block.startedAt, ev.at);
        }
        break;
      }
      case 'thought': {
        const block = model.phases.at(-1);
        block?.items.push({ kind: 'thought', key: `t${seq}`, text: ev.text });
        break;
      }
      case 'tool_start': {
        const block = model.phases.find((phase) => phase.phase === ev.phase && !phase.done) ?? model.phases.at(-1);
        block?.items.push({
          kind: 'tool',
          key: ev.toolCallId,
          label: ev.label,
          summary: '',
          isError: false,
          running: true,
          startedAt: ev.at,
        });
        break;
      }
      case 'tool_end': {
        for (const phase of model.phases) {
          const item = phase.items.find((candidate): candidate is ToolItem => candidate.kind === 'tool' && candidate.key === ev.toolCallId);
          if (item) {
            item.summary = ev.summary;
            item.isError = ev.isError;
            item.running = false;
            item.durationMs = eventDuration(ev.durationMs, item.startedAt, ev.at);
            break;
          }
        }
        break;
      }
      case 'candidate':
        model.candidates.push(ev.poi);
        break;
      case 'llm_request': {
        const block = model.phases.at(-1);
        block?.items.push({
          kind: 'llm',
          key: `llm-${block.key}-${ev.turn}`,
          turn: ev.turn,
          model: ev.model,
          systemPrompt: ev.systemPrompt,
          messages: ev.messages,
          tools: ev.tools,
          running: true,
          startedAt: ev.at,
        });
        break;
      }
      case 'llm_response': {
        // 同阶段块内按 turn 配对（倒序取最近的该阶段块）；找不到时忽略（防御旧事件重放）
        let item: LlmRequestItem | undefined;
        for (let i = model.phases.length - 1; i >= 0 && !item; i--) {
          const block: PhaseBlock = model.phases[i]!;
          if (block.phase !== ev.phase) continue;
          item = block.items.find(
            (candidate): candidate is LlmRequestItem => candidate.kind === 'llm' && candidate.turn === ev.turn,
          );
        }
        if (item) {
          item.running = false;
          item.stopReason = ev.stopReason;
          item.tokensIn = ev.tokensIn;
          item.tokensOut = ev.tokensOut;
          item.errorMessage = ev.errorMessage;
          item.durationMs = eventDuration(undefined, item.startedAt, ev.at);
        }
        break;
      }
      case 'usage':
        model.usage = { tokensIn: ev.tokensIn, tokensOut: ev.tokensOut, amapCalls: ev.amapCalls, searchCalls: ev.searchCalls };
        break;
      case 'job_done':
      case 'job_error':
      case 'job_cancelled':
        model.terminal = ev;
        model.durationMs = eventDuration(ev.durationMs, model.startedAt, ev.at);
        break;
    }
  }
  return model;
}

export function formatDuration(durationMs: number): string {
  const safeMs = Math.max(0, durationMs);
  if (safeMs === 0) return '0 秒';
  if (safeMs < 60_000) {
    const seconds = Math.round(safeMs / 100) / 10;
    return `${seconds.toFixed(seconds < 10 ? 1 : 0)} 秒`;
  }
  const totalSeconds = Math.round(safeMs / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分`;
}
