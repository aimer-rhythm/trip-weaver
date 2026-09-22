// 单测：规划 prompt 的长途点情报注入（远郊编排层2 预防，node:test 经 tsx 运行）
// 无长途点时不额外注入长途规则；P0 地点引用在候选索引中显式携带 poiId。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GenerateForm, ResearchPoi } from '@tripweaver/shared';
import type { LongHaulPoi } from '../generation/longHaul';
import { plannerSystemPrompt, plannerRevisionSystemPrompt, RESEARCH_SYSTEM_PROMPT, reviewerSystemPrompt, formBrief, plannerUserPrompt, renderLongHaulIntel, renderRagContext } from '../generation/prompts';
import type { RetrievedPlace } from '../generation/retrieveContext';

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

// 餐宿要求改为偏好驱动（09-21 D3/D6）：两个变体都要覆盖
const FOOD_PLANNER = plannerSystemPrompt(true);
const FREE_PLANNER = plannerSystemPrompt(false);
const FOOD_REVISION = plannerRevisionSystemPrompt(true);
const FREE_REVISION = plannerRevisionSystemPrompt(false);
const REVIEWER_COPY_PROMPT_FOCUSED = reviewerSystemPrompt(true);
const REVIEWER_COPY_PROMPT_FREE = reviewerSystemPrompt(false);

test('PLANNER_SYSTEM_PROMPT 含长途点纪律（独占日约束 + 通勤时间预算意识）', () => {
  for (const prompt of [FOOD_PLANNER, FREE_PLANNER]) {
    assert.ok(prompt.includes('长途点纪律'));
    assert.ok(prompt.includes('【强独占级】地点独占一天'));
    assert.ok(prompt.includes('往返通勤计入当天时间预算'));
  }
});

test('美食偏好的行程强制每天午晚餐，并把实时门店决策交给外部平台', () => {
  for (const prompt of [FOOD_PLANNER, FOOD_REVISION]) {
    assert.ok(prompt.includes('必须同时包含午餐与晚餐'));
    assert.ok(prompt.includes('片区 · 菜系或代表菜'));
    assert.ok(prompt.includes('大众点评或美团确认'));
    assert.ok(prompt.includes('placeName="春熙路"'));
    assert.ok(prompt.includes('长途点纪律'));
  }
  assert.ok(REVIEWER_COPY_PROMPT_FOCUSED.includes('每天是否同时有午餐和晚餐'));
  assert.ok(RESEARCH_SYSTEM_PROMPT.includes('评分、人均、营业与排队均是动态信息'));
});

test('非美食偏好的行程不再强制午晚餐，但仍禁止编造实时餐饮信息', () => {
  for (const prompt of [FREE_PLANNER, FREE_REVISION]) {
    assert.equal(prompt.includes('必须同时包含午餐与晚餐'), false);
    assert.equal(prompt.includes('每天必须同时包含'), false);
    assert.ok(prompt.includes('非美食导向'));
    assert.ok(prompt.includes('大众点评或美团确认'));
  }
  assert.equal(REVIEWER_COPY_PROMPT_FREE.includes('每天是否同时有午餐和晚餐'), false);
  assert.equal(REVIEWER_COPY_PROMPT_FREE.includes('不得删除某天仅有的午餐或晚餐'), false);
});

test('住宿建议不再是与餐次同级的强制步骤，但保留区域级别与禁推门店纪律', () => {
  for (const prompt of [FOOD_PLANNER, FREE_PLANNER]) {
    assert.ok(prompt.includes('住宿（可选）'));
    assert.ok(prompt.includes('不是必须完成的步骤'));
    assert.ok(prompt.includes('严禁推荐具体酒店、民宿或任何价格'));
  }
});

test('修订输入提供实际草稿与问题，指令要求保留已有活动 ID', () => {
  const snapshot = '第 1 天：原主题\n  1. 原活动｜id=activity-original｜09:00-11:00';
  const text = plannerUserPrompt(form, { summary: '摘要', pool }, ['将晚餐后移'], intel, snapshot);
  assert.ok(text.includes(snapshot));
  assert.ok(text.includes('将晚餐后移'));
  assert.ok(text.includes('长途点情报'));
  assert.ok(FOOD_REVISION.includes('move_activity'));
  assert.ok(FOOD_REVISION.includes('禁止清空草稿'));
  assert.equal(FOOD_REVISION.includes('调用 set_trip_skeleton'), false);
});

test('生成提示不再包含用户预算决策或费用估算工具', () => {
  const brief = formBrief({ ...form, budgetLevel: '豪华', totalBudget: 99999 });
  assert.equal(brief.includes('预算'), false);
  assert.equal(FOOD_PLANNER.includes('cost 为'), false);
  assert.equal(REVIEWER_COPY_PROMPT_FOCUSED.includes('get_budget_status'), false);
});

// ---------- RAG 情报：证据强度分级（09-21） ----------

const ragPlaces: RetrievedPlace[] = [
  {
    name: '乙古镇',
    category: '景点',
    verified: true,
    evidence: [
      { kind: 'xhs_reservation', content: '官方小程序提前 3 天放票', strength: 'direct' },
      { kind: 'xhs_reason', content: '傍晚人少出片', strength: 'weak' },
      { kind: 'xhs_warning', content: '节假日停车极难', strength: 'risk_only' },
    ],
  },
];

test('renderRagContext 空情报返回空串（金集逐字保护）', () => {
  assert.equal(renderRagContext([]), '');
  assert.equal(renderRagContext(undefined), '');
});

test('renderRagContext 按强度渲染标签并附分级措辞规则', () => {
  const text = renderRagContext(ragPlaces);
  assert.ok(text.includes('预约·实证：官方小程序提前 3 天放票'));
  assert.ok(text.includes('口碑·体验：傍晚人少出片'));
  assert.ok(text.includes('避坑·仅风险：节假日停车极难'));
  assert.ok(text.includes('措辞按情报强度封顶'), '分节头部须含分级措辞规则');
  assert.ok(text.includes('弱表达'), '体验级须约束为弱表达');
  assert.ok(text.includes('条件性提醒'), '风险级须约束为条件性提醒');
});

test('renderRagContext 未知强度按体验级渲染', () => {
  const text = renderRagContext([
    { name: '丙公园', category: '景点', verified: true, evidence: [{ kind: 'xhs_reason', content: '适合遛弯', strength: '' }] },
  ]);
  assert.ok(text.includes('口碑·体验：适合遛弯'));
});
