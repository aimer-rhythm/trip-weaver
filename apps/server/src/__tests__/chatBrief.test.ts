// 单测：问答式入口的 Brief 就绪判定与追问控件构造（纯函数，服务端与前端共用同一规则）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Value } from '@sinclair/typebox/value';
import {
  BriefIntakeSchema,
  PlanningBriefDataSchema,
  TripConstraintSchema,
  briefIntake,
  briefIntakeWithOptions,
  isBriefReady,
  requiredBriefFields,
  type PlanningBriefData,
} from '@tripweaver/shared';

const base: PlanningBriefData = { destination: '成都', startDate: '2026-11-05', days: 3, tripFocus: 'balanced', constraints: [] };

test('必填只有 4 项：全空时按固定顺序报缺', () => {
  assert.deepEqual(requiredBriefFields({ constraints: [] }), ['destination', 'startDate', 'endDate', 'tripFocus']);
});

test('days 是 endDate 的合法等价表达——给了 days 就不再报缺 endDate', () => {
  assert.deepEqual(requiredBriefFields({ constraints: [], destination: '成都', startDate: '2026-11-05', days: 3, tripFocus: 'balanced' }), []);
});

test('startDate + endDate 齐备时无需 days', () => {
  assert.deepEqual(requiredBriefFields({ ...base, days: undefined, endDate: '2026-11-07' }), []);
});

test('非法日期被拒：格式错误与日历上不存在的日期都算缺失', () => {
  assert.ok(requiredBriefFields({ ...base, startDate: '2026/11/05' }).includes('startDate'));
  assert.ok(requiredBriefFields({ ...base, startDate: '2026-02-30' }).includes('startDate'));
});

test('结束早于开始 → 合成项 dateRange；相等不报错', () => {
  assert.ok(requiredBriefFields({ ...base, days: undefined, startDate: '2026-11-05', endDate: '2026-11-01' }).includes('dateRange'));
  assert.deepEqual(requiredBriefFields({ ...base, days: undefined, startDate: '2026-11-05', endDate: '2026-11-05' }), []);
});

test('齐备时 isBriefReady 为真，缺任一必填为假', () => {
  assert.equal(isBriefReady(base), true);
  assert.equal(isBriefReady({ ...base, tripFocus: undefined }), false);
});

test('缺「旅行侧重点」单项时给三选一按钮，enum 用 canonical 值而非中文标签', () => {
  const intake = briefIntake(['tripFocus']);
  assert.deepEqual(intake.inputSchema.enum, ['sights_first', 'food_first', 'balanced']);
  assert.deepEqual(intake.missingFields, ['tripFocus']);
  assert.equal(intake.inputSchema.enumKind, 'canonical');
});

test('缺日期单项时给日期范围控件', () => {
  assert.equal(briefIntake(['startDate']).inputSchema.format, 'date-range');
  assert.equal(briefIntake(['dateRange']).inputSchema.format, 'date-range');
});

test('缺多项时只问第一项，不再把多个字段汇总成一句丢给文本框', () => {
  const intake = briefIntake(['startDate', 'destination', 'tripFocus']);
  assert.deepEqual(intake.missingFields, ['startDate']);
  assert.equal(intake.inputSchema.format, 'date-range');
});

test('缺多项且第一项是侧重点 → 仍然是 canonical 按钮', () => {
  const intake = briefIntake(['tripFocus', 'destination']);
  assert.deepEqual(intake.inputSchema.enum, ['sights_first', 'food_first', 'balanced']);
  assert.equal(intake.inputSchema.enumKind, 'canonical');
});

test('缺多项且第一项无法枚举 → 只问该字段的文本框（宁再三轮，不把需求丢给用户写）', () => {
  const intake = briefIntake(['destination', 'tripFocus']);
  assert.deepEqual(intake.missingFields, ['destination']);
  assert.equal(intake.question, '这次想去哪里？');
  assert.equal(intake.inputSchema.enum, undefined);
});

test('模型给了选项 → 直接用模型文案与候选，并标记为自然语言（点击走消息而非 PATCH）', () => {
  const intake = briefIntakeWithOptions(['destination', 'startDate'], '这次想去哪里？', ['成都', '重庆', '西安']);
  assert.deepEqual(intake.inputSchema.enum, ['成都', '重庆', '西安']);
  assert.equal(intake.inputSchema.enumKind, 'natural');
  assert.equal(intake.question, '这次想去哪里？');
  assert.ok(Value.Check(BriefIntakeSchema, intake));
});

test('模型选项去空、去重、限量 6 个', () => {
  const intake = briefIntakeWithOptions(['destination'], 'q', ['a', ' a ', '', 'b', 'c', 'd', 'e', 'f']);
  assert.deepEqual(intake.inputSchema.enum, ['a', 'b', 'c', 'd', 'e', 'f']);
});

test('briefIntake 产出符合 BriefIntakeSchema', () => {
  for (const missing of [['tripFocus'], ['startDate'], ['destination', 'endDate', 'tripFocus']] as const) {
    assert.ok(Value.Check(BriefIntakeSchema, briefIntake([...missing])));
  }
});

test('约束 schema：接受 4 种 polarity，拒绝未知分类与未知极性', () => {
  const constraint = { id: 'c1', category: 'companion_context', valueText: '带 2 岁小孩', polarity: 'fact', evidenceSequence: 1 };
  assert.ok(Value.Check(TripConstraintSchema, constraint));
  assert.ok(Value.Check(TripConstraintSchema, { ...constraint, polarity: 'avoid' }));
  assert.ok(!Value.Check(TripConstraintSchema, { ...constraint, polarity: 'neutral' }));
  assert.ok(!Value.Check(TripConstraintSchema, { ...constraint, category: 'mood' }));
});

test('Brief data schema：字段全可选（只要求 constraints），未知字段不通过', () => {
  assert.ok(Value.Check(PlanningBriefDataSchema, { constraints: [] }));
  assert.ok(!Value.Check(PlanningBriefDataSchema, {}));
  assert.ok(Value.Check(PlanningBriefDataSchema, base));
  assert.ok(Value.Check(PlanningBriefDataSchema, { ...base, tripFocus: 'food_first' }));
  assert.ok(!Value.Check(PlanningBriefDataSchema, { ...base, tripFocus: 'whatever' }));
});
