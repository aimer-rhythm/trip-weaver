import type { Static } from '@sinclair/typebox';
import type {
  ActivitySchema,
  GenerateFormSchema,
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
  ACTIVITY_CATEGORIES,
  BUDGET_LEVELS,
  COORD_SOURCES,
  COORD_SYSTEMS,
  DATA_SOURCE_KINDS,
  LEG_MODES,
  LEG_SOURCES,
  POI_CATEGORIES,
  RESERVATION_STATUSES,
} from './constants';

// 全部领域类型从 TypeBox schema 派生 —— schema 是唯一事实源
export type SourceNote = Static<typeof SourceNoteSchema>;
export type Activity = Static<typeof ActivitySchema>;
export type TransitLeg = Static<typeof TransitLegSchema>;
export type TripDay = Static<typeof TripDaySchema>;
export type TripMeta = Static<typeof TripMetaSchema>;
export type ResearchPoi = Static<typeof ResearchPoiSchema>;
export type Trip = Static<typeof TripSchema>;
export type TripExport = Static<typeof TripExportSchema>;
export type GenerateForm = Static<typeof GenerateFormSchema>;
export type RegisterBody = Static<typeof RegisterBodySchema>;
export type LoginBody = Static<typeof LoginBodySchema>;
export type SettingsPut = Static<typeof SettingsPutSchema>;

export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number];
export type BudgetLevel = (typeof BUDGET_LEVELS)[number];
export type CoordSource = (typeof COORD_SOURCES)[number];
export type CoordSystem = (typeof COORD_SYSTEMS)[number];
export type LegMode = (typeof LEG_MODES)[number];
export type LegSource = (typeof LEG_SOURCES)[number];
export type PoiCategory = (typeof POI_CATEGORIES)[number];
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];
export type DataSourceKind = (typeof DATA_SOURCE_KINDS)[number];

// 派生数据（useMemo/服务端即时计算，不持久化）
export interface BudgetSummary {
  total: number;
  perDay: { dayId: string; dayIndex: number; amount: number }[];
  perCategory: { category: ActivityCategory; amount: number }[];
  overBudget: boolean;
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
  createdAt: number;
  updatedAt: number;
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

/** SSE 载荷；事件 id 由 jobManager 递增分配，供 Last-Event-ID 重放
 *  兼容说明：xhsEnabled / xhsCalls / usedXhs 为小红书时代的旧前端兼容字段——
 *  xhsEnabled 现语义为「有任一外部调研数据源可用」，xhsCalls 恒 0，usedXhs 恒 false */
export type GenerationEvent =
  | { type: 'job_start'; destination: string; xhsEnabled: boolean; dataSources: DataSourceKind[] }
  | { type: 'phase_start'; phase: GenerationPhase; round: number; note?: string }
  | { type: 'phase_end'; phase: GenerationPhase; round: number; summary?: string }
  | { type: 'thought'; phase: GenerationPhase; text: string }
  | { type: 'tool_start'; phase: GenerationPhase; toolCallId: string; tool: string; label: string; args: string }
  | { type: 'tool_end'; phase: GenerationPhase; toolCallId: string; tool: string; label: string; summary: string; isError: boolean }
  | { type: 'candidate'; poi: ResearchPoi }   // 调研 Agent 每写入一条候选即推送（概览卡片实时长出）
  | { type: 'usage'; tokensIn: number; tokensOut: number; xhsCalls: number; amapCalls: number; searchCalls: number }
  | { type: 'job_done'; tripId: string; usedXhs: boolean; dataSources: DataSourceKind[]; reviewNotes: string[] }
  | { type: 'job_error'; message: string }
  | { type: 'job_cancelled' };

/** GET /api/generations/:jobId 快照（刷新恢复用） */
export interface GenerationJobView {
  jobId: string;
  status: GenerationJobStatus;
  tripId: string | null;
  createdAt: number;
}
