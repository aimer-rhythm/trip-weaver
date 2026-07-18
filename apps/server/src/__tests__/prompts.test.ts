// 单测：规划 prompt 的长途点情报注入（远郊编排层2 预防，node:test 经 tsx 运行）
// 关键回归约束：无长途点时 plannerUserPrompt 必须与旧版逐字一致——金集 walk/drive 短途类 case
// （guangzhou/hangzhou/suzhou）无长途点，prompt 面零变化是其回归风险的直接闸门；其余 case
// live 重生成时会携带情报段落（属预期行为变化），有长途点路径由下方注入测试锁定。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GenerateForm, ResearchPoi } from '@tripweaver/shared';
import type { LongHaulPoi } from '../generation/longHaul';
import { PLANNER_SYSTEM_PROMPT, formBrief, plannerUserPrompt, renderLongHaulIntel } from '../generation/prompts';

const form: GenerateForm = {
  destination: '测试市',
  days: 2,
  startDate: '',
  budgetLevel: '舒适',
  totalBudget: 0,
  preferences: [],
  partySize: 2,
  extraNotes: '',
  transportMode: 'transit',
};

const pool: ResearchPoi[] = [
  { id: 'p1', name: '甲景区', category: 'attraction', intro: '简介', reservation: 'unknown', sourceLinks: [] },
];

const intel: LongHaulPoi[] = [
  { name: '远郊大景区', durationMin: 151, tier: 'exclusive' },
  { name: '西北名园', durationMin: 65, tier: 'longHaul' },
];

// ---------- 无长途点：prompt 面零变化 ----------

test('renderLongHaulIntel 空情报返回空串', () => {
  assert.equal(renderLongHaulIntel([], 'transit'), '');
});

test('plannerUserPrompt 无长途点时与旧版逐字一致（缺省参数与显式空数组同义）', () => {
  const legacy = [
    `用户需求：\n${formBrief(form)}`,
    `候选池（优先从中选点，名称保持一致）：\n- 甲景区｜景点【预约情况未知】｜简介`,
    `调研摘要：\n摘要正文`,
  ].join('\n\n');
  assert.equal(plannerUserPrompt(form, { summary: '摘要正文', pool }), legacy);
  assert.equal(plannerUserPrompt(form, { summary: '摘要正文', pool }, [], []), legacy);
});

// ---------- 有长途点：情报段落 + 硬规则 ----------

test('长途点情报按出行方式渲染标级行与规则（transit → 公交）', () => {
  const text = renderLongHaulIntel(intel, 'transit');
  assert.ok(text.startsWith('长途点情报（系统按坐标确定性计算，务必遵守）：'));
  assert.ok(text.includes('- 远郊大景区：距市区 POI 主体估算公交单程约 151 分钟【强独占级】'));
  assert.ok(text.includes('- 西北名园：距市区 POI 主体估算公交单程约 65 分钟【长途级】'));
  assert.ok(text.includes('必须为其独占'), '须含独占日硬规则');
  assert.ok(text.includes('同方向顺路'), '长途级须含同方向顺路规则');
});

test('drive 模式情报行渲染为驾车口径', () => {
  const text = renderLongHaulIntel([{ name: '远郊大景区', durationMin: 95, tier: 'exclusive' }], 'drive');
  assert.ok(text.includes('估算驾车单程约 95 分钟'));
});

test('plannerUserPrompt 注入情报段落：位于候选池之后、调研摘要之前', () => {
  const text = plannerUserPrompt(form, { summary: '摘要正文', pool }, [], intel);
  const iPool = text.indexOf('候选池（优先从中选点');
  const iIntel = text.indexOf('长途点情报（系统按坐标确定性计算');
  const iSummary = text.indexOf('调研摘要：');
  assert.ok(iPool >= 0 && iIntel > iPool && iSummary > iIntel);
});

test('修订轮（revisionRequests 非空）同样携带长途点情报', () => {
  const text = plannerUserPrompt(form, { summary: '摘要正文', pool }, ['把远郊日拆开重排'], intel);
  assert.ok(text.includes('长途点情报（系统按坐标确定性计算'));
  assert.ok(text.includes('审校员的修订要求'));
  assert.ok(text.includes('1. 把远郊日拆开重排'));
});

// ---------- system prompt：通用长途点纪律 ----------

test('PLANNER_SYSTEM_PROMPT 含长途点纪律（独占日约束 + 通勤时间预算意识）', () => {
  assert.ok(PLANNER_SYSTEM_PROMPT.includes('长途点纪律'));
  assert.ok(PLANNER_SYSTEM_PROMPT.includes('【强独占级】地点独占一天'));
  assert.ok(PLANNER_SYSTEM_PROMPT.includes('往返通勤计入当天时间预算'));
});
