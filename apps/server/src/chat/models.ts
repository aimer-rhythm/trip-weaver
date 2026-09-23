// 对话理解的模型输出契约（服务端内部，不进共享包）
//
// 与 FloatTrip 的 DialogueDecision 对应，但按本项目范围裁剪：不做 run 控制、不做长期记忆。
//
// ⚠️ 两套 TypeBox 并存（既有现实）：生成工具层用 `typebox` v1（pi-agent-core 生态），
// shared / Fastify 用 `@sinclair/typebox` v0.34。二者运行时产物不兼容（v1 产出 JSON Schema，
// v0.34 的 Value.Check 认不出），所以这里只能跟工具层保持一致用 v1。
// v1 没有 `Static`，因此**不手写镜像接口**——模型输出的读取一律走 unknown + 逐字段防御性归一
// （见 brief.ts 的 applyDialogueDecision / 本文件的 readDecisionHead），避免 schema 与接口漂移。
import {
  CHAT_INTENTS,
  CONSTRAINT_CATEGORIES,
  CONSTRAINT_POLARITIES,
  MAX_TRIP_DAYS,
  PREFERENCE_OPTIONS,
  TRANSPORT_MODES,
  TRIP_FOCUS_OPTIONS,
} from '@tripweaver/shared';
import { Type } from 'typebox';

/**
 * 意图白名单：直接复用共享的 CHAT_INTENTS，不再本地写第二份。
 * 踩过的坑：本地枚举漏加新意图时，工具参数校验会静默失败，agent 反复重试直到轮次超限，
 * 对外只表现为「这条消息没理解成功」——很难定位到枚举漂移。
 */
export const DIALOGUE_INTENTS = CHAT_INTENTS;

export type DialogueIntent = (typeof CHAT_INTENTS)[number];

const enumOf = <T extends readonly string[]>(values: T) => Type.Union(values.map((v) => Type.Literal(v)));

/** 模型新增约束时的输入形状；id 与 evidenceSequence 由服务端补，不让模型编 */
export const ConstraintDraftSchema = Type.Object({
  category: enumOf(CONSTRAINT_CATEGORIES),
  valueText: Type.String({ minLength: 1, maxLength: 200 }),
  polarity: enumOf(CONSTRAINT_POLARITIES),
});

export const DialogueDecisionSchema = Type.Object({
  intent: enumOf(DIALOGUE_INTENTS),
  reply: Type.String({ minLength: 1, maxLength: 400, description: '给用户看的中文一句话；不要复述 JSON 或字段名' }),
  destination: Type.Optional(Type.String({ maxLength: 40, description: '用户本次提到的目的地' })),
  startDate: Type.Optional(Type.String({ maxLength: 10, description: 'YYYY-MM-DD；用户没给年份时按最近的将来推断' })),
  endDate: Type.Optional(Type.String({ maxLength: 10, description: 'YYYY-MM-DD' })),
  days: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_TRIP_DAYS, description: '玩几天' })),
  tripFocus: Type.Optional(enumOf(TRIP_FOCUS_OPTIONS)),
  partySize: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
  transportMode: Type.Optional(enumOf(TRANSPORT_MODES)),
  lodging: Type.Optional(Type.String({ maxLength: 60, description: '住宿位置（区域或酒店名）' })),
  extraNotes: Type.Optional(Type.String({ maxLength: 200, description: '无法归入约束的自由文本要求' })),
  preferences: Type.Optional(Type.Array(enumOf(PREFERENCE_OPTIONS), { maxItems: 7 })),
  addConstraints: Type.Optional(
    Type.Array(ConstraintDraftSchema, { maxItems: 5, description: '本次新识别出的约束；已存在的不要重复添加' }),
  ),
  removeConstraintIds: Type.Optional(
    Type.Array(Type.String(), { maxItems: 30, description: '用户明确取消的已有约束 id（取自当前 Brief）' }),
  ),
  clarification: Type.Optional(
    Type.Object(
      {
        question: Type.String({ minLength: 1, maxLength: 200 }),
        options: Type.Array(Type.String({ maxLength: 40 }), { maxItems: 6 }),
      },
      { description: '缺少必要条件时的一次追问。能枚举就给 2-4 个具体选项，让用户点选而不是手打；日期类不用给选项' },
    ),
  ),
  modifyItinerary: Type.Optional(
    Type.Boolean({ description: '用户想修改本会话已生成的行程（而不是重新生成一份）；仅当下方给出了上一版行程时才可能为 true' }),
  ),
  modificationNotes: Type.Optional(
    Type.String({ maxLength: 500, description: '要改什么，用祈使句写清，一条一句（仅 modifyItinerary=true 时给）' }),
  ),
});

/** 把 LLM 工具参数/JSON 输出收敛成可按键读取的对象；非对象一律当空对象 */
export function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

export function readString(raw: unknown, key: string): string | undefined {
  const value = asRecord(raw)[key];
  return typeof value === 'string' ? value : undefined;
}

export function readStringArray(raw: unknown, key: string): string[] {
  const value = asRecord(raw)[key];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * 读取模型输出的「头部」：意图 + 给用户看的那句话。
 * 意图不在白名单内或 reply 为空 → 返回 null（调用方按理解失败处理，不把垃圾写进会话）。
 */
export function readDecisionHead(raw: unknown): { intent: DialogueIntent; reply: string } | null {
  const intent = readString(raw, 'intent');
  const reply = readString(raw, 'reply')?.trim();
  if (!reply) return null;
  const known = (DIALOGUE_INTENTS as readonly string[]).includes(intent ?? '');
  return { intent: known ? (intent as DialogueIntent) : 'unclear', reply: reply.slice(0, 400) };
}

/**
 * 读取修订意见（PR5）：必须同时有 modifyItinerary=true 与非空 notes，缺一不算。
 * 只有 intent 是 modify_itinerary 也不够 —— 宁可漏报也不要发起一次没头没脑的重跑。
 */
export function readModification(raw: unknown): string | null {
  if (asRecord(raw).modifyItinerary !== true) return null;
  const notes = readString(raw, 'modificationNotes')?.trim();
  return notes ? notes.slice(0, 500) : null;
}

/**
 * 读取模型的可点追问（question + options）。
 * 有 question 就返回（选项可能为空）；前端优先用它而不是服务端兜底的模板问题。
 */
export function readClarification(raw: unknown): { question: string; options: string[] } | null {
  const node = asRecord(asRecord(raw).clarification);
  const question = typeof node.question === 'string' ? node.question.trim() : '';
  if (!question) return null;
  const options = Array.isArray(node.options)
    ? node.options
        .filter((option): option is string => typeof option === 'string' && option.trim().length > 0)
        .map((option) => option.trim().slice(0, 40))
        .slice(0, 6)
    : [];
  return { question: question.slice(0, 200), options };
}

/** 对话理解失败的公开错误：不把模型内部细节透给客户端 */
export class DialogueUnderstandingError extends Error {
  readonly statusCode = 502;
  readonly code = 'dialogue_understanding_failed';
  constructor(message = '这条消息暂时没有理解成功，请重试') {
    super(message);
  }
}
