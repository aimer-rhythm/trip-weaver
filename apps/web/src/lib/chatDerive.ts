// 对话视图的纯派生逻辑（无 React 依赖，便于单测）。
//
// 为什么不建 chatStore：对话的消息与 Brief 都是服务端状态，React Query 已经是唯一持有者。
// 再复制一份到 zustand 会踩 state-management.md 里明确列出的反模式；
// 这里只保留「由服务端数据推导展示形态」的纯函数。
import {
  TRIP_FOCUS_LABELS,
  type BriefIntake,
  type ChatMessage,
  type ConstraintPolarity,
  type PlanningBriefData,
  type PlanningBriefView,
  type TransportMode,
} from '@tripweaver/shared';
import { ApiError } from '../api/client';

export const TRANSPORT_LABELS: Record<TransportMode, string> = {
  transit: '公共交通',
  drive: '自驾',
  walk: '步行优先',
};
/**
 * 约束极性的展示契约（四套文案差异必须明显）：
 * 尤其 `fact` ——「带着 2 岁小孩」是背景信息，不等于「必须安排亲子景点」。
 */
export const POLARITY_PRESENTATION: Record<ConstraintPolarity, { badge: string; summary: string; excludeAction: string }> = {
  prefer: { badge: '优先考虑', summary: '偏好', excludeAction: '本次不优先' },
  avoid: { badge: '本次避开', summary: '避开', excludeAction: '本次允许安排' },
  require: { badge: '必须满足', summary: '必须', excludeAction: '本次取消要求' },
  fact: { badge: '仅作背景', summary: '背景', excludeAction: '本次不参考' },
};

/** 未知极性（历史数据/手改）不崩：落到和 fact 相同的展示，最保守 */
const POLARITY_FALLBACK = POLARITY_PRESENTATION.fact;

export function polarityPresentation(polarity: string) {
  return POLARITY_PRESENTATION[polarity as ConstraintPolarity] ?? POLARITY_FALLBACK;
}

/** 追问控件在什么时候还该展示：只有它之后没有新的用户消息时才「活着」 */
export function isIntakeLive(messages: ChatMessage[], message: ChatMessage): boolean {
  if (!message.intake) return false;
  return !messages.some((m) => m.role === 'user' && m.sequence > message.sequence);
}

/** 当前生效的追问控件（取最后一条仍然活着的）——回答过就收起，避免重复点击 */
export function activeIntake(messages: ChatMessage[]): BriefIntake | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message || message.role !== 'assistant' || !message.intake) continue;
    if (isIntakeLive(messages, message)) return message.intake;
  }
  return null;
}

/** Brief 齐备才允许「开始生成」（与服务端 requiredBriefFields 同源判定） */
export function canGenerate(brief: PlanningBriefView | null | undefined): boolean {
  return Boolean(brief?.status === 'ready' && brief.missingFields.length === 0);
}

/** 会话列表里的一行摘要：先看能不能生成，再看还差几项，最后给更新时间 */
export function conversationSummary(brief: PlanningBriefView): string {
  const state =
    brief.status === 'ready'
      ? '信息齐备'
      : `还差 ${brief.missingFields.length} 项`;
  const at = new Date(brief.updatedAt);
  const stamp = Number.isNaN(at.getTime())
    ? ''
    : `${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')} ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  return stamp ? `${state} · ${stamp}` : state;
}

export interface BriefRow {
  key: string;
  label: string;
  value: string;
}

/** 确认卡的字段行；空值行也保留，用户才能看到「还差什么」 */
export function briefRows(data: PlanningBriefData): BriefRow[] {
  const dateValue =
    data.startDate && data.endDate
      ? `${data.startDate} → ${data.endDate}`
      : data.startDate && data.days
        ? `${data.startDate} 出发 · ${data.days} 天`
        : data.startDate
          ? `${data.startDate} 出发`
          : data.days
            ? `${data.days} 天（日期待定）`
            : '';
  return [
    { key: 'destination', label: '目的地', value: data.destination?.trim() ?? '' },
    { key: 'dates', label: '日期', value: dateValue },
    { key: 'tripFocus', label: '侧重点', value: data.tripFocus ? TRIP_FOCUS_LABELS[data.tripFocus] : '' },
    { key: 'partySize', label: '人数', value: data.partySize ? `${data.partySize} 人` : '' },
    { key: 'transportMode', label: '出行方式', value: data.transportMode ? TRANSPORT_LABELS[data.transportMode] : '' },
    { key: 'lodging', label: '住宿', value: data.lodging?.trim() ?? '' },
    { key: 'extraNotes', label: '补充要求', value: data.extraNotes?.trim() ?? '' },
  ];
}

export function preferenceText(data: PlanningBriefData): string {
  return data.preferences?.length ? data.preferences.join('、') : '';
}

/** 三种追问控件的形态：枚举给按钮、日期给日期输入、其余给文本框 */
export type IntakeShape = 'buttons' | 'date-range' | 'text';

export function intakeShape(intake: BriefIntake): IntakeShape {
  if (intake.inputSchema.format === 'date-range') return 'date-range';
  if (intake.inputSchema.enum?.length) return 'buttons';
  return 'text';
}

/** 发送/编辑失败 → 可操作提示（沿用既有 4xx 分流风格：给下一步，而不是死胡同） */
export function chatErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return '网络异常，请稍后重试';
  if (error.status === 401) return '登录已过期，请刷新页面重新登录。';
  if (error.status === 404) return '会话不存在或已被删除，请刷新页面。';
  if (error.status === 429) {
    const resetAt = typeof error.data?.resetAt === 'number' ? new Date(error.data.resetAt) : null;
    const at = resetAt ? `，${String(resetAt.getHours()).padStart(2, '0')}:${String(resetAt.getMinutes()).padStart(2, '0')} 后重置` : '';
    return `今日对话次数已用完${at}。条件齐了可以直接点「开始生成」，生成次数是另一套额度。`;
  }
  if (error.status === 400 && error.data?.code === 'no_llm') {
    return error.data?.hasSiteKey
      ? '站点 AI 配置异常，请联系站长。'
      : '本站未配置 AI 服务：普通用户请联系站长开通；也可以在「设置 → 高级选项」填入自己的 API Key 立即使用。';
  }
  if (error.status >= 500) return '这条消息暂时没有理解成功，可以直接重发一次。';
  return error.message;
}
