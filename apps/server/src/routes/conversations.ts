// 会话路由：会话 CRUD / 发消息（对话理解）/ 确认卡直接改 Brief。
//
// 边界（PRD R1–R4）：对话只做三件事 —— 抽取参数、回答旅行问答、更新 Brief。
// 行程本身仍由 POST /api/generations 产出；对话阶段不消耗生成配额。
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import {
  CONSTRAINT_CATEGORY_LABELS,
  ConversationCreateSchema,
  PlanningBriefPatchSchema,
  SendMessageSchema,
  TRIP_FOCUS_LABELS,
  briefIntake,
  briefIntakeWithOptions,
  briefToGenerateForm,
  requiredBriefFields,
  type EditOpOutcome,
  type PlanningBriefData,
  type SendMessageResult,
  type TripConstraint,
} from '@tripweaver/shared';
import { requireAuth } from '../auth/guard';
import { applyDialogueDecision, briefStatus } from '../chat/brief';
import { applyItineraryEdits, normalizeEditOps } from '../chat/editOps';
import { DialogueUnderstandingError } from '../chat/models';
import { understandMessage } from '../chat/understanding';
import { createJob, getRunningJobId } from '../generation/jobManager';
import { runGeneration } from '../generation/orchestrator';
import { createGeoSession } from '../generation/geoPipeline';
import { hasSiteLlm } from '../env';
import { chatHasQuota, chatUsageView } from '../services/chatQuotaService';
import { cityCoverage } from '../services/cityCoverageService';
import { hasQuota } from '../services/quotaService';
import { createTrip, getTrip, listTripVersions } from '../services/tripService';
import {
  appendMessages,
  createConversation,
  deleteConversation,
  getConversationDetail,
  listConversations,
  saveBrief,
} from '../services/conversationService';
import { resolveLlmConfig } from '../services/settingsService';

const IdParams = Type.Object({ id: Type.String() });

const FIELD_LABELS: Record<string, string> = {
  destination: '目的地',
  startDate: '开始日期',
  endDate: '结束日期',
  days: '天数',
  tripFocus: '旅行侧重点',
  partySize: '出行人数',
  transportMode: '出行方式',
  lodging: '住宿位置',
  extraNotes: '补充要求',
};

function renderValue(key: string, data: PlanningBriefData): string {
  if (key === 'tripFocus') return data.tripFocus ? TRIP_FOCUS_LABELS[data.tripFocus] : '';
  if (key === 'days') return data.days ? `${data.days} 天` : '';
  if (key === 'partySize') return data.partySize ? `${data.partySize} 人` : '';
  const value = data[key as keyof PlanningBriefData];
  return typeof value === 'string' ? value : '';
}

/**
 * 把确认卡上的编辑转成一句话，作为这轮的「用户消息」落库 ——
 * 让对话历史仍然读得懂，也让下一轮理解能看到刚刚改了什么。
 */
function describeBriefChanges(before: PlanningBriefData, after: PlanningBriefData): string[] {
  const changes: string[] = [];
  for (const key of Object.keys(FIELD_LABELS)) {
    const next = renderValue(key, after);
    if (!next || next === renderValue(key, before)) continue;
    changes.push(`${FIELD_LABELS[key]}改为「${next}」`);
  }
  const beforeIds = new Set(before.constraints.map((c: TripConstraint) => c.id));
  const afterIds = new Set(after.constraints.map((c: TripConstraint) => c.id));
  for (const c of after.constraints) {
    if (!beforeIds.has(c.id)) changes.push(`新增${CONSTRAINT_CATEGORY_LABELS[c.category]}要求「${c.valueText}」`);
  }
  for (const c of before.constraints) {
    if (!afterIds.has(c.id)) changes.push(`取消${CONSTRAINT_CATEGORY_LABELS[c.category]}要求「${c.valueText}」`);
  }
  return changes;
}

