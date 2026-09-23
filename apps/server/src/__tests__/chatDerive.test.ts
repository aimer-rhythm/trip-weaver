// 单测：对话视图的纯派生逻辑（web lib 的纯函数统一放在这里，与 generationTimeline.test.ts 同例）
import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatMessage, PlanningBriefView } from '@tripweaver/shared';
import {
  activeIntake,
  briefRows,
  canGenerate,
  chatErrorMessage,
  conversationSummary,
  intakeShape,
  isIntakeLive,
  polarityPresentation,
} from '../../../web/src/lib/chatDerive';
import { ApiError } from '../../../web/src/api/client';

function message(partial: Partial<ChatMessage> & { sequence: number; role: ChatMessage['role'] }): ChatMessage {
  return { id: `m${partial.sequence}`, conversationId: 'c1', content: '', createdAt: 0, ...partial };
}

const intake = { question: '大概什么时候出发？', missingFields: ['startDate' as const], inputSchema: { type: 'string', format: 'date-range' } };

test('追问控件在其之后没有新的用户消息时保持有效', () => {
  const assistant = message({ sequence: 2, role: 'assistant', intake });
  assert.equal(isIntakeLive([assistant], assistant), true);
  const answered = [assistant, message({ sequence: 3, role: 'user', content: '11月5号' })];
  assert.equal(isIntakeLive(answered, answered[0]!), false);
});

test('activeIntake 取最后一条仍然有效的追问控件；回答后返回 null', () => {
  const first = message({ sequence: 2, role: 'assistant', intake });
  const second = message({ sequence: 4, role: 'assistant', intake });
  assert.equal(activeIntake([first, message({ sequence: 3, role: 'user' }), second])?.question, intake.question);
  assert.equal(activeIntake([first, message({ sequence: 3, role: 'user' })]), null);
  assert.equal(activeIntake([]), null);
});

test('三种追问控件形态由 inputSchema 决定', () => {
  assert.equal(intakeShape({ question: 'q', missingFields: ['tripFocus'], inputSchema: { type: 'string', enum: ['a', 'b'] } }), 'buttons');
  assert.equal(intakeShape(intake), 'date-range');
  assert.equal(intakeShape({ question: 'q', missingFields: ['destination'], inputSchema: { type: 'string' } }), 'text');
});

test('canGenerate 只在 Brief 齐备时为真', () => {
  const ready = { status: 'ready', data: { constraints: [] }, missingFields: [], updatedAt: 0 } as PlanningBriefView;
  assert.equal(canGenerate(ready), true);
  assert.equal(canGenerate({ ...ready, missingFields: ['destination' ] }, ), false);
  assert.equal(canGenerate({ ...ready, status: 'collecting' }), false);
  assert.equal(canGenerate(null), false);
});

test('briefRows 的日期渲染覆盖四种组合', () => {
  const row = (data: Parameters<typeof briefRows>[0]) => briefRows(data).find((r) => r.key === 'dates')?.value;
  assert.equal(row({ constraints: [], startDate: '2026-11-05', endDate: '2026-11-07' }), '2026-11-05 → 2026-11-07');
  assert.equal(row({ constraints: [], startDate: '2026-11-05', days: 3 }), '2026-11-05 出发 · 3 天');
  assert.equal(row({ constraints: [], startDate: '2026-11-05' }), '2026-11-05 出发');
  assert.equal(row({ constraints: [], days: 3 }), '3 天（日期待定）');
  assert.equal(row({ constraints: [] }), '');
});

test('briefRows 为未填字段留空值，供确认卡显示「待补充」', () => {
  const rows = briefRows({ constraints: [], destination: '成都' });
  assert.equal(rows.find((r) => r.key === 'destination')?.value, '成都');
  assert.equal(rows.find((r) => r.key === 'tripFocus')?.value, '');
  assert.ok(rows.length >= 7);
});

test('对话额度耗尽的错误文案给出下一步（引导去生成），而不是死胡同', () => {
  const text = chatErrorMessage(new ApiError(429, '今日对话次数已用完', { resetAt: Date.now() }));
  assert.match(text, /开始生成/);
});

test('四种极性各有不同文案；未知极性不崩，落到最保守的展示', () => {
  const badges = (['prefer', 'avoid', 'require', 'fact'] as const).map((p) => polarityPresentation(p).badge);
  assert.equal(new Set(badges).size, 4);
  assert.equal(polarityPresentation('prefer').excludeAction, '本次不优先');
  assert.equal(polarityPresentation('avoid').excludeAction, '本次允许安排');
  assert.equal(polarityPresentation('require').excludeAction, '本次取消要求');
  // 历史数据/手改数据里出现没见过的极性时不能抛错
  assert.equal(polarityPresentation('legacy_unknown').badge, '仅作背景');
});

test('会话摘要先给能不能生成，再给还差几项', () => {
  const brief = (missing: PlanningBriefView['missingFields'], status: PlanningBriefView['status']) =>
    ({ status, data: { constraints: [] }, missingFields: missing, updatedAt: Date.UTC(2026, 10, 5, 3, 4) }) as PlanningBriefView;
  assert.match(conversationSummary(brief([], 'ready')), /^信息齐备 · /);
  assert.match(conversationSummary(brief(['destination', 'startDate'], 'collecting')), /^还差 2 项 · /);
});

test('未配置 AI 的错误按 hasSiteKey 分流；未知错误保留原文', () => {
  assert.match(chatErrorMessage(new ApiError(400, 'x', { code: 'no_llm', hasSiteKey: false })), /高级选项/);
  assert.match(chatErrorMessage(new ApiError(400, 'x', { code: 'no_llm', hasSiteKey: true })), /联系站长/);
  assert.equal(chatErrorMessage(new ApiError(418, '我是一只茶壶')), '我是一只茶壶');
});
