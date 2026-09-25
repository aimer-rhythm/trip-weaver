// 公共 Agent 运行器：pi-agent-core Agent 装配 + 事件转发 + 轮次上限 + 外部取消
// 三个阶段 Agent（调研/编排/审校）共用；上下文互相隔离（每阶段全新 Agent，架构 §5）
import { Agent, type AgentTool, type StreamFn } from '@mariozechner/pi-agent-core';
import {
  createAssistantMessageEventStream,
  streamSimple,
  type Api,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
} from '@mariozechner/pi-ai';
import type { LlmRequestRecorder } from '../llmRequestLog';

export interface PhaseEventSink {
  onThought(text: string): void;
  onToolStart(toolCallId: string, tool: string, label: string, args: unknown): void;
  onToolEnd(toolCallId: string, tool: string, label: string, summary: string, isError: boolean): void;
  onUsage(tokensIn: number, tokensOut: number): void;
  /** LLM 请求上下文快照（09-20 调试视图）：每次 API 请求发出前推送完整上下文 */
  onLlmRequest?(info: { turn: number; model: string; systemPrompt: string; messages: unknown[]; tools: unknown[] }): void;
  /** 该 turn 响应结束（message_end）时回填结果 */
  onLlmResponse?(info: { turn: number; stopReason?: string; usage?: { input: number; output: number }; errorMessage?: string }): void;
}

export interface RunAgentOptions {
  model: Model<'openai-completions'>;
  apiKey: string;
  systemPrompt: string;
  tools: AgentTool[];
  userPrompt: string;
  signal: AbortSignal;
  sink: PhaseEventSink;
  maxTurns?: number;
  /** LLM 请求上下文快照（09-20）：传入后每次 API 请求落库，失败不影响生成 */
  recorder?: LlmRequestRecorder;
}

export interface RunAgentResult {
  tokensIn: number;
  tokensOut: number;
  aborted: boolean;
  turnLimitExceeded: boolean;
  errorMessage?: string;
}

const DEFAULT_MAX_TURNS = 24;

/** 提取工具结果首个文本块作为时间线摘要 */
function summarizeToolResult(result: unknown): string {
  const content = (result as { content?: { type?: string; text?: string }[] })?.content;
  const firstText = Array.isArray(content) ? content.find((c) => typeof c?.text === 'string')?.text : undefined;
  return (firstText ?? '').slice(0, 200);
}

// ---------- 上游瞬时故障重试（09-20） ----------
// 网关/上游抖动（模型短时不可用、限流、5xx、连接中断）只重试当前这一次请求：
// 已完成的工具调用不回滚，单次抖动不再把整次生成判死。请求本身不合法的 400（字段/角色错误）不重试。
// terminated（09-25）：undici 在响应体未读完就被上游关掉时抛的 TypeError，与 socket hang up 同类。
// 实测文案阶段一次长响应跑到 62s 后被切断，因不在白名单而硬失败（文案降级），已纳入。
const LLM_RETRY_DELAYS_MS = [1000, 3000] as const;

const RETRYABLE_UPSTREAM_ERROR =
  /model is unavailable|upstream request failed|rate ?limit|too many requests|overloaded|temporarily unavailable|try again|timed? ?out|fetch failed|socket hang up|terminated|ECONNRESET|ETIMEDOUT|EPIPE|bad gateway|service unavailable|gateway time-?out|internal server error|\b50[234]\b/i;

