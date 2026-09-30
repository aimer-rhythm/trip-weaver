// 生成主流程：调研 → 确定性排程 → 地理增强与标题文案 → 原子落库。
// 唯一入口 runGeneration —— 路由只见任务号与 SSE，Agent 细节全部封装在此（架构 §2 单入口隔离）
import {
  feasibilityReviewNotes,
  GENERATION_TIMEOUT_MINUTES,
  type DataSourceKind,
  type GenerateForm,
  type GenerationJobStatus,
  type GenerationPhase,
} from '@tripweaver/shared';
import type { FastifyBaseLogger } from 'fastify';
import { env } from '../env';
import { db } from '../db/client';
import { generations } from '../db/schema';
import { uid } from '@tripweaver/shared';
import type { LlmConfig } from '../services/settingsService';
import { resolveAmapCredential } from '../services/settingsService';
import { searchBudgetRemaining } from '../services/quotaService';
import { createTrip } from '../services/tripService';
import { poiBudgetRemaining, resolvePoiSourceForUser } from '../integrations/geoProvider';
import { getNullPoiSource } from '../integrations/nullPoiSource';
import { POI_MAX_PER_TASK, createTaskPoiSource } from '../integrations/poiTaskSource';
import {
  SEARCH_MAX_PER_TASK,
  createTaskSearchSource,
  getNullSearchSource,
  resolveSearchSourceForUser,
} from '../integrations/websearch/searchSource';
import { DraftTrip } from './draft';
import { createGeoSession } from './geoPipeline';
import { classifyLongHaulPois, type LongHaulPoi } from './longHaul';
import { repairLongHaulMixedDays, verifiedFixNotes, type AppliedFixMove } from './longHaulFixer';
import { isFoodFocused } from './mealPlanning';
import { optimizeCrossDayGrouping } from './routeCoherence';
import { buildModel } from './model';
import { emit, completeJob, failJob, cancelJob, type Job } from './jobManager';
import { runPhaseAgent, type PhaseEventSink } from './agents/runner';
import { GenerationPerformance } from './performance';
import { createLlmRequestRecorder } from './llmRequestLog';
import { buildResearchTools, type ResearchOutcome } from './tools/researchTools';
import { createWikiCoverLookup } from '../integrations/wikimedia/cover';
import { createPexelsCoverLookup } from '../integrations/pexels/cover';
import { createUnsplashCoverLookup } from '../integrations/unsplash/cover';
import { createPixabayCoverLookup } from '../integrations/pixabay/cover';
import { createAmapPoiPhotoLookup } from '../integrations/amap/poiPhotos';
import { createStoredPlaceLookups } from './storedCover';
import { createCuratedCoverLookup } from '../integrations/curatedPhotos';
import { loadPlaceFacts, saveAmapPhoto } from './scheduling/placeFacts';
import { loadPlaceRelations } from './scheduling/placeRelations';

import { buildDraftTools } from './tools/draftTools';
import { buildReviewTools, type ReviewOutcome } from './tools/reviewTools';
import { applyDeterministicSchedule } from './scheduling/buildDraft';
import {
  WRITER_SYSTEM_PROMPT,
  researchSystemPrompt,
  formBrief,
  writerUserPrompt,
} from './prompts';
import { cityCoverage, searchWebMaxFor } from '../services/cityCoverageService';

const JOB_TIMEOUT_MS = GENERATION_TIMEOUT_MINUTES * 60 * 1000;   // 整任务兜底超时（与前端提示文案同源）

class GenerationFailure extends Error {}

/** 调研阶段降级说明：数据源缺失/超额不阻断生成，仅在时间线上明示 */
function researchNote(sources: DataSourceKind[]): string | undefined {
  if (sources.length === 2) return undefined;
  const only = sources[0];
  if (only === undefined) return '地点数据源与全网搜索均不可用，本次基于模型知识调研';
  return only === 'websearch'
    ? '地点数据源不可用，本次基于全网搜索 + 模型知识调研'
    : `全网搜索不可用，本次基于${only === 'tianditu' ? '天地图' : '高德'}地点数据 + 模型知识调研`;
}

