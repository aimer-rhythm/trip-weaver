import type { Static } from '@sinclair/typebox';
import type {
  ActivitySchema,
  GenerateFormSchema,
  LodgingSchema,
  LoginBodySchema,
  RegisterBodySchema,
  ResearchPoiSchema,
  SettingsPutSchema,
  SourceNoteSchema,
  TripDaySchema,
  TripExportSchema,
  TripMetaSchema,
  TripSchema,
  TransitLegSchema,
} from './schemas';
import type {
  BriefInputSchemaSchema,
  BriefIntakeSchema,
  ChatMessageSchema,
  ConversationDetailSchema,
  ConversationSchema,
  ConversationTripRefSchema,
  PlanningBriefDataSchema,
  PlanningBriefPatchSchema,
  PlanningBriefViewSchema,
  SendMessageResultSchema,
  TripConstraintDraftSchema,
  TripConstraintSchema,
} from './chat';
import type {
  ACTIVITY_CATEGORIES,
  BRIEF_MISSING_FIELDS,
  BRIEF_STATUSES,
  BUDGET_LEVELS,
  CHAT_MESSAGE_ROLES,
  CONVERSATION_STATUSES,
  CHAT_INTENTS,
  CONSTRAINT_CATEGORIES,
  CONSTRAINT_POLARITIES,
  COORD_SOURCES,
  COORD_SYSTEMS,
  DATA_SOURCE_KINDS,
  GENERATION_KINDS,
  LEG_MODES,
  LEG_SOURCES,
  POI_CATEGORIES,
  RESERVATION_STATUSES,
  TRANSPORT_MODES,
  TRIP_FOCUS_OPTIONS,
} from './constants';

// 全部领域类型从 TypeBox schema 派生 —— schema 是唯一事实源
export type SourceNote = Static<typeof SourceNoteSchema>;
export type Activity = Static<typeof ActivitySchema>;
export type TransitLeg = Static<typeof TransitLegSchema>;
export type Lodging = Static<typeof LodgingSchema>;
export type TripDay = Static<typeof TripDaySchema>;
export type TripMeta = Static<typeof TripMetaSchema>;
export type ResearchPoi = Static<typeof ResearchPoiSchema>;
export type Trip = Static<typeof TripSchema>;
export type TripExport = Static<typeof TripExportSchema>;
export type GenerateForm = Static<typeof GenerateFormSchema>;
export type RegisterBody = Static<typeof RegisterBodySchema>;
export type LoginBody = Static<typeof LoginBodySchema>;
export type SettingsPut = Static<typeof SettingsPutSchema>;

// ---------- 问答式行程生成入口（09-23） ----------
export type TripConstraint = Static<typeof TripConstraintSchema>;
export type TripConstraintDraft = Static<typeof TripConstraintDraftSchema>;
export type PlanningBriefData = Static<typeof PlanningBriefDataSchema>;
export type PlanningBriefView = Static<typeof PlanningBriefViewSchema>;
export type PlanningBriefPatch = Static<typeof PlanningBriefPatchSchema>;
export type BriefInputSchema = Static<typeof BriefInputSchemaSchema>;
export type BriefIntake = Static<typeof BriefIntakeSchema>;
export type ChatMessage = Static<typeof ChatMessageSchema>;
export type Conversation = Static<typeof ConversationSchema>;
export type ConversationDetail = Static<typeof ConversationDetailSchema>;
export type ConversationTripRef = Static<typeof ConversationTripRefSchema>;
export type SendMessageResult = Static<typeof SendMessageResultSchema>;

export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];
export type ChatMessageRole = (typeof CHAT_MESSAGE_ROLES)[number];
export type BriefStatus = (typeof BRIEF_STATUSES)[number];
export type TripFocus = (typeof TRIP_FOCUS_OPTIONS)[number];
export type ConstraintCategory = (typeof CONSTRAINT_CATEGORIES)[number];
export type ConstraintPolarity = (typeof CONSTRAINT_POLARITIES)[number];
export type BriefMissingField = (typeof BRIEF_MISSING_FIELDS)[number];
export type GenerationKind = (typeof GENERATION_KINDS)[number];
export type ChatIntent = (typeof CHAT_INTENTS)[number];

export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number];
export type BudgetLevel = (typeof BUDGET_LEVELS)[number];
export type CoordSource = (typeof COORD_SOURCES)[number];
export type CoordSystem = (typeof COORD_SYSTEMS)[number];
export type LegMode = (typeof LEG_MODES)[number];
export type LegSource = (typeof LEG_SOURCES)[number];
export type PoiCategory = (typeof POI_CATEGORIES)[number];
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];
export type DataSourceKind = (typeof DATA_SOURCE_KINDS)[number];
export type TransportMode = (typeof TRANSPORT_MODES)[number];

