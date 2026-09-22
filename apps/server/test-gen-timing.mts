// 生成管线分阶段耗时实测：用真实 LLM 跑一次生成，把墙钟时间拆成
// 「阶段 → 工具占用 / LLM 等待」三层，定位编排阶段为什么慢。
// 纯观察脚本：只读事件流，不改产线代码，不写评测快照。
// 用法（必须在 apps/server 目录下跑，dotenv 才读得到 .env）：
//   npx tsx test-gen-timing.mts
import 'dotenv/config';
import { runGeneration } from './src/generation/orchestrator';
import { createJob, subscribe } from './src/generation/jobManager';
import type { GenerateForm } from '@tripweaver/shared';

interface PhaseSpan {
  phase: string;
  round: number;
  start: number;
  end?: number;
}

interface ToolSpan {
  id: string;
  tool: string;
  phase: string;
  start: number;
  end?: number;
  durationMs?: number;
  isError?: boolean;
}

interface TurnSpan {
  phase: string;
  round: number;
  turn: number;
  start: number;
  tokensIn?: number;
  tokensOut?: number;
  stopReason?: string;
  errorMessage?: string;
}

const phases: PhaseSpan[] = [];
const tools = new Map<string, ToolSpan>();
const turns: TurnSpan[] = [];
let candidates = 0;
let dataSources = '';
let usageLine = '';
const wallStart0 = Date.now();

