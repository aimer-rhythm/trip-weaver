// 合成事件验证 generationTimeline 的 LLM 请求节点重建（不配库不起服务）
import { buildTimeline } from './src/lib/generationTimeline';
import type { GenerationEvent } from '@tripweaver/shared';

const events: GenerationEvent[] = [
  { type: 'job_start', destination: '北京', xhsEnabled: true, dataSources: ['amap', 'websearch'], at: 1000 },
  { type: 'phase_start', phase: 'research', round: 1, at: 1100 },
  {
    type: 'llm_request', phase: 'research', turn: 1, model: 'test-model',
    systemPrompt: '你是旅行调研员……', messages: [{ role: 'user', content: '开始' }], tools: [{ name: 'search_pois' }],
    at: 1200,
  },
  { type: 'llm_response', phase: 'research', turn: 1, stopReason: 'toolUse', tokensIn: 283, tokensOut: 867, at: 6200 },
  {
    type: 'llm_request', phase: 'research', turn: 2, model: 'test-model',
    systemPrompt: '你是旅行调研员……', messages: [{ role: 'user' }, { role: 'assistant' }, { role: 'tool' }], tools: [],
    at: 6300,
  },
  { type: 'llm_response', phase: 'research', turn: 2, stopReason: 'error', errorMessage: 'empty response content', at: 7000 },
  { type: 'phase_end', phase: 'research', round: 1, at: 7100 },
];

const model = buildTimeline(events);
const block = model.phases[0]!;
const llmItems = block.items.filter((i) => i.kind === 'llm');

const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error('FAIL:', msg); process.exit(1); }
  console.log('ok:', msg);
};

assert(llmItems.length === 2, '两个 llm 节点');
const [first, second] = llmItems as Extract<(typeof llmItems)[number], { kind: 'llm' }>[];
assert(first.running === false && first.stopReason === 'toolUse', 'turn1 响应已回填');
assert(first.tokensIn === 283 && first.tokensOut === 867, 'turn1 token 正确');
assert(first.durationMs === 5000, `turn1 耗时 5000ms（实际 ${first.durationMs}）`);
assert(second.errorMessage === 'empty response content', 'turn2 错误信息回填');
assert(second.messages.length === 3, 'turn2 消息数 3');
console.log('\n全部通过');
