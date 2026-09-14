// 单测：规划 prompt 的长途点情报注入（远郊编排层2 预防，node:test 经 tsx 运行）
// 无长途点时不额外注入长途规则；P0 地点引用在候选索引中显式携带 poiId。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GenerateForm, ResearchPoi } from '@tripweaver/shared';
import type { LongHaulPoi } from '../generation/longHaul';
import { PLANNER_SYSTEM_PROMPT, PLANNER_REVISION_SYSTEM_PROMPT, RESEARCH_SYSTEM_PROMPT, REVIEWER_SYSTEM_PROMPT, formBrief, plannerUserPrompt, renderLongHaulIntel } from '../generation/prompts';

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

test('plannerUserPrompt 候选引用明确，缺省长途情报与显式空数组同义', () => {
  const expected = [
    `用户需求：\n${formBrief(form)}`,
    `候选池（优先从中选点，名称保持一致）：\n- 甲景区｜poiId=p1｜景点【预约情况未知】｜简介`,
    `调研摘要：\n摘要正文`,
  ].join('\n\n');
  assert.equal(plannerUserPrompt(form, { summary: '摘要正文', pool }), expected);
  assert.equal(plannerUserPrompt(form, { summary: '摘要正文', pool }, [], []), expected);
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

test('餐饮编排要求每天午晚餐，并把实时门店决策交给外部平台', () => {
  for (const prompt of [PLANNER_SYSTEM_PROMPT, PLANNER_REVISION_SYSTEM_PROMPT]) {
    assert.ok(prompt.includes('必须同时包含午餐与晚餐'));
    assert.ok(prompt.includes('片区 · 菜系或代表菜'));
    assert.ok(prompt.includes('大众点评或美团确认'));
    assert.ok(prompt.includes('placeName="春熙路"'));
    assert.ok(prompt.includes('长途点纪律'));
  }
  assert.ok(RESEARCH_SYSTEM_PROMPT.includes('评分、人均、营业与排队均是动态信息'));
  assert.ok(REVIEWER_SYSTEM_PROMPT.includes('每天是否同时有午餐和晚餐'));
});

test('修订输入提供实际草稿与问题，指令要求保留已有活动 ID', () => {
  const snapshot = '第 1 天：原主题\n  1. 原活动｜id=activity-original｜09:00-11:00';
  const text = plannerUserPrompt(form, { summary: '摘要', pool }, ['将晚餐后移'], intel, snapshot);
  assert.ok(text.includes(snapshot));
  assert.ok(text.includes('将晚餐后移'));
  assert.ok(text.includes('长途点情报'));
  assert.ok(PLANNER_REVISION_SYSTEM_PROMPT.includes('move_activity'));
  assert.ok(PLANNER_REVISION_SYSTEM_PROMPT.includes('禁止清空草稿'));
  assert.equal(PLANNER_REVISION_SYSTEM_PROMPT.includes('调用 set_trip_skeleton'), false);
});

test('生成提示不再包含用户预算决策或费用估算工具', () => {
  const brief = formBrief({ ...form, budgetLevel: '豪华', totalBudget: 99999 });
  assert.equal(brief.includes('预算'), false);
  assert.equal(PLANNER_SYSTEM_PROMPT.includes('cost 为'), false);
  assert.equal(REVIEWER_SYSTEM_PROMPT.includes('get_budget_status'), false);
});
