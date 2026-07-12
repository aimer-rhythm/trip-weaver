// 审校 Agent 工具组：预算聚合（与前端同一份 shared 逻辑）+ 审校结论提交
import { Type } from 'typebox';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import { defineTool } from './defineTool';
import type { DraftTrip } from '../draft';

function text(t: string) {
  return [{ type: 'text' as const, text: t }];
}

export interface ReviewOutcome {
  submitted: boolean;
  approved: boolean;
  notes: string[];
  revisionRequests: string[];
}

export function buildReviewTools(draft: DraftTrip, form: { budgetLevel: string; totalBudget?: number }, outcome: ReviewOutcome): AgentTool[] {
  const budgetTool = defineTool({
    name: 'get_budget_status',
    label: '查看预算区间',
    description: '查看当前草稿的人均每日费用粗估区间，用于判断与预算档位是否明显失配（费用为粗估档位值，无需核对精确总价）。',
    parameters: Type.Object({}),
    execute: async () => {
      const b = draft.budget();
      const range =
        b.coveredDays > 0
          ? `人均约 ¥${b.perPersonPerDayMin}–${b.perPersonPerDayMax}/天（门票餐饮等粗估，不含大交通与住宿；有费用数据 ${b.coveredDays} 天）`
          : '暂无费用数据（各活动均未填 cost）';
      const target = form.totalBudget ? `用户预算：档位 ${form.budgetLevel}，总预算 ¥${form.totalBudget}` : `用户预算：档位 ${form.budgetLevel}（未设总预算）`;
      return {
        content: text(`${range}\n${target}\n判断标准：仅当区间与档位明显失配（如经济档人均每天数千元）才需要调整。`),
        details: { perPersonPerDayMin: b.perPersonPerDayMin, perPersonPerDayMax: b.perPersonPerDayMax, coveredDays: b.coveredDays },
      };
    },
  });

  const submitTool = defineTool({
    name: 'submit_review',
    label: '提交审校结论',
    description: '提交最终审校结论，提交后审校阶段结束。',
    parameters: Type.Object({
      approved: Type.Boolean({ description: '是否通过（无结构性问题即通过）' }),
      notes: Type.Array(Type.String(), { description: '给用户看的改进建议/遗留提示，≤3 条，可为空' }),
      revisionRequests: Type.Array(Type.String(), { description: '交回规划师的结构性修订要求；approved=true 时留空' }),
    }),
    execute: async (_id, params) => {
      outcome.submitted = true;
      outcome.approved = params.approved;
      outcome.notes = params.notes.slice(0, 3).map((n) => n.slice(0, 200));
      outcome.revisionRequests = params.revisionRequests.slice(0, 5).map((r) => r.slice(0, 300));
      return { content: text('审校结论已收到。'), details: { approved: params.approved }, terminate: true };
    },
  });

  return [budgetTool, submitTool];
}
