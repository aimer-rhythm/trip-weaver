// 单测：对话视图的纯派生逻辑（web lib 的纯函数统一放在这里，与 generationTimeline.test.ts 同例）
import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatMessage } from '@tripweaver/shared';
import {
  activeIntake,
  chatErrorMessage,
  intakeShape,
  isIntakeLive,
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
  assert.equal(intakeShape({ question: 'q', missingFields: ['pace'], inputSchema: { type: 'string', enum: ['a', 'b'] } }), 'buttons');
  assert.equal(intakeShape(intake), 'date-range');
  assert.equal(intakeShape({ question: 'q', missingFields: ['destination'], inputSchema: { type: 'string' } }), 'text');
});

test('对话额度耗尽的错误文案给出下一步（引导去生成），而不是死胡同', () => {
  const text = chatErrorMessage(new ApiError(429, '今日对话次数已用完', { resetAt: Date.now() }));
  assert.match(text, /开始生成/);
});

test('未配置 AI 的错误按 hasSiteKey 分流；未知错误保留原文', () => {
  assert.match(chatErrorMessage(new ApiError(400, 'x', { code: 'no_llm', hasSiteKey: false })), /高级选项/);
  assert.match(chatErrorMessage(new ApiError(400, 'x', { code: 'no_llm', hasSiteKey: true })), /联系站长/);
  assert.equal(chatErrorMessage(new ApiError(418, '我是一只茶壶')), '我是一只茶壶');
});
