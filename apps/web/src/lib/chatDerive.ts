// 对话视图的纯派生逻辑（无 React 依赖，便于单测）。
//
// 为什么不建 chatStore：对话的消息与 Brief 都是服务端状态，React Query 已经是唯一持有者。
// 再复制一份到 zustand 会踩 state-management.md 里明确列出的反模式；
// 这里只保留「由服务端数据推导展示形态」的纯函数。
import {
  type BriefIntake,
  type ChatMessage,
  type TransportMode,
} from '@tripweaver/shared';
import { ApiError } from '../api/client';

export const TRANSPORT_LABELS: Record<TransportMode, string> = {
  transit: '公共交通',
  drive: '自驾',
  walk: '步行优先',
};

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
