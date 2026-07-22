// 调研 Agent 工具组：高德地点搜索 + Web 攻略搜索 + 候选池写入 + 摘要提交
// 工具返回一律为紧凑文本 —— 结构化候选经闭包（outcome.pool）持有，不靠模型转述（R8）
import { Type } from 'typebox';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import {
  MAX_OVERVIEW_POIS,
  MAX_SOURCE_NOTES,
  POI_CATEGORIES,
  RESERVATION_STATUSES,
  uid,
  type PoiCategory,
  type ResearchPoi,
} from '@tripweaver/shared';
import { defineTool } from './defineTool';
import type { PoiSource } from '../../integrations/amap/poiSource';
import type { SearchSource } from '../../integrations/websearch/searchSource';
import { matchReservationSeed } from '../../data/reservationSeeds';

function text(t: string) {
  return [{ type: 'text' as const, text: t }];
}

const CATEGORY_LABEL: Record<PoiCategory, string> = { attraction: '景点', food: '美食', hotel: '住宿' };

export interface ResearchOutcome {
  summary: string;
  pool: ResearchPoi[];
  /** 坐标旁路（层2 距离预计算用）：search_pois 命中的 name → GCJ-02 坐标。
   *  仅任务内存短暂持有，不入候选池 schema、不随行程持久化（高德协议 3.5：仅存活动坐标点值） */
  locations: Map<string, { lat: number; lng: number }>;
}

export interface ResearchToolDeps {
  poiSource: PoiSource;
  searchSource: SearchSource;
  destination: string;
  outcome: ResearchOutcome;
  /** 每写入一条候选即回调（orchestrator 借此发 SSE candidate 事件） */
  onCandidate?: (poi: ResearchPoi) => void;
}

function isHttpUrl(u: string): boolean {
  return /^https?:\/\//.test(u);
}

