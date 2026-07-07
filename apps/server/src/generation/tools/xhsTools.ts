// 调研 Agent 工具组：小红书搜索/精读 + 摘要提交（映射见架构 §12.1）
// 工具返回一律为紧凑文本 —— 结构化数据经 DraftTrip/闭包持有，不靠模型转述（R8）
import { Type } from 'typebox';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import { defineTool } from './defineTool';
import type { ContentSource } from '../../integrations/xhs/contentSource';

function text(t: string) {
  return [{ type: 'text' as const, text: t }];
}

export interface ResearchOutcome {
  summary: string;
}

export function buildXhsTools(source: ContentSource, outcome: ResearchOutcome): AgentTool[] {
  const searchTool = defineTool({
    name: 'search_xhs_notes',
    label: '搜索小红书笔记',
    description: '按关键词搜索小红书旅行笔记，返回笔记清单（编号/标题/点赞/摘要/引用凭据）。',
    parameters: Type.Object({
      keyword: Type.String({ description: '搜索关键词，如「东京 攻略」' }),
    }),
    execute: async (_id, params) => {
      const notes = await source.search(params.keyword);
      if (!notes.length) {
        return { content: text('没有找到相关笔记（数据源可能不可用或已达调用上限）。请换个关键词，或基于你自己的知识继续。'), details: { count: 0 } };
      }
      const lines = notes.map(
        (n, i) => `${i + 1}. ${n.title}｜赞 ${n.likes}｜id=${n.id}｜token=${n.xsecToken}｜url=${n.url}${n.snippet ? `｜${n.snippet}` : ''}`,
      );
      return { content: text(lines.join('\n')), details: { count: notes.length, keyword: params.keyword } };
    },
  });

  const detailTool = defineTool({
    name: 'get_xhs_note_detail',
    label: '精读笔记详情',
    description: '获取一篇小红书笔记的正文与热评。id 与 token 必须来自 search_xhs_notes 的返回。',
    parameters: Type.Object({
      id: Type.String({ description: '笔记 id' }),
      token: Type.String({ description: '笔记对应的 token（xsec_token）' }),
    }),
    execute: async (_id, params) => {
      const detail = await source.getDetail(params.id, params.token);
      if (!detail) {
        return { content: text('这篇笔记读取失败（可能已删除、数据源不可用或已达调用上限），请换一篇或继续。'), details: { ok: false } };
      }
      const comments = detail.topComments.length ? `\n热评：${detail.topComments.join('｜')}` : '';
      return {
        content: text(`《${detail.title}》作者 ${detail.authorName}｜赞 ${detail.likes}｜url=${detail.url}\n${detail.content}${comments}`),
        details: { ok: true, id: detail.id },
      };
    },
  });

  const submitTool = defineTool({
    name: 'submit_research',
    label: '提交调研摘要',
    description: '提交最终调研摘要（500 字以内），提交后调研阶段结束。',
    parameters: Type.Object({
      summary: Type.String({ description: '调研摘要正文，含推荐清单、路线建议、避雷点与来源链接' }),
    }),
    execute: async (_id, params) => {
      outcome.summary = params.summary.slice(0, 2000);
      return { content: text('调研摘要已收到。'), details: { length: outcome.summary.length }, terminate: true };
    },
  });

  return [searchTool, detailTool, submitTool];
}
