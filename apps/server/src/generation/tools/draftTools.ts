// 编排 Agent 的草稿读写工具组：DraftTrip 是唯一可变状态，工具返回文本供模型自愈（R2）
import { Type } from 'typebox';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import { defineTool } from './defineTool';
import type { DraftTrip, DraftActivityInput } from '../draft';

function text(t: string) {
  return [{ type: 'text' as const, text: t }];
}

const OptionalActivityFields = {
  startTime: Type.Optional(Type.String({ description: '开始时间 HH:mm，如 09:00' })),
  endTime: Type.Optional(Type.String({ description: '结束时间 HH:mm' })),
  description: Type.Optional(Type.String({ description: '亮点与实用提示，≤100 字' })),
  category: Type.Optional(Type.String({ description: '美食/文化/自然/购物/住宿/交通/娱乐/其他' })),
  cost: Type.Optional(Type.Number({ description: '人均预估费用（人民币），免费填 0' })),
  lat: Type.Optional(Type.Number({ description: '纬度（geocode_place 的返回）' })),
  lng: Type.Optional(Type.Number({ description: '经度' })),
  sourceNotes: Type.Optional(
    Type.Array(Type.Object({ title: Type.String(), url: Type.String() }), {
      description: '来源笔记（仅可用调研摘要中出现过的链接）',
    }),
  ),
};

export function buildDraftTools(draft: DraftTrip): AgentTool[] {
  const skeletonTool = defineTool({
    name: 'set_trip_skeleton',
    label: '建立行程骨架',
    description: '设定行程标题与每天的主题（调用一次即可，重复调用会清空已填活动）。',
    parameters: Type.Object({
      title: Type.String({ description: '行程标题，如「东京五日美食漫步」' }),
      dayTitles: Type.Array(Type.String(), { description: '每天的主题短语，数组长度 = 天数' }),
    }),
    execute: async (_id, params) => ({
      content: text(draft.setSkeleton(params.title, params.dayTitles)),
      details: { days: params.dayTitles.length },
    }),
  });

  const addTool = defineTool({
    name: 'add_activity',
    label: '添加活动',
    description: '向某一天添加一个活动。可在同一条消息里并行发多个 add_activity。',
    parameters: Type.Object({
      dayIndex: Type.Integer({ description: '第几天（从 1 开始）' }),
      name: Type.String({ description: '活动名称' }),
      ...OptionalActivityFields,
    }),
    execute: async (_id, params) => {
      const { dayIndex, ...input } = params;
      const msg = draft.addActivity(dayIndex, input as DraftActivityInput);
      return { content: text(msg), details: { dayIndex, name: params.name, isError: msg.startsWith('错误') } };
    },
  });

  const updateTool = defineTool({
    name: 'update_activity',
    label: '修改活动',
    description: '修改某天第 N 个活动的字段（只传需要修改的字段）。位置编号见 get_draft 输出。',
    parameters: Type.Object({
      dayIndex: Type.Integer({ description: '第几天（从 1 开始）' }),
      position: Type.Integer({ description: '该天第几个活动（从 1 开始）' }),
      name: Type.Optional(Type.String({ description: '活动名称' })),
      ...OptionalActivityFields,
    }),
    execute: async (_id, params) => {
      const { dayIndex, position, ...patch } = params;
      return { content: text(draft.updateActivity(dayIndex, position, patch as DraftActivityInput)), details: { dayIndex, position } };
    },
  });

  const removeTool = defineTool({
    name: 'remove_activity',
    label: '删除活动',
    description: '删除某天第 N 个活动。',
    parameters: Type.Object({
      dayIndex: Type.Integer({ description: '第几天（从 1 开始）' }),
      position: Type.Integer({ description: '该天第几个活动（从 1 开始）' }),
    }),
    execute: async (_id, params) => ({
      content: text(draft.removeActivity(params.dayIndex, params.position)),
      details: params,
    }),
  });

  const getTool = defineTool({
    name: 'get_draft',
    label: '查看草稿',
    description: '查看当前行程草稿的紧凑全貌（含每个活动的位置编号）。',
    parameters: Type.Object({}),
    execute: async () => ({ content: text(draft.render()), details: {} }),
  });

  // 住宿锚点（ST3）：用户未填住宿时由规划 Agent 建议一个区域（禁止具体酒店/价格，见 planner prompt）
  const lodgingTool = defineTool({
    name: 'set_lodging',
    label: '建议住宿区域',
    description: '记录建议的住宿区域（如「西湖景区周边」）。仅在用户未指定住宿位置时需要调用；禁止推荐具体酒店或价格。',
    parameters: Type.Object({
      name: Type.String({ description: '住宿区域名称，≤60 字，如「西湖景区周边」' }),
    }),
    execute: async (_id, params) => {
      const msg = draft.setLodging(params.name);
      return { content: text(msg), details: { name: params.name, isError: msg.startsWith('错误') } };
    },
  });

  return [skeletonTool, addTool, updateTool, removeTool, getTool, lodgingTool];
}

/** submit_plan：完整性校验闸门 —— 未通过时把问题清单回给模型自愈 */
export function buildSubmitPlanTool(draft: DraftTrip, onPass: () => void): AgentTool {
  return defineTool({
    name: 'submit_plan',
    label: '提交行程草稿',
    description: '行程填写完毕后提交校验。校验通过则规划阶段结束；未通过会返回问题清单，修正后重新提交。',
    parameters: Type.Object({}),
    execute: async () => {
      const problems = draft.validate();
      if (problems.length) {
        return { content: text(`校验未通过，请修正后重新 submit_plan：\n- ${problems.join('\n- ')}`), details: { pass: false, problems } };
      }
      onPass();
      return { content: text('校验通过，草稿已定稿。'), details: { pass: true }, terminate: true };
    },
  });
}