export const conversationRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/', async (request) => ({
    conversations: await listConversations(request.user!.id),
    chatUsage: await chatUsageView(request.user!.id),
  }));

  app.post('/', { schema: { body: ConversationCreateSchema } }, async (request, reply) => {
    const conversation = await createConversation(request.user!.id, request.body.title);
    return reply.code(201).send(conversation);
  });

  app.get('/:id', { schema: { params: IdParams } }, async (request, reply) => {
    const detail = await getConversationDetail(request.user!.id, request.params.id);
    if (!detail) return reply.code(404).send({ error: '会话不存在' });
    return detail;
  });

  app.delete('/:id', { schema: { params: IdParams } }, async (request, reply) => {
    const ok = await deleteConversation(request.user!.id, request.params.id);
    if (!ok) return reply.code(404).send({ error: '会话不存在' });
    return { ok: true };
  });

  // 发一条消息 → 理解 → 更新 Brief → 一轮消息成批落库
  app.post('/:id/messages', { schema: { params: IdParams, body: SendMessageSchema } }, async (request, reply) => {
    const userId = request.user!.id;
    const conversationId = request.params.id;

    const detail = await getConversationDetail(userId, conversationId);
    if (!detail) return reply.code(404).send({ error: '会话不存在' });

    if (!(await chatHasQuota(userId))) {
      const usage = await chatUsageView(userId);
      return reply
        .code(429)
        .send({ error: '今日对话次数已用完', code: 'chat_quota_exhausted', resetAt: usage.resetAt });
    }
    const cfg = await resolveLlmConfig(userId);
    if (!cfg) {
      return reply.code(400).send({ error: '当前没有可用的 AI 配置', code: 'no_llm', hasSiteKey: hasSiteLlm() });
    }

    const text = request.body.text.trim();
    if (!text) return reply.code(400).send({ error: '消息不能为空' });

    // 修订需要行程完整内容（渲染进 prompt 供模型定位活动 id），不只是 ref
    const currentTrip = detail.latestTrip ? await getTrip(userId, detail.latestTrip.id) : null;

    // 客户端断开时中止 LLM 调用；失败路径不写库、不消耗额度
    const controller = new AbortController();
    request.raw.on('close', () => controller.abort());

    let outcome;
    try {
      outcome = await understandMessage({
        cfg,
        brief: detail.conversation.brief.data,
        history: detail.messages,
        userText: text,
        signal: controller.signal,
        ...(currentTrip ? { currentTrip } : {}),
        logger: request.log,
      });
    } catch (error) {
      if (error instanceof DialogueUnderstandingError) {
        return reply.code(error.statusCode).send({ error: error.message, code: error.code });
      }
      throw error;
    }

    // ---- R1（09-24）：按需修订。模型给编辑操作 → 确定性应用 → 落版本链下一版 ----
    // 不再有 RevisionCard 确认环节（R3：LLM 判定修改意图即直接执行）
    let editResult: { tripId: string; version: number; outcomes: EditOpOutcome[] } | undefined;
    if (outcome.intent === 'modify_itinerary' && outcome.editOps && detail.latestTrip && currentTrip) {
      const ops = normalizeEditOps(outcome.editOps);
      // 新增/替换的活动需要坐标：走与生成链路相同的解析链（高德→Nominatim 降级），失败保持 estimated
      const needsGeocode = ops.filter((op) => op.activity);
      if (needsGeocode.length > 0) {
        const geo = createGeoSession(userId, currentTrip.destination, currentTrip.transportMode ?? 'transit');
        await geo.init();
        for (const op of needsGeocode) {
          if (controller.signal.aborted) break;
          const place = await geo.resolvePlace(op.activity!.name);
          if (place) {
            op.activity!.lat = place.lat;
            op.activity!.lng = place.lng;
          }
        }
      }
      const applied = applyItineraryEdits(currentTrip, ops);
      if (applied.changed) {
        const saved = await createTrip(userId, applied.trip, detail.latestTrip.id);
        const versionRow = await listTripVersions(userId, saved.id);
        editResult = {
          tripId: saved.id,
          version: versionRow?.versions.find((v) => v.id === saved.id)?.version ?? detail.latestTrip.version + 1,
          outcomes: applied.outcomes,
        };
      } else {
        // 全部拒绝：不落版本，outcomes 里的原因直接回给用户
        editResult = { tripId: detail.latestTrip.id, version: detail.latestTrip.version, outcomes: applied.outcomes };
      }
    }

    const evidenceSequence = (detail.messages.at(-1)?.sequence ?? 0) + 1;
    const nextData = applyDialogueDecision(detail.conversation.brief.data, outcome.decision, evidenceSequence);

    // R2（09-25 未覆盖城市诚实降级）：目的地新出现或变更时查一次知识库覆盖，
    // 未覆盖则在回复尾部拼提示——不编造覆盖能力，也不过滤目的地（白名单方案已否决）。
    // 提示只拼进本轮回复文本，不落库为独立消息（避免消息对计数错位）。
    const destinationChanged =
      Boolean(nextData.destination?.trim()) && nextData.destination !== detail.conversation.brief.data.destination;
    let coverageHint = '';
    if (destinationChanged && (await cityCoverage(nextData.destination!)) === 'uncovered') {
      coverageHint = `另外说明一下：${nextData.destination}的攻略数据我掌握得比较少，生成时会更多参考实时搜索的结果，建议到手后多核对一下。`;
    }
    const missingFields = requiredBriefFields(nextData);
    // 优先用模型给的可点选项（它更懂上下文）；没给就用服务端模板 —— 一次只问一项
    const options = outcome.clarification?.options ?? [];
    const intake =
      missingFields.length === 0
        ? undefined
        : outcome.clarification && options.length > 0
          ? briefIntakeWithOptions(missingFields, outcome.clarification.question, options)
          : briefIntake(missingFields);

    // 修订结果拼进回复尾部：对话历史脱离 editResult 也能读懂「改了什么」；
    // relatedTripId 指向新版本，前端据此给「查看行程」入口
    const editSummary = editResult
      ? editResult.outcomes.map((o) => o.summary).join('；')
      : '';
    const replyContent = [
      editSummary ? `${outcome.reply}（${editSummary}）` : outcome.reply,
      coverageHint,
    ].filter(Boolean).join(' ');

    const appended = await appendMessages({
      userId,
      conversationId,
      messages: [
        { role: 'user', content: text },
        {
          role: 'assistant',
          content: replyContent,
          ...(intake ? { intake } : {}),
          ...(editResult && editResult.version > (detail.latestTrip?.version ?? 0)
            ? { relatedTripId: editResult.tripId }
            : {}),
        },
      ],
    });
    if (!appended) return reply.code(404).send({ error: '会话不存在' });

    const brief = await saveBrief(userId, conversationId, nextData, briefStatus(nextData, detail.conversation.brief.status));
    if (!brief) return reply.code(404).send({ error: '会话不存在' });

    const [userMessage, replyMessage] = appended;
    if (!userMessage || !replyMessage) throw new Error('消息写入后数量异常');

    // ---- R3（09-24）：LLM 判信息齐备（intent=confirm 且 Brief ready）即自动触发生成 ----
    // 无确认环节、无缓冲；误判白扣额度的风险由用户接受（PRD 已拍板）。
    // 静默降级：额度尽 / 有任务在跑时不触发，前端确认卡仍可手动发起（行为回退到旧路径）。
    let autoStartedJobId: string | undefined;
    if (outcome.intent === 'confirm' && missingFields.length === 0 && !editResult) {
      const canStart = (await hasQuota(userId)) && !getRunningJobId(userId);
      if (canStart) {
        const job = createJob(userId, { conversationId, kind: 'generation' });
        runGeneration(job, briefToGenerateForm(nextData), cfg, app.log).catch((err) =>
          app.log.error(err, 'runGeneration 未捕获异常'),
        );
        autoStartedJobId = job.id;
      }
    }

    const result: SendMessageResult = {
      userMessage,
      replyMessage,
      brief,
      intent: outcome.intent,
      ...(autoStartedJobId ? { autoStartedJobId } : {}),
      ...(editResult ? { editResult } : {}),
    };
    return result;
  });

  // 确认卡上的字段编辑：与对话理解走同一个归一函数，id / 来源序号由服务端补
  app.patch('/:id/brief', { schema: { params: IdParams, body: PlanningBriefPatchSchema } }, async (request, reply) => {
    const userId = request.user!.id;
    const detail = await getConversationDetail(userId, request.params.id);
    if (!detail) return reply.code(404).send({ error: '会话不存在' });

    const before = detail.conversation.brief.data;
    const evidenceSequence = (detail.messages.at(-1)?.sequence ?? 0) + 1;
    const nextData = applyDialogueDecision(before, request.body, evidenceSequence);
    const changes = describeBriefChanges(before, nextData);
    const missingFields = requiredBriefFields(nextData);
    const intake = missingFields.length > 0 ? briefIntake(missingFields) : undefined;

    const lead = changes.length > 0 ? `已更新：${changes.join('；')}。` : '这轮没有需要改动的内容。';
    const tail = missingFields.length > 0 ? '还差几项，补齐后就能开始生成了。' : '信息齐了，可以开始生成。';

    const appended = await appendMessages({
      userId,
      conversationId: request.params.id,
      messages: [
        { role: 'user', content: changes.length > 0 ? changes.join('；') : '（确认卡上做了编辑）' },
        { role: 'assistant', content: `${lead}${tail}`, ...(intake ? { intake } : {}) },
      ],
    });
    if (!appended) return reply.code(404).send({ error: '会话不存在' });

    const brief = await saveBrief(userId, request.params.id, nextData, briefStatus(nextData, detail.conversation.brief.status));
    if (!brief) return reply.code(404).send({ error: '会话不存在' });

    const [userMessage, replyMessage] = appended;
    if (!userMessage || !replyMessage) throw new Error('消息写入后数量异常');
    // 确认卡编辑不是模型判断，intent 固定 update_brief（避免前端据此误触发自动生成）
    const result: SendMessageResult = { userMessage, replyMessage, brief, intent: 'update_brief' };
    return result;
  });
};
