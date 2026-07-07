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
    label: '查看预算聚合',
    description: '查看当前草稿的费用汇总（总额/逐天/分类）与预算对比。',
    parameters: Type.Object({}),
    execute: async () => {
      const b = draft.budget();
      const perDay = b.perDay.map((d) => `第${d.dayIndex}天 ¥${Math.round(d.amount)}`).join('，');
      const perCat = b.perCategory.map((c) => `${c.category} ¥${Math.round(c.amount)}`).join('，');
      const target = form.totalBudget ? `目标总预算 ¥${form.totalBudget}${b.overBudget ? '（已超支！）' : ''}` : `未设总预算（档位：${form.budgetLevel}）`;
      return {
        content: text(`人均总费用 ¥${Math.round(b.total)}｜${target}\n逐天：${perDay || '无'}\n分类：${perCat || '无'}`),
        details: { total: b.total, overBudget: b.overBudget },
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