/** 只认「换一次请求就可能成功」的错误，其余照常判死，避免把真实配置错误拖成三次慢失败 */
export function isRetryableUpstreamError(message: string): boolean {
  return RETRYABLE_UPSTREAM_ERROR.test(message);
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/** 构造错误终态事件：用于 streamSimple 直接抛出（未走事件流）的场景 */
function llmErrorEvent(model: Model<Api>, message: string): AssistantMessageEvent {
  return {
    type: 'error',
    reason: 'error',
    error: {
      role: 'assistant',
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: 'error',
      errorMessage: message,
      timestamp: Date.now(),
    },
  };
}

type StreamCall = (model: Model<Api>, context: Context, options?: SimpleStreamOptions) => AssistantMessageEventStream;

/**
 * 包一层上游重试：整次尝试的事件先缓冲，成功（done）才下发 —— 重试不会把上一半消息塞进 agent 上下文。
 * 已产出工具调用增量（toolcall_*）的失败不重试——重放会重复执行有副作用的工具（search_pois 计费）。
 * 仅正文/思考增量的失败仍可重试（09-25）：实测长 reasoning 请求断流必带 thinking_delta，
 * 若按「任何非 start 事件」判死，这类上游抖动会永久判死整次生成（实测 research 阶段 87s 白等、候选 0）。
 */
export function streamWithRetry(
  call: StreamCall,
  model: Model<Api>,
  context: Context,
  options: SimpleStreamOptions | undefined,
  delays: readonly number[] = LLM_RETRY_DELAYS_MS,
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  void (async () => {
    for (let attempt = 1; ; attempt++) {
      const buffered: AssistantMessageEvent[] = [];
      let terminal: AssistantMessageEvent;
      try {
        let finished: AssistantMessageEvent | null = null;
        for await (const ev of call(model, context, options)) {
          if (ev.type === 'done' || ev.type === 'error') {
            finished = ev;
            break;
          }
          buffered.push(ev);
        }
        terminal = finished ?? llmErrorEvent(model, '上游响应意外中断');
      } catch (err) {
        terminal = llmErrorEvent(model, err instanceof Error ? err.message : String(err));
      }

      const failed = terminal.type === 'error' ? (terminal.error.errorMessage ?? '') : '';
      const hasToolCall = buffered.some((ev) => ev.type.startsWith('toolcall'));
      const canRetry =
        Boolean(failed) &&
        !hasToolCall &&
        attempt <= delays.length &&
        !options?.signal?.aborted &&
        isRetryableUpstreamError(failed);

      if (!canRetry) {
        for (const ev of buffered) stream.push(ev);
        if (terminal.type === 'error' && attempt > 1) {
          terminal.error.errorMessage = `${terminal.error.errorMessage ?? failed}（上游已重试 ${attempt - 1} 次）`;
        }
        stream.push(terminal);
        return;
      }

      const delayMs = delays[attempt - 1] ?? 0;
      console.warn(`[llm-retry] 第 ${attempt} 次请求失败，${delayMs}ms 后重试：${failed.slice(0, 200)}`);
      await abortableSleep(delayMs, options?.signal);
    }
  })();
  return stream;
}

export async function runPhaseAgent(opts: RunAgentOptions): Promise<RunAgentResult> {
  const labelByTool = new Map(opts.tools.map((t) => [t.name, t.label]));
  const result: RunAgentResult = { tokensIn: 0, tokensOut: 0, aborted: false, turnLimitExceeded: false };
  let turns = 0;

  // 请求上下文快照：recorder 落库 / onLlmRequest 实时推送，任一存在即包装默认 streamSimple；
  // requestSeq 为阶段内请求序号（从 1 递增），pendingRowId/pendingTurn 供 message_end 回写响应。
  let requestSeq = 0;
  let pendingRowId: string | null = null;
  let pendingTurn = 0;
  const streamFn: StreamFn = async (model, context, options) => {
    const turn = ++requestSeq;
    pendingTurn = turn;
    const systemPrompt = context.systemPrompt ?? '';
    const messages = (context.messages ?? []) as unknown[];
    const tools = (context.tools ?? []) as unknown[];
    opts.sink.onLlmRequest?.({ turn, model: model.id, systemPrompt, messages, tools });
    pendingRowId = opts.recorder
      ? await opts.recorder.recordRequest({ turn, model: model.id, systemPrompt, messages, tools })
      : null;
    return streamWithRetry(streamSimple, model, context, options);
  };

  const agent = new Agent({
    initialState: {
      systemPrompt: opts.systemPrompt,
      model: opts.model,
      // 实测回退（09-20）：reasoning_effort='medium' 会写进请求体，但 plan 第1轮输出 token 反而从
      // 47228 升到 51646，turn2 thinking 从 30105 升到 77576 字符——本网关基本吃掉该参数，无收益。
      // 保持 off；model.ts 的 reasoning 标志同步回退。
      thinkingLevel: 'off',
      tools: opts.tools,
    },
    getApiKey: () => opts.apiKey,
    streamFn,
  });

  const onAbort = () => agent.abort();
  opts.signal.addEventListener('abort', onAbort, { once: true });

  agent.subscribe((ev) => {
    switch (ev.type) {
      case 'turn_start':
        turns += 1;
        if (turns > (opts.maxTurns ?? DEFAULT_MAX_TURNS)) {
          result.turnLimitExceeded = true;
          result.errorMessage = `轮次超限（>${opts.maxTurns ?? DEFAULT_MAX_TURNS}），已中止`;
          agent.abort();
        }
        break;
      case 'message_end': {
        const msg = ev.message as { role?: string; usage?: { input: number; output: number }; content?: unknown; stopReason?: string; errorMessage?: string };
        if (msg.role !== 'assistant') break;
        result.tokensIn += msg.usage?.input ?? 0;
        result.tokensOut += msg.usage?.output ?? 0;
        opts.sink.onUsage(result.tokensIn, result.tokensOut);
        const texts = Array.isArray(msg.content)
          ? (msg.content as { type?: string; text?: string }[]).filter((c) => c.type === 'text' && c.text).map((c) => c.text!)
          : [];
        const thought = texts.join('\n').trim();
        if (thought) opts.sink.onThought(thought.slice(0, 1500));
        if (msg.stopReason === 'error' && msg.errorMessage) result.errorMessage = msg.errorMessage;
        if (pendingTurn) {
          opts.sink.onLlmResponse?.({ turn: pendingTurn, stopReason: msg.stopReason, usage: msg.usage, errorMessage: msg.errorMessage });
          pendingTurn = 0;
        }
        if (pendingRowId && opts.recorder) {
          const rowId = pendingRowId;
          pendingRowId = null;
          void opts.recorder.recordResponse(rowId, {
            stopReason: msg.stopReason,
            usage: msg.usage,
            errorMessage: msg.errorMessage,
            text: thought || undefined,
          });
        }
        break;
      }
      case 'tool_execution_start':
        opts.sink.onToolStart(ev.toolCallId, ev.toolName, labelByTool.get(ev.toolName) ?? ev.toolName, ev.args);
        break;
      case 'tool_execution_end':
        opts.sink.onToolEnd(ev.toolCallId, ev.toolName, labelByTool.get(ev.toolName) ?? ev.toolName, summarizeToolResult(ev.result), ev.isError);
        break;
    }
  });

  try {
    await agent.prompt(opts.userPrompt);
    await agent.waitForIdle();
  } finally {
    opts.signal.removeEventListener('abort', onAbort);
  }

  result.aborted = opts.signal.aborted;
  if (!result.errorMessage && agent.state.errorMessage && !result.aborted) {
    result.errorMessage = agent.state.errorMessage;
  }
  return result;
}
