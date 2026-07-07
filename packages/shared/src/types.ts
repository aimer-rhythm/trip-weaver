import type { Static } from '@sinclair/typebox';
import type {
  ActivitySchema,
  GenerateFormSchema,
  LoginBodySchema,
  RegisterBodySchema,
  SettingsPutSchema,
  SourceNoteSchema,
  TripDaySchema,
  TripExportSchema,
  TripMetaSchema,
  TripSchema,
} from './schemas';
import type { ACTIVITY_CATEGORIES, BUDGET_LEVELS, COORD_SOURCES } from './constants';

// 全部领域类型从 TypeBox schema 派生 —— schema 是唯一事实源
export type SourceNote = Static<typeof SourceNoteSchema>;
export type Activity = Static<typeof ActivitySchema>;
export type TripDay = Static<typeof TripDaySchema>;
export type TripMeta = Static<typeof TripMetaSchema>;
export type Trip = Static<typeof TripSchema>;
export type TripExport = Static<typeof TripExportSchema>;
export type GenerateForm = Static<typeof GenerateFormSchema>;
export type RegisterBody = Static<typeof RegisterBodySchema>;
export type LoginBody = Static<typeof LoginBodySchema>;
export type SettingsPut = Static<typeof SettingsPutSchema>;

export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number];
export type BudgetLevel = (typeof BUDGET_LEVELS)[number];
export type CoordSource = (typeof COORD_SOURCES)[number];

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
  usedXhs: boolean;
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

/** SSE 载荷；事件 id 由 jobManager 递增分配，供 Last-Event-ID 重放 */
export type GenerationEvent =
  | { type: 'job_start'; destination: string; xhsEnabled: boolean }
  | { type: 'phase_start'; phase: GenerationPhase; round: number; note?: string }
  | { type: 'phase_end'; phase: GenerationPhase; round: number; summary?: string }
  | { type: 'thought'; phase: GenerationPhase; text: string }
  | { type: 'tool_start'; phase: GenerationPhase; toolCallId: string; tool: string; label: string; args: string }
  | { type: 'tool_end'; phase: GenerationPhase; toolCallId: string; tool: string; label: string; summary: string; isError: boolean }
  | { type: 'usage'; tokensIn: number; tokensOut: number; xhsCalls: number }
  | { type: 'job_done'; tripId: string; usedXhs: boolean; reviewNotes: string[] }
  | { type: 'job_error'; message: string }
  | { type: 'job_cancelled' };

/** GET /api/generations/:jobId 快照（刷新恢复用） */
export interface GenerationJobView {
  jobId: string;
  status: GenerationJobStatus;
  tripId: string | null;
  createdAt: number;
}
