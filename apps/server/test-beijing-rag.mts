// 北京 RAG 调研实测：直调 runGeneration，观察 search_verified_places 工具调用与候选质量
// 用 Neon 库（.env 已指向），非 eval 隔离库——纯观察不写评测快照
import 'dotenv/config';
import { runGeneration } from './src/generation/orchestrator';
import { createJob, subscribe } from './src/generation/jobManager';
import type { GenerateForm } from '@tripweaver/shared';

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

const toolCalls: { name: string; args: string }[] = [];
const candidates: string[] = [];
let llmReqs = 0;
let llmResps = 0;

const job = createJob('rag-test-user');
subscribe(job, 0, ({ event }) => {
  if (event.type === 'tool_start') {
    const e = event as { tool?: string; args?: unknown };
    toolCalls.push({ name: e.tool ?? '?', args: JSON.stringify(e.args ?? {}).slice(0, 120) });
    console.log(`  [tool] ${e.tool} ${JSON.stringify(e.args ?? {}).slice(0, 100)}`);
  }
  if (event.type === 'candidate') {
    const e = event as { poi?: { name: string } };
    if (e.poi?.name) { candidates.push(e.poi.name); console.log(`  [candidate] ${e.poi.name}`); }
  }
  if (event.type === 'llm_request') llmReqs++;
  if (event.type === 'llm_response') llmResps++;
  if (event.type === 'thought') {
    const e = event as { phase?: string; text: string };
    console.log(`  [thought/${e.phase}] ${e.text.slice(0, 300)}`);
  }
  if (event.type === 'phase_start') {
    const e = event as { phase: string; round?: number };
    console.log(`\n=== 阶段 ${e.phase} 第${e.round ?? 1}轮 ===`);
  }
  if (event.type === 'job_error') console.error('生成失败:', (event as { message: string }).message);
});

const cfg = {
  baseUrl: process.env.SITE_LLM_BASE_URL!,
  apiKey: process.env.SITE_LLM_API_KEY!,
  model: process.env.SITE_LLM_MODEL!,
  byok: false,
};
console.log('开始北京 3 天生成（观察调研阶段工具调用）...\n');
await runGeneration(job, form, cfg);

console.log('\n========== 调研阶段复盘 ==========');
const verifiedCalls = toolCalls.filter(t => t.name === 'search_verified_places');
console.log(`search_verified_places 调用 ${verifiedCalls.length} 次:`);
verifiedCalls.forEach(c => console.log(`  - ${c.args}`));
console.log(`search_pois 调用 ${toolCalls.filter(t => t.name === 'search_pois').length} 次`);
console.log(`search_web 调用 ${toolCalls.filter(t => t.name === 'search_web').length} 次`);
console.log(`候选池 ${candidates.length} 个: ${candidates.slice(0, 15).join('、')}${candidates.length > 15 ? '…' : ''}`);
console.log(`llm_request 事件 ${llmReqs} 个，llm_response 事件 ${llmResps} 个`);
console.log(`最终状态: ${job.status}, tripId=${job.tripId ?? '无'}`);
process.exit(job.status === 'done' ? 0 : 1);