export function buildResearchTools(deps: ResearchToolDeps): AgentTool[] {
  const { poiSource, searchSource, destination, outcome, onCandidate } = deps;

  const poisTool = defineTool({
    name: 'search_pois',
    label: '搜索地点',
    description: '按类目搜索目的地的真实地点（高德数据），返回名称、类型、地址与图片；餐饮动态价格、评分和营业信息不作为行程事实。',
    parameters: Type.Object({
      category: Type.String({ description: '类目：attraction（景点）/ food（美食）/ hotel（住宿）' }),
      keyword: Type.String({ description: '搜索关键词，如「必去景点」「本地菜」「市中心酒店」，不必带目的地名' }),
    }),
    execute: async (_id, params) => {
      const category = params.category.trim() as PoiCategory;
      if (!(POI_CATEGORIES as readonly string[]).includes(category)) {
        return { content: text('错误：category 必须是 attraction / food / hotel 之一。'), details: { ok: false } };
      }
      const pois = await poiSource.searchPois(category, params.keyword, destination);
      if (!pois.length) {
        return {
          content: text('没有找到相关地点（高德数据源不可用、已达调用上限或无结果）。可换个关键词，或基于你自己的知识直接 add_candidate（coverUrl 留空）。'),
          details: { count: 0 },
        };
      }
      // 坐标旁路捕获（层2 距离预计算用）：搜索结果已如实带回 GCJ-02 坐标，零额外调用；
      // 后续 add_candidate 的候选按同名关联（模型改写名称导致失配时仅漏标，由层3 兜底）
      for (const p of pois) {
        if (p.location) outcome.locations.set(p.name, p.location);
      }
      const lines = pois.map((p, i) => {
        const bits = [
          `${i + 1}. ${p.name}`,
          p.type,
          p.address,
          category !== 'food' && p.rating ? `评分 ${p.rating}` : '',
          category !== 'food' && p.opentime ? `营业 ${p.opentime}` : '',
          p.photoUrls[0] ? `图片=${p.photoUrls[0]}` : '',
        ];
        return bits.filter(Boolean).join('｜');
      });
      return { content: text(lines.join('\n')), details: { count: pois.length, category, keyword: params.keyword } };
    },
  });

  const webTool = defineTool({
    name: 'search_web',
    label: '搜索攻略',
    description: '全网搜索旅行攻略、玩法、避雷与预约政策，返回标题/摘要/来源链接。',
    parameters: Type.Object({
      query: Type.String({ description: '搜索词，如「故宫 门票 预约」「XX市 三日游 避雷」' }),
    }),
    execute: async (_id, params) => {
      const hits = await searchSource.search(params.query);
      if (!hits.length) {
        return {
          content: text('没有搜到相关内容（搜索数据源不可用、已达调用上限或无结果）。可换个说法，或基于你自己的知识继续。'),
          details: { count: 0 },
        };
      }
      const lines = hits.map(
        (h, i) =>
          `${i + 1}. ${h.title}${h.siteName ? `｜${h.siteName}` : ''}${h.datePublished ? `｜${h.datePublished}` : ''}\n   ${h.summary}\n   url=${h.url}`,
      );
      return { content: text(lines.join('\n')), details: { count: hits.length, query: params.query } };
    },
  });

  const addTool = defineTool({
    name: 'add_candidate',
    label: '写入候选池',
    description: '把一个筛选后的地点写入行程候选池（前端展示为概览卡片）。同名地点会被去重。',
    parameters: Type.Object({
      name: Type.String({ description: '地点名称（与 search_pois 返回一致）' }),
      category: Type.String({ description: '类目：attraction / food / hotel' }),
      intro: Type.String({ description: '一句话简介（≤120 字）：是什么 + 为什么值得去' }),
      coverUrl: Type.Optional(Type.String({ description: '预览图链接，只能用 search_pois 返回的图片 url，没有则不填' })),
      reservation: Type.Optional(
        Type.String({ description: '是否需要预约：required / none / unknown（默认 unknown；仅在有官方或权威来源时才填 required/none）' }),
      ),
      reservationNote: Type.Optional(Type.String({ description: '预约方式说明（≤120 字，如「官方小程序提前 7 天实名预约」）' })),
      sourceLinks: Type.Optional(
        Type.Array(Type.Object({ title: Type.String(), url: Type.String() }), {
          description: '来源链接 ≤3 条，只能用工具返回中出现过的 url',
        }),
      ),
    }),
    execute: async (_id, params) => {
      const name = params.name.trim().slice(0, 100);
      if (!name) return { content: text('错误：地点名称不能为空。'), details: { ok: false } };
      const category = params.category.trim() as PoiCategory;
      if (!(POI_CATEGORIES as readonly string[]).includes(category)) {
        return { content: text('错误：category 必须是 attraction / food / hotel 之一。'), details: { ok: false } };
      }
      if (outcome.pool.length >= MAX_OVERVIEW_POIS) {
        return { content: text(`候选池已满（${MAX_OVERVIEW_POIS} 条），请停止添加，调用 submit_research 收尾。`), details: { ok: false } };
      }
      const dup = outcome.pool.find((p) => p.name === name);
      if (dup) {
        return { content: text(`「${name}」已在候选池中（${CATEGORY_LABEL[dup.category]}类），无需重复添加。`), details: { ok: false } };
      }

      const reservation = (RESERVATION_STATUSES as readonly string[]).includes(params.reservation ?? '')
        ? (params.reservation as ResearchPoi['reservation'])
        : 'unknown';
      const coverUrl = (params.coverUrl ?? '').trim().slice(0, 300);
      const sourceLinks = (params.sourceLinks ?? [])
        .map((s) => ({ title: (s.title ?? '').trim().slice(0, 100), url: (s.url ?? '').trim().slice(0, 300) }))
        .filter((s) => s.title && isHttpUrl(s.url));

      const poi: ResearchPoi = {
        id: uid(),
        name,
        category,
        intro: params.intro.trim().slice(0, 200),
        reservation,
        sourceLinks,
      };
      if (isHttpUrl(coverUrl)) poi.coverUrl = coverUrl;
      if (params.reservationNote?.trim()) poi.reservationNote = params.reservationNote.trim().slice(0, 120);

      // 预约种子表命中即置信：强制覆盖三态与说明，并把官方渠道链接放到来源首位
      const seed = category === 'attraction' ? matchReservationSeed(name) : null;
      if (seed) {
        poi.reservation = 'required';
        poi.reservationNote = seed.note.slice(0, 120);
        poi.sourceLinks = [
          { title: `${seed.name}（官方渠道）`, url: seed.sourceUrl },
          ...poi.sourceLinks.filter((s) => s.url !== seed.sourceUrl),
        ];
      }
      poi.sourceLinks = poi.sourceLinks.slice(0, MAX_SOURCE_NOTES);

      outcome.pool.push(poi);
      onCandidate?.(poi);
      const nthOfCategory = outcome.pool.filter((p) => p.category === category).length;
      return {
        content: text(
          `已加入候选池（${CATEGORY_LABEL[category]}类第 ${nthOfCategory} 个）：${name}${seed ? '（命中预约种子表，已标注需预约）' : ''}`,
        ),
        details: { ok: true, id: poi.id, category, seedHit: Boolean(seed) },
      };
    },
  });

  const submitTool = defineTool({
    name: 'submit_research',
    label: '提交调研摘要',
    description: '提交最终调研摘要（500 字以内），提交后调研阶段结束。',
    parameters: Type.Object({
      summary: Type.String({ description: '调研摘要正文：路线节奏建议、整体避雷提示与数据来源情况' }),
    }),
    execute: async (_id, params) => {
      outcome.summary = params.summary.slice(0, 2000);
      return {
        content: text(`调研摘要已收到（候选池共 ${outcome.pool.length} 条）。`),
        details: { length: outcome.summary.length, poolSize: outcome.pool.length },
        terminate: true,
      };
    },
  });

  return [poisTool, webTool, addTool, submitTool];
}