// 派生数据（useMemo/服务端即时计算，不持久化）
// ST3 预算区间化：cost 为粗估档位值 → 只给「人均约 ¥min–max/天」区间（门票餐饮等，不含大交通与住宿），不再有精确总额与超支判定
export interface BudgetSummary {
  perPersonPerDayMin: number;
  perPersonPerDayMax: number;
  /** 有费用数据（任一活动带 cost）的天数；0 = 无任何费用数据 */
  coveredDays: number;
}

// 行程列表条目（服务端冗余列）
export interface TripListItem {
  id: string;
  title: string;
  destination: string;
  daysCount: number;
  activityCount: number;
  totalCost: number;
  usedXhs: boolean;   // 历史兼容：小红书时代旧行程可为 true，新生成恒 false（前端已不再展示）
  /** 版本链上的序号（09-23）：1 = 首版；列表只返回每条链的最新版 */
  version: number;
  createdAt: number;
  updatedAt: number;
}

/** 版本链上的一版（详情页版本切换用） */
export interface TripVersionItem {
  id: string;
  version: number;
  title: string;
  createdAt: number;
}

export interface TripVersionChain {
  rootId: string;
  versions: TripVersionItem[];
}

// 用量视图
export interface UsageView {
  usedToday: number;
  dailyLimit: number;
  remaining: number;
  resetAt: number; // 次日零点时间戳（服务器时区）
}

// ---------- 智能生成（C2 服务端 / C3 前端共用协议） ----------

export type GenerationPhase = 'research' | 'plan' | 'review';
export type GenerationJobStatus = 'running' | 'done' | 'error' | 'cancelled';
/** 取消来源：用户主动取消 vs 整任务超时被系统自动取消（reason 可选以兼容旧事件） */
export type GenerationCancelReason = 'user' | 'timeout';

/** SSE 载荷；事件 id 由 jobManager 递增分配，供 Last-Event-ID 重放
 *  兼容说明：xhsEnabled / xhsCalls / usedXhs 为小红书时代的旧前端兼容字段——
 *  xhsEnabled 现语义为「有任一外部调研数据源可用」，xhsCalls 恒 0，usedXhs 恒 false */
type GenerationEventPayload =
  | { type: 'job_start'; destination: string; xhsEnabled: boolean; dataSources: DataSourceKind[] }
  | { type: 'phase_start'; phase: GenerationPhase; round: number; note?: string }
  | { type: 'phase_end'; phase: GenerationPhase; round: number; summary?: string; durationMs?: number }
  | { type: 'thought'; phase: GenerationPhase; text: string }
  | { type: 'tool_start'; phase: GenerationPhase; toolCallId: string; tool: string; label: string; args: string }
  | { type: 'tool_end'; phase: GenerationPhase; toolCallId: string; tool: string; label: string; summary: string; isError: boolean; durationMs?: number }
  | { type: 'candidate'; poi: ResearchPoi }   // 调研 Agent 每写入一条候选即推送（概览卡片实时长出）
  // LLM 请求上下文快照（09-20 调试视图）：每次 API 请求推送完整上下文，响应到后回填结果；turn 在阶段内从 1 递增
  | { type: 'llm_request'; phase: GenerationPhase; turn: number; model: string; systemPrompt: string; messages: unknown[]; tools: unknown[] }
  | { type: 'llm_response'; phase: GenerationPhase; turn: number; stopReason?: string; tokensIn?: number; tokensOut?: number; errorMessage?: string }
  | { type: 'usage'; tokensIn: number; tokensOut: number; xhsCalls: number; amapCalls: number; searchCalls: number }
  | { type: 'job_done'; tripId: string; usedXhs: boolean; dataSources: DataSourceKind[]; reviewNotes: string[]; durationMs?: number }
  | { type: 'job_error'; message: string; durationMs?: number }
  | { type: 'job_cancelled'; reason?: GenerationCancelReason; durationMs?: number };

/** 服务端事件时间（Unix ms）用于稳定重放耗时；可选以兼容旧事件。 */
export type GenerationEvent = GenerationEventPayload & { at?: number };

/** GET /api/generations/:jobId 快照（刷新恢复用） */
export interface GenerationJobView {
  jobId: string;
  status: GenerationJobStatus;
  tripId: string | null;
  createdAt: number;
}