const fmt = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`);

const job = createJob('rag-test-user');
subscribe(job, 0, ({ event }) => {
  const at = (event as { at?: number }).at ?? Date.now();
  switch (event.type) {
    case 'job_start':
      dataSources = (event as { dataSources?: string[] }).dataSources?.join('+') || '（无外部源）';
      break;
    case 'phase_start': {
      const e = event as unknown as { phase: string; round: number; note?: string };
      phases.push({ phase: e.phase, round: e.round, start: at });
      console.log(`\n=== 阶段 ${e.phase} 第${e.round}轮 ${e.note ? `｜${e.note}` : ''} ===`);
      break;
    }
    case 'phase_end': {
      const e = event as unknown as { phase: string; round: number; durationMs?: number; summary?: string };
      const span = phases.find((p) => p.phase === e.phase && p.round === e.round && p.end === undefined);
      if (span) span.end = at;
      console.log(`=== 阶段 ${e.phase} 第${e.round}轮结束：${fmt(e.durationMs ?? 0)}｜${e.summary ?? ''}`);
      break;
    }
    case 'tool_start': {
      const e = event as unknown as { phase: string; toolCallId: string; tool: string; args: string };
      tools.set(e.toolCallId, { id: e.toolCallId, tool: e.tool, phase: e.phase, start: at });
      break;
    }
    case 'tool_end': {
      const e = event as unknown as {
        toolCallId: string; phase: string; tool: string; durationMs?: number; isError?: boolean; summary?: string;
      };
      const span = tools.get(e.toolCallId) ?? { id: e.toolCallId, tool: e.tool, phase: e.phase, start: at };
      span.end = at;
      span.durationMs = e.durationMs ?? at - span.start;
      span.isError = e.isError;
      tools.set(e.toolCallId, span);
      if (span.durationMs >= 3000) {
        console.log(`  ⏱ ${e.tool} ${fmt(span.durationMs)}${e.isError ? ' (失败/降级)' : ''}`);
      }
      break;
    }
    case 'candidate':
      candidates += 1;
      break;
    case 'thought': {
      const e = event as unknown as { phase: string; text: string };
      // 只打进度类与阶段提示，避免刷屏；带相对启动时间，用于看地理阶段的节奏
      console.log(`  [t+${fmt(at - wallStart0)}][${e.phase}] ${e.text.slice(0, 120)}`);
      break;
    }
    case 'usage': {
      const e = event as unknown as { amapCalls?: number; searchCalls?: number };
      usageLine = `amap=${e.amapCalls ?? 0} search=${e.searchCalls ?? 0}`;
      break;
    }
    case 'llm_request': {
      const e = event as unknown as { phase: string; turn: number; model: string };
      const open = phases.find((p) => p.phase === e.phase && p.end === undefined);
      turns.push({ phase: e.phase, round: open?.round ?? 1, turn: e.turn, start: at });
      break;
    }
    case 'llm_response': {
      const e = event as unknown as {
        phase: string; turn: number; tokensIn?: number; tokensOut?: number; stopReason?: string; errorMessage?: string;
      };
      const span = turns.find((t) => t.phase === e.phase && t.turn === e.turn && t.tokensIn === undefined);
      if (span) {
        span.tokensIn = e.tokensIn;
        span.tokensOut = e.tokensOut;
        span.stopReason = e.stopReason;
        span.errorMessage = e.errorMessage;
      }
      break;
    }
    default:
      break;
  }
});

const cfg = {
  baseUrl: process.env.SITE_LLM_BASE_URL!,
  apiKey: process.env.SITE_LLM_API_KEY!,
  model: process.env.SITE_LLM_MODEL!,
  byok: false,
};

console.log(`模型 ${cfg.model}｜开始生成（北京 3 天）…`);
const form: GenerateForm = {
  destination: '北京',
  days: 3,
  startDate: '',
  budgetLevel: 'medium',
  totalBudget: 0,
  preferences: ['历史文化'],
  partySize: 2,
  extraNotes: '',
  transportMode: 'transit',
};

const wallStart = Date.now();
await runGeneration(job, form, cfg);
const wallTotal = Date.now() - wallStart;

/** 区间并集：多个工具调用并行时不能把耗时重复累加 */
function unionMs(spans: { start: number; end: number }[]): number {
  if (!spans.length) return 0;
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  let total = 0;
  let curStart = sorted[0].start;
  let curEnd = sorted[0].end;
  for (const s of sorted.slice(1)) {
    if (s.start <= curEnd) curEnd = Math.max(curEnd, s.end);
    else {
      total += curEnd - curStart;
      curStart = s.start;
      curEnd = s.end;
    }
  }
  return total + (curEnd - curStart);
}

// ---------- 报告 ----------
console.log(`\n\n========== 阶段耗时报告 ==========`);
console.log(`最终状态 ${job.status}｜总墙钟 ${fmt(wallTotal)}｜数据源 ${dataSources}｜候选 ${candidates} 个｜外部调用 ${usageLine || '（无 usage 事件）'}\n`);

const closed = phases.filter((p) => p.end !== undefined) as (PhaseSpan & { end: number })[];
let sumPhase = 0;
console.log('阶段'.padEnd(12) + '轮次  耗时      占比    工具占用  LLM等待   LLM轮次 输出token');
for (const p of closed) {
  const wall = p.end - p.start;
  sumPhase += wall;
  const inPhase = [...tools.values()].filter(
    (t) => t.phase === p.phase && t.end !== undefined && t.start >= p.start && t.end <= p.end,
  ) as (ToolSpan & { end: number })[];
  const toolMs = unionMs(inPhase);
  const llmMs = Math.max(0, wall - toolMs);
  const phaseTurns = turns.filter((t) => t.phase === p.phase && t.round === p.round);
  const outTokens = phaseTurns.reduce((sum, t) => sum + (t.tokensOut ?? 0), 0);
  console.log(
    `${p.phase.padEnd(12)}${String(p.round).padEnd(4)}` +
      `${fmt(wall).padEnd(9)}${`${((wall / wallTotal) * 100).toFixed(0)}%`.padEnd(8)}` +
      `${fmt(toolMs).padEnd(9)}${fmt(llmMs).padEnd(9)}${String(phaseTurns.length).padEnd(9)}${outTokens}`,
  );
}
const unaccounted = wallTotal - sumPhase;
console.log(`\n阶段合计 ${fmt(sumPhase)}（${((sumPhase / wallTotal) * 100).toFixed(0)}%）；阶段外开销 ${fmt(unaccounted)}`);

console.log(`\n---------- 工具耗时 Top（单个调用） ----------`);
const done = [...tools.values()].filter((t) => t.durationMs !== undefined) as (ToolSpan & { durationMs: number })[];
for (const t of [...done].sort((a, b) => b.durationMs - a.durationMs).slice(0, 10)) {
  console.log(`  ${fmtMs(t.durationMs).padEnd(8)} ${t.phase.padEnd(9)} ${t.tool}`);
}
const byTool = new Map<string, { count: number; totalMs: number; maxMs: number }>();
for (const t of done) {
  const agg = byTool.get(t.tool) ?? { count: 0, totalMs: 0, maxMs: 0 };
  agg.count += 1;
  agg.totalMs += t.durationMs;
  agg.maxMs = Math.max(agg.maxMs, t.durationMs);
  byTool.set(t.tool, agg);
}
console.log(`\n---------- 按工具汇总 ----------`);
for (const [name, agg] of [...byTool].sort((a, b) => b[1].totalMs - a[1].totalMs)) {
  console.log(`  ${name.padEnd(22)} ${String(agg.count).padStart(3)} 次  合计 ${fmt(agg.totalMs).padEnd(8)} 最慢 ${fmt(agg.maxMs)}`);
}

console.log(`\n---------- LLM 单轮耗时（相邻请求起点差） ----------`);
const ordered = [...turns].sort((a, b) => a.start - b.start);
for (let i = 0; i < ordered.length; i++) {
  const t = ordered[i];
  const next = ordered[i + 1];
  const span = next ? next.start - t.start : undefined;
  console.log(
    `  ${t.phase.padEnd(9)} 第${t.round}轮 turn${String(t.turn).padStart(2)}  ` +
      `${(span !== undefined ? fmt(span) : '  --  ').padEnd(8)}` +
      `in=${String(t.tokensIn ?? '?').padStart(6)} out=${String(t.tokensOut ?? '?').padStart(6)} ` +
      `${t.stopReason ?? ''}${t.errorMessage ? ` ⚠ ${t.errorMessage.slice(0, 60)}` : ''}`,
  );
}

process.exit(job.status === 'done' ? 0 : 1);
