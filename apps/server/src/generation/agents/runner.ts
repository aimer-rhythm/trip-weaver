// 公共 Agent 运行器：pi-agent-core Agent 装配 + 事件转发 + 轮次上限 + 外部取消
// 三个阶段 Agent（调研/编排/审校）共用；上下文互相隔离（每阶段全新 Agent，架构 §5）
import { Agent, type AgentTool } from '@mariozechner/pi-agent-core';
import type { Model } from '@mariozechner/pi-ai';

export interface PhaseEventSink {
  onThought(text: string): void;
  onToolStart(toolCallId: string, tool: string, label: string, args: unknown): void;
  onToolEnd(toolCallId: string, tool: string, label: string, summary: string, isError: boolean): void;
  onUsage(tokensIn: number, tokensOut: number): void;
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

export async function runPhaseAgent(opts: RunAgentOptions): Promise<RunAgentResult> {
  const labelByTool = new Map(opts.tools.map((t) => [t.name, t.label]));
  const result: RunAgentResult = { tokensIn: 0, tokensOut: 0, aborted: false, turnLimitExceeded: false };
  let turns = 0;

  const agent = new Agent({
    initialState: {
      systemPrompt: opts.systemPrompt,
      model: opts.model,
      thinkingLevel: 'off',
      tools: opts.tools,
    },
    getApiKey: () => opts.apiKey,
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