export async function runGeneration(
  job: Job,
  form: GenerateForm,
  cfg: LlmConfig,
  logger?: Pick<FastifyBaseLogger, 'info' | 'error'>,
): Promise<void> {
  const signal = job.abort.signal;
  const usage = { tokensIn: 0, tokensOut: 0 };
  // 餐次/餐宿要求的开关（09-21 D3/D6）：只在偏好含「美食」时强制午晚餐与餐次兜底
  const foodFocused = isFoodFocused(form.preferences);
  const timing = new GenerationPerformance(job.createdAt);
  let terminalStatus: GenerationJobStatus = 'error';
  let systemTaskSeq = 0;
  const timeout = setTimeout(() => {
    if (signal.aborted) return;
    job.cancelReason = 'timeout';   // 超时自动取消：事件携带 reason，前端区分展示
    job.abort.abort();
  }, JOB_TIMEOUT_MS);
  timeout.unref?.();

  // 先建立零调用统计，让初始化失败也能发布终态、记账和清理计时器。
  let poi = createTaskPoiSource(getNullPoiSource());
  let search = createTaskSearchSource(getNullSearchSource());
  // 地理会话（v0.5）：geocode/route 统一服务商与凭据解析、任务上限与日额度记账；出行方式基调来自表单（ST3）
  const geo = createGeoSession(job.userId, form.destination, form.transportMode ?? 'transit');
  // 封面第三级（09-27）：高德 POI 图片。凭据与地理链同一份解析（个人 Key 优先、站点兜底），
  // 但调用量单独计数 —— 它走的是 v5/place/text 的「基础搜索服务」配额（个人 5,000/月），比地理编码稀缺得多。
  let amapPoiPhotos = createAmapPoiPhotoLookup('');
  // 地理调用按链分流计入各自用量列：POI 搜索固定天地图，路线 + 地理编码走另一条（高德优先）。
  // 两条链各自独立计数，不再靠单一开关二选一（高德缺 Key 时地理链自己降级到天地图，也要如实记到天地图列）。
  // 返回值必须现算 —— poi/geo 的统计在生成过程中持续增长。
  const providerCallCounts = () => {
    const geoCalls = geo.stats.calls;
    const geoTianditu = geo.providerKind() === 'tianditu';
    return {
      amapCalls: (geoTianditu ? 0 : geoCalls) + amapPoiPhotos.calls,
      tiandituCalls: poi.stats.calls + (geoTianditu ? geoCalls : 0),
    };
  };

  const sinkFor = (phase: GenerationPhase): PhaseEventSink => ({
    onThought: (text) => emit(job, { type: 'thought', phase, text }),
    onToolStart: (toolCallId, tool, label, args) => {
      const at = timing.startTask(toolCallId, tool);
      emit(job, { type: 'tool_start', phase, toolCallId, tool, label, args: JSON.stringify(args ?? {}).slice(0, 200), at });
    },
    onToolEnd: (toolCallId, tool, label, summary, isError) => {
      const ended = timing.endTask(toolCallId);
      emit(job, { type: 'tool_end', phase, toolCallId, tool, label, summary, isError, ...ended });
    },
    onUsage: (tokensIn, tokensOut) =>
      emit(job, {
        type: 'usage',
        tokensIn: usage.tokensIn + tokensIn,
        tokensOut: usage.tokensOut + tokensOut,
        xhsCalls: 0,   // 旧前端兼容字段（小红书已移除）
        ...providerCallCounts(),
        searchCalls: search.stats.calls,
      }),
    // LLM 请求上下文快照（09-20 调试视图）：实时推给时间线，与落库互不影响
    onLlmRequest: (info) => emit(job, { type: 'llm_request', phase, ...info }),
    onLlmResponse: (info) =>
      emit(job, {
        type: 'llm_response',
        phase,
        turn: info.turn,
        stopReason: info.stopReason,
        tokensIn: info.usage?.input,
        tokensOut: info.usage?.output,
        errorMessage: info.errorMessage,
      }),
  });

  const startPhase = (phase: GenerationPhase, round: number, note?: string) => {
    const at = timing.startPhase(phase, round);
    emit(job, { type: 'phase_start', phase, round, note, at });
  };
  const endPhase = (phase: GenerationPhase, round: number, summary?: string) => {
    const ended = timing.endPhase(phase, round);
    emit(job, { type: 'phase_end', phase, round, summary, ...ended });
  };
  const runSystemTask = async <T>(
    phase: GenerationPhase,
    tool: string,
    label: string,
    action: () => Promise<T> | T,
    summary = '完成',
  ): Promise<T> => {
    const toolCallId = `system:${++systemTaskSeq}:${tool}`;
    const at = timing.startTask(toolCallId, tool);
    emit(job, { type: 'tool_start', phase, toolCallId, tool, label, args: '{}', at });
    try {
      const result = await action();
      const ended = timing.endTask(toolCallId);
      emit(job, { type: 'tool_end', phase, toolCallId, tool, label, summary, isError: false, ...ended });
      return result;
    } catch (error) {
      const ended = timing.endTask(toolCallId);
      emit(job, { type: 'tool_end', phase, toolCallId, tool, label, summary: '已降级', isError: true, ...ended });
      throw error;
    }
  };

  const record = async (status: 'done' | 'error' | 'cancelled', tripId: string | null, writer: Pick<typeof db, 'insert'> = db) => {
    await writer.insert(generations)
      .values({
        id: uid(),
        userId: job.userId,
        tripId,
        conversationId: job.provenance.conversationId ?? null,
        kind: job.provenance.kind,
        targetTripId: job.provenance.targetTripId ?? null,
        status,
        usedXhs: false,   // 列保留供旧数据读取；新生成恒 false
        usedByok: cfg.byok,
        tokensIn: usage.tokensIn,
        tokensOut: usage.tokensOut,
        ...providerCallCounts(),
        searchCalls: search.stats.calls,
        createdAt: new Date(),
      });
  };

  try {
    assertAlive(signal);
    // 两条安全校验尽早并行，拒绝也立即被观察，避免初始化提前退出后的游离 rejection。
    const modelPromise = buildModel(cfg).then(
      (model) => ({ ok: true as const, model }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    const poiSource = resolvePoiSourceForUser();
    const poiBase = (await poiBudgetRemaining()) >= POI_MAX_PER_TASK ? poiSource.source : getNullPoiSource();
    assertAlive(signal);
    poi = createTaskPoiSource(poiBase);
    const searchBase = (await searchBudgetRemaining()) >= SEARCH_MAX_PER_TASK
      ? (await resolveSearchSourceForUser(job.userId)).source
      : getNullSearchSource();
    assertAlive(signal);
    search = createTaskSearchSource(searchBase);
    await geo.init();
    assertAlive(signal);
    const amapPhotoCredential = await resolveAmapCredential(job.userId);
    assertAlive(signal);
    amapPoiPhotos = createAmapPoiPhotoLookup(amapPhotoCredential?.apiKey ?? '');
    const enabledSources: DataSourceKind[] = [
      ...(poi.source.kind === 'null' ? [] : ([poi.source.kind] as const)),
      ...(search.source.kind === 'websearch' ? (['websearch'] as const) : []),
    ];
    // xhsEnabled 为旧前端兼容字段，现语义 =「有任一外部调研数据源可用」
    emit(job, {
      type: 'job_start',
      destination: form.destination,
      days: form.days,
      xhsEnabled: enabledSources.length > 0,
      dataSources: enabledSources,
      at: job.createdAt,
    });
    const modelResult = await modelPromise;
    assertAlive(signal);
    if (!modelResult.ok) throw modelResult.error;
    const { model } = modelResult;   // BYOK：使用时二次 ssrfGuard，失败即 job_error

    // ---------- 阶段 1：调研 ----------
    startPhase('research', 1, researchNote(enabledSources));
    // R3（09-25）：未覆盖城市放宽 search_web 上限（2→6），SEARCH_DAILY_BUDGET 日预算闸门不受影响
    const searchWebMax = searchWebMaxFor(await cityCoverage(form.destination));
    const research: ResearchOutcome = { summary: '', pool: [], locations: new Map() };
    const storedPlaces = createStoredPlaceLookups(form.destination);
    const researchRun = await runPhaseAgent({
      model,
      apiKey: cfg.apiKey,
      systemPrompt: researchSystemPrompt({ searchWebMax, pace: form.pace, foodSearch: foodFocused }),
      tools: buildResearchTools({
        poiSource: poi.source,
        searchSource: search.source,
        destination: form.destination,
        searchWebMax,
        outcome: research,
        onCandidate: (candidate) => emit(job, { type: 'candidate', poi: candidate }),
        coverLookup: createWikiCoverLookup(),
        pexelsCover: createPexelsCoverLookup(env.pexelsApiKey),
        unsplashCover: createUnsplashCoverLookup(env.unsplashAccessKey),
        pixabayCover: createPixabayCoverLookup(env.pixabayApiKey),
        amapPhotos: amapPoiPhotos,
        storedCover: storedPlaces.coverFor,
        curatedCover: createCuratedCoverLookup(form.destination, { mediaBase: env.mediaBaseUrl }),
        // 高德命中后回写 payload.amapPhoto：同一地点终身只花一次搜索配额（fire-and-forget，失败不阻断）
        storedAmapPhoto: storedPlaces.amapPhotoFor,
        saveAmapPhoto: (name, url) => {
          void saveAmapPhoto(form.destination, name, url);
        },
        storedPoint: storedPlaces.pointFor,
      }),
      userPrompt: `${formBrief(form)}\n\n请开始调研。`,
      signal,
      sink: sinkFor('research'),
      maxTurns: 16,
      recorder: createLlmRequestRecorder({ jobId: job.id, userId: job.userId, phase: 'research', round: 1 }),
    });
    usage.tokensIn += researchRun.tokensIn;
    usage.tokensOut += researchRun.tokensOut;
    assertAlive(signal, researchRun.errorMessage);
    endPhase('research', 1, `候选 ${research.pool.length} 个｜${research.summary.slice(0, 160)}`);
    geo.useResearchPlaces(research.pool, research.locations);

    // 层2 编排预防：候选池距离预计算（确定性、零外呼）——远郊长途点按通勤时长标级。
    // 坐标来源（09-23）：调研旁路捕获优先，知识库坐标兜底——知识库来源候选（search_verified_places）
    // 不经 search_pois，旁路没有它的坐标，不兜底会被跳过标级（实测：八达岭因此与慕田峪同时入选市区天）。
    // placeFacts 前移到此处：标级与排程复用同一份事实，不重复查询。
    const placeFacts = await loadPlaceFacts(research.pool.map((poi) => poi.name), form.destination);
    // POI 关联对（09-27）：与 placeFacts 同处加载，失败静默为空集合（排程按无关联降级）
    const placeRelations = await loadPlaceRelations(form.destination);
    const kbCoords = new Map<string, { lat: number; lng: number }>();
    for (const poi of research.pool) {
      if (research.locations.has(poi.name)) continue;
      const facts = placeFacts.get(poi.name);
      if (facts?.lat !== undefined && facts.lng !== undefined) kbCoords.set(poi.name, { lat: facts.lat, lng: facts.lng });
    }
    // 纯函数按理不抛，仍按增强路径防御（生成不失败原则，同 resolveGeoAndSimulate）：意外异常只损失情报、按无标记降级。
    let longHaulIntel: LongHaulPoi[] = [];
    try {
      longHaulIntel = classifyLongHaulPois(research.pool, research.locations, form.transportMode ?? 'transit', kbCoords);
    } catch {
      // 按无情报降级，生成继续
    }

    // ---------- 确定性排程，随后并发运行地理增强与标题文案 ----------
    const draft = new DraftTrip(form);
    let reviewNotes: string[] = [];
    // 记录修复器的实际挪动；后续跨天优化可能再次换天，落库前验证注记仍然成立。
    const autoFixMoves: AppliedFixMove[] = [];

    // 地理解析 + 可行性模拟：后处理属增强路径，意外异常只损失坐标补全/通勤段，不失败整个任务（取消除外）。
    // 每次串行外呼前 geoPipeline 内部已按 signal 逐项中止（07-12 教训：AbortSignal 须逐迭代检查）。
    const resolveGeoAndSimulate = async (sink: PhaseEventSink): Promise<void> => {
      try {
        sink.onThought('正在解析坐标与通勤…');
        await runSystemTask('plan', 'geo_geocode_all', '解析活动坐标', () => geo.geocodeAll(draft, sink.onThought, signal));
        assertAlive(signal);
        await runSystemTask('plan', 'geo_compute_legs', '估算通勤路线', () => geo.computeLegs(draft, sink.onThought, signal));
        assertAlive(signal);
      } catch (err) {
        if (signal.aborted) throw err;
      }
      await runSystemTask('plan', 'simulate_feasibility', '检查时空可行性', () => draft.feasibility());
    };

    // ---------- 阶段 2：确定性排程（零 LLM） ----------
    // 入选点、分天与顺序由知识库和空间算法决定，不产出具体起止时刻。
    // 排程是结构唯一来源 —— 排不出来就没有行程可言，不做「降级继续」。
    startPhase('plan', 1, '确定性排程');
    const scheduleOutcome = await runSystemTask('plan', 'schedule_itinerary', '排定每日行程', () =>
      applyDeterministicSchedule({
        draft,
        form,
        pool: research.pool,
        locations: research.locations,
        longHaul: longHaulIntel,
        foodFocused,
        facts: placeFacts,
        relations: placeRelations,
      }),
    );
    const scheduleProblems = draft.validate();
    if (scheduleProblems.length) {
      // 把每日活动数一并报出：排程 bug 的症状通常是「某天挤爆」而不是某个点排错，
      // 且每日分布是唯一能一眼看出分组形状的信息。
      const shape = scheduleOutcome.schedule.days.map((day) => `第${day.dayIndex}天${day.stops.length}个`).join('｜');
      throw new GenerationFailure(`行程排程结果不完整（${shape}，候选 ${research.pool.length} 个）：${scheduleProblems.join('；')}。请重试`);
    }

    // ---------- 阶段 3：文案（只写标题），与下面的地理/修复并发 ----------
    // 文案只写行程和每天标题，不修改活动；与地理增强并发缩短关键路径。
    // 沿用 review 阶段名（前端与时间线契约不变），语义是「给行程与每天起标题」；
    // 活动说明不归它写：research 的候选 intro 已按同一标准写成并直接复用到活动上。
    // 工具面只给 get_draft + update_titles + submit_review，改不动活动/顺序/说明。
    // 文案属增强路径：模型没写完也不算失败，草稿里已有候选简介兜底。
    startPhase('review', 1, '撰写说明文案');
    const review: ReviewOutcome = { submitted: false, notes: [] };
    const writerPromise = runPhaseAgent({
      model,
      apiKey: cfg.apiKey,
      systemPrompt: WRITER_SYSTEM_PROMPT,
      tools: [
        ...buildDraftTools(draft).filter((t) => t.name === 'get_draft' || t.name === 'update_titles'),
        ...buildReviewTools(review),
      ],
      userPrompt: writerUserPrompt(form, draft.render()),
      signal,
      sink: sinkFor('review'),
      maxTurns: 12,
      recorder: createLlmRequestRecorder({ jobId: job.id, userId: job.userId, phase: 'review', round: 1 }),
    }).catch((err: unknown) => {
      // 并行段若因取消/排程异常先抛出，这个 Promise 仍会 settle：必须立刻挂 catch，
      // 否则它的 rejection 无人接收（Node 视为 unhandledRejection）。
      console.warn(`[writer] 文案阶段异常：${err instanceof Error ? err.message : String(err)}`);
      return {
        tokensIn: 0,
        tokensOut: 0,
        aborted: signal.aborted,
        turnLimitExceeded: false,
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    });

    // 修复器使用真实坐标与通勤段；地理循环内部按 signal 逐项检查取消。
    await resolveGeoAndSimulate(sinkFor('plan'));

    // 层3 兜底：确定性修复器 —— 排程层若仍产出「远郊日混排」且 feasibility 报出 hard 违规，
    // 代码级把混排市区活动挪到别的天并重验证（hard 严格递减才采纳，否则回滚）。
    // 修复器属增强路径：任何异常按「未修复」继续走文案（生成不失败原则，取消除外）；
    // legs 重算复用 geoSession 定向重算（额度控制与 amap memo 内置）。
    try {
      const planSink = sinkFor('plan');
      const fix = await runSystemTask('plan', 'repair_long_haul', '优化远郊行程', () =>
        repairLongHaulMixedDays(draft, {
          mode: form.transportMode ?? 'transit',
          recomputeLegs: (dayIndexes) => geo.computeLegs(draft, planSink.onThought, signal, dayIndexes),
          onProgress: planSink.onThought,
          signal,
        }),
      );
      if (fix.applied.length > 0) {
        autoFixMoves.push(...fix.applied);
      }
    } catch (err) {
      if (signal.aborted) throw err;
    }
    endPhase(
      'plan',
      1,
      `活动 ${scheduleOutcome.written} 个｜候选 ${research.pool.length} 个（无坐标补位 ${scheduleOutcome.withoutCoord}｜排不下丢弃 ${scheduleOutcome.schedule.droppedCount}）`,
    );

    // 文案收口（并行段结束）：启动时已记 startPhase，此处只等结果
    const writerRun = await writerPromise;
    usage.tokensIn += writerRun.tokensIn;
    usage.tokensOut += writerRun.tokensOut;
    if (writerRun.errorMessage) {
      console.warn(`[writer] 文案阶段失败，按已有内容落库：${writerRun.errorMessage.slice(0, 200)}`);
      reviewNotes = ['文案生成未完成，活动说明沿用候选简介。'].slice(0, 5);
      endPhase('review', 1, '文案降级（按已有内容落库）');
    } else {
      assertAlive(signal);
      reviewNotes = writerRun.turnLimitExceeded
        ? [...review.notes, '文案模型达到单阶段轮次上限，系统按已写内容落库。'].slice(0, 5)
        : review.notes;
      endPhase('review', 1, writerRun.turnLimitExceeded ? '文案轮次已达上限' : review.submitted ? '文案已提交' : '文案未提交（按已有内容落库）');
    }

    const finalSink = sinkFor('review');

    // 落库前全量重算一次（文案阶段不动结构，但远郊修复器已换过天）：geoSession memo
    // 会复用未变化的高德路径，只有新相邻对才消耗路由额度。异常时清空 legs，宁缺勿持久化假路线。
    try {
      await runSystemTask('review', 'geo_geocode_review_changes', '解析改动地点坐标', () =>
        geo.geocodeAll(draft, finalSink.onThought, signal, true),
      );
      assertAlive(signal);
      await runSystemTask('review', 'geo_recompute_final_legs', '复核最终通勤路线', () =>
        geo.computeLegs(draft, finalSink.onThought, signal),
      );
      assertAlive(signal);
    } catch (err) {
      if (signal.aborted) throw err;
      for (const day of draft.mutableDays()) delete day.legs;
    }

    // 跨天地理聚类兜底：只尝试高收益的同类地点交换；真实 legs 重算后若通勤未明显下降或 hard 增加，
    // 修复器会完整回滚。正常失败不影响生成，取消仍向外传播。
    try {
      const grouping = await runSystemTask('review', 'optimize_cross_day_grouping', '优化跨天路线', () =>
        optimizeCrossDayGrouping(draft, {
          mode: form.transportMode ?? 'transit',
          recomputeLegs: (dayIndexes) => geo.computeLegs(draft, finalSink.onThought, signal, dayIndexes),
          onProgress: finalSink.onThought,
          signal,
        }),
      );
      if (grouping.notes.length) reviewNotes = [...grouping.notes, ...reviewNotes].slice(0, 8);
    } catch (err) {
      if (signal.aborted) throw err;
    }

    // 餐次兜底与通勤时间顺延都不再执行（09-22 D5：行程不产出时间轴）：
    // · ensureMealCoverage 靠时间窗插餐，没有时间轴就无处安放；餐次由确定性排程在每天直接插锚点。
    // · repairTransitTiming 靠「活动结束时间 + 真实 leg」顺延，没有时间轴就无从顺延。
    // 真通勤时长仍由 computeLegs 算在 leg 上，前端按「段间耗时」展示。

    // 全局日期匹配仍无法保留的闭馆段如实提示；自由安排日也保留所需餐次。
    const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;
    const closureNotes = scheduleOutcome.schedule.closureConflicts.map((conflict) => {
      const parsed = new Date(`${conflict.date}T00:00:00`);
      const weekday = Number.isNaN(parsed.getTime()) ? '' : WEEKDAY_LABELS[parsed.getDay()]!;
      const holiday = conflict.holiday ? `（${conflict.holiday}）` : '';
      return `${conflict.names.join('、')} 在 ${conflict.date}${weekday ? ` ${weekday}` : ''}${holiday} 闭馆，无法与其他行程同时安排到开放日，未排入行程（该天可自由安排）。`;
    });
    if (closureNotes.length) {
      reviewNotes = [...new Set([...closureNotes, ...reviewNotes])].slice(0, 8);
    }

    // 只保留最终草稿中仍成立的换天说明。
    const verifiedAutoNotes = verifiedFixNotes(draft, autoFixMoves);
    if (verifiedAutoNotes.length) {
      reviewNotes = [...new Set([...verifiedAutoNotes, ...reviewNotes])].slice(0, 8);
    }

    // 最终草稿重算可行性：hard/soft 违规均如实汇入说明，不再交给模型修订结构。
    const finalFeasibility = draft.feasibility();
    const feasibilityNotes = feasibilityReviewNotes(finalFeasibility);
    if (feasibilityNotes.length) {
      reviewNotes = [...new Set([...reviewNotes, ...feasibilityNotes])].slice(0, 8);
    }

    // ---------- 落库 ----------
    // 实际用到的数据源（该源真拿到过结果才标注）；候选池随 Trip JSON 持久化
    const dataSources: DataSourceKind[] = [
      ...(poi.stats.gotResults ? (['amap'] as const) : []),
      ...(search.stats.gotResults ? (['websearch'] as const) : []),
    ];
    // 修订（PR5）：targetTripId 存在时把新行程挂到同一版本链的下一版；否则就是全新行程
    const revisionOf = job.provenance.kind === 'revision' ? job.provenance.targetTripId : undefined;
    assertAlive(signal);
    const trip = await db.transaction(async (tx) => {
      assertAlive(signal);
      const saved = await createTrip(
        job.userId,
        draft.toTrip(reviewNotes, { overview: research.pool, dataSources }),
        revisionOf,
        tx,
      );
      assertAlive(signal);
      await record('done', saved.id, tx);
      assertAlive(signal);
      return saved;
    });
    // COMMIT 是成功边界：事务内取消会回滚；提交成功后不再把已保存结果宣告取消。
    completeJob(job, trip.id, dataSources, reviewNotes);
    terminalStatus = 'done';
  } catch (err) {
    if (signal.aborted) {
      cancelJob(job);
      terminalStatus = 'cancelled';
    } else {
      failJob(job, err instanceof GenerationFailure ? err.message : '生成失败，请稍后重试');
      terminalStatus = 'error';
      logger?.error({ jobId: job.id, errorType: err instanceof Error ? err.name : 'unknown' }, 'generation failed');
    }
    // 失败/取消先发布权威终态。审计异常必须可观测，但不能再次困住任务锁。
    try {
      await record(terminalStatus, null);
    } catch {
      logger?.error({ jobId: job.id, status: terminalStatus }, 'generation audit write failed');
    }
  } finally {
    clearTimeout(timeout);
    logger?.info(
      {
        jobId: job.id,
        ...timing.summary(terminalStatus),
        usage: {
          tokensIn: usage.tokensIn,
          tokensOut: usage.tokensOut,
          ...providerCallCounts(),
          searchCalls: search.stats.calls,
        },
      },
      'generation timing summary',
    );
  }
}

/** 取消或 LLM 错误时立刻终止流水线 */
function assertAlive(signal: AbortSignal, errorMessage?: string): void {
  if (signal.aborted) throw new GenerationFailure('已取消');
  if (errorMessage) throw new GenerationFailure(`模型调用异常：${errorMessage}`);
}
