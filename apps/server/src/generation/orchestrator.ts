// Orchestrator：代码级三阶段流水线（调研 → 编排 → 审校，≤2 轮修订）
// 唯一入口 runGeneration —— 路由只见任务号与 SSE，Agent 细节全部封装在此（架构 §2 单入口隔离）
import {
  describeFeasibility,
  feasibilityReviewNotes,
  GENERATION_TIMEOUT_MINUTES,
  type DataSourceKind,
  type FeasibilityReport,
  type GenerateForm,
  type GenerationJobStatus,
  type GenerationPhase,
} from '@tripweaver/shared';
import type { FastifyBaseLogger } from 'fastify';
import { db } from '../db/client';
import { generations } from '../db/schema';
import { uid } from '@tripweaver/shared';
import type { LlmConfig } from '../services/settingsService';
import { amapBudgetRemaining, searchBudgetRemaining } from '../services/quotaService';
import { createTrip } from '../services/tripService';
import {
  AMAP_MAX_PER_TASK,
  createTaskPoiSource,
  getNullPoiSource,
  resolvePoiSourceForUser,
} from '../integrations/amap/poiSource';
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
import { ensureMealCoverage } from './mealPlanning';
import { optimizeCrossDayGrouping, repairTransitTiming } from './routeCoherence';
import { buildModel } from './model';
import { emit, completeJob, failJob, cancelJob, type Job } from './jobManager';
import { runPhaseAgent, type PhaseEventSink } from './agents/runner';
import { GenerationPerformance } from './performance';
import { retrieveContext } from './retrieveContext';
import { createLlmRequestRecorder } from './llmRequestLog';
import { buildResearchTools, type ResearchOutcome } from './tools/researchTools';
import { buildGeoTools } from './tools/geoTools';
import { buildDraftTools, buildSubmitPlanTool } from './tools/draftTools';
import { buildReviewTools, type ReviewOutcome } from './tools/reviewTools';
import {
  PLANNER_SYSTEM_PROMPT,
  PLANNER_REVISION_SYSTEM_PROMPT,
  RESEARCH_SYSTEM_PROMPT,
  REVIEWER_SYSTEM_PROMPT,
  formBrief,
  plannerUserPrompt,
  reviewerUserPrompt,
} from './prompts';

const JOB_TIMEOUT_MS = GENERATION_TIMEOUT_MINUTES * 60 * 1000;   // 整任务兜底超时（与前端提示文案同源）
const MAX_REVIEW_ROUNDS = 2;             // 审校 ≤2 轮（含修订回炉）

class GenerationFailure extends Error {}

/** 调研阶段降级说明：数据源缺失/超额不阻断生成，仅在时间线上明示 */
function researchNote(sources: DataSourceKind[]): string | undefined {
  if (sources.length === 2) return undefined;
  if (sources.length === 0) return '高德与全网搜索数据源均不可用，本次基于模型知识调研';
  return sources[0] === 'amap'
    ? '全网搜索不可用，本次基于高德地点数据 + 模型知识调研'
    : '高德地点数据不可用，本次基于全网搜索 + 模型知识调研';
}

export async function runGeneration(
  job: Job,
  form: GenerateForm,
  cfg: LlmConfig,
  logger?: Pick<FastifyBaseLogger, 'info'>,
): Promise<void> {
  const signal = job.abort.signal;
  const usage = { tokensIn: 0, tokensOut: 0 };
  const timing = new GenerationPerformance(job.createdAt);
  let terminalStatus: GenerationJobStatus = 'error';
  let systemTaskSeq = 0;
  const timeout = setTimeout(() => {
    job.cancelReason = 'timeout';   // 超时自动取消：事件携带 reason，前端区分展示
    job.abort.abort();
  }, JOB_TIMEOUT_MS);
  timeout.unref?.();

  // 模型安全校验与搜索源安全校验互不依赖，尽早并行启动以缩短初始化等待。
  const modelPromise = buildModel(cfg).then(
    (model) => ({ ok: true as const, model }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  // 全站日额度闸门：某源余额不足则该源整任务注入 Null 降级（不断服，架构 §6）
  const poiBase =
    (await amapBudgetRemaining()) >= AMAP_MAX_PER_TASK
      ? (await resolvePoiSourceForUser(job.userId)).source
      : getNullPoiSource();
  const searchBase =
    (await searchBudgetRemaining()) >= SEARCH_MAX_PER_TASK
      ? (await resolveSearchSourceForUser(job.userId)).source
      : getNullSearchSource();
  const poi = createTaskPoiSource(poiBase);
  const search = createTaskSearchSource(searchBase);
  // 地理会话（v0.5）：geocode/route 统一凭据解析、任务上限与日额度记账（计入 amap_calls）；出行方式基调来自表单（ST3）
  const geo = createGeoSession(job.userId, form.destination, form.transportMode ?? 'transit');
  await geo.init();   // 09-18：凭据/额度解析 PG 化后为异步，须在任何 geo 调用前完成
  const enabledSources: DataSourceKind[] = [
    ...(poi.source.kind === 'amap' ? (['amap'] as const) : []),
    ...(search.source.kind === 'websearch' ? (['websearch'] as const) : []),
  ];

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
        amapCalls: poi.stats.calls + geo.stats.calls,
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

  const record = async (status: 'done' | 'error' | 'cancelled', tripId: string | null) => {
    await db.insert(generations)
      .values({
        id: uid(),
        userId: job.userId,
        tripId,
        status,
        usedXhs: false,   // 列保留供旧数据读取；新生成恒 false
        usedByok: cfg.byok,
        tokensIn: usage.tokensIn,
        tokensOut: usage.tokensOut,
        amapCalls: poi.stats.calls + geo.stats.calls,
        searchCalls: search.stats.calls,
        createdAt: new Date(),
      });
  };

  try {
    // xhsEnabled 为旧前端兼容字段，现语义 =「有任一外部调研数据源可用」
    emit(job, {
      type: 'job_start',
      destination: form.destination,
      xhsEnabled: enabledSources.length > 0,
      dataSources: enabledSources,
      at: job.createdAt,
    });
    const modelResult = await modelPromise;
    if (!modelResult.ok) throw modelResult.error;
    const { model } = modelResult;   // BYOK：使用时二次 ssrfGuard，失败即 job_error

    // ---------- 阶段 1：调研 ----------
    startPhase('research', 1, researchNote(enabledSources));
    const research: ResearchOutcome = { summary: '', pool: [], locations: new Map() };
    const researchRun = await runPhaseAgent({
      model,
      apiKey: cfg.apiKey,
      systemPrompt: RESEARCH_SYSTEM_PROMPT,
      tools: buildResearchTools({
        poiSource: poi.source,
        searchSource: search.source,
        destination: form.destination,
        outcome: research,
        onCandidate: (candidate) => emit(job, { type: 'candidate', poi: candidate }),
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

    // RAG 地基（09-18）：调研与编排之间的检索调用点。
    // 接入 canonical_places / research_evidence 混合召回（关键词 + 可选向量），结果注入 plannerUserPrompt。
    const ragContext = await retrieveContext(research.pool.map((p) => p.name), { city: form.destination });

    // 层2 编排预防：候选池距离预计算（确定性、零外呼）——远郊长途点按通勤时长标级，
    // 经 plannerUserPrompt 注入规划 prompt（首轮与修订轮共用同一构造，每轮可见）。
    // 无坐标候选自动跳过（漏标由层3 修复器兜底）；无长途点时规划 user prompt 逐字不变。
    // 纯函数按理不抛，仍按增强路径防御（生成不失败原则，同 resolveGeoAndSimulate）：意外异常只损失情报、按无标记降级。
    let longHaulIntel: LongHaulPoi[] = [];
    try {
      longHaulIntel = classifyLongHaulPois(research.pool, research.locations, form.transportMode ?? 'transit');
    } catch {
      // 按无情报降级，生成继续
    }

    // ---------- 阶段 2/3：编排 → 地理解析 → 可行性 → 审校（≤2 轮） ----------
    // 时序前移（M0-A）：geoPipeline 从「审校循环之后」移到「每轮编排之后、审校之前」，
    // 让可行性引擎在真实坐标/leg 上运行，审校拿到代码算出的真违规报告（不再纯语感）。
    // 修订轮为增量解析：geocodeAll 跳过已 geocoded 活动，computeLegs 复用 amap leg memo 不重复烧 route 额度
    // （降级成启发式的段不记忆，修订轮在剩余额度内重试高德）。
    const draft = new DraftTrip(form);
    let reviewNotes: string[] = [];
    let revisionRequests: string[] = [];
    let feasibility: FeasibilityReport = { dayReports: [], violations: [] };
    // 层3 修复器采纳的挪动记录（跨轮累计）：落库前经 verifiedFixNotes 校验「活动确在注记声称的
    // 目标天」才并入 reviewNotes——修订轮可能推翻挪动（live beijing 实证），失真注记宁弃不留
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
      feasibility = await runSystemTask('plan', 'simulate_feasibility', '检查时空可行性', () => draft.feasibility());
    };

    for (let round = 1; round <= MAX_REVIEW_ROUNDS; round++) {
      startPhase('plan', round, round > 1 ? '按审校意见修订' : undefined);
      let planPassed = false;
      const plannerRun = await runPhaseAgent({
        model,
        apiKey: cfg.apiKey,
        systemPrompt: round === 1 ? PLANNER_SYSTEM_PROMPT : PLANNER_REVISION_SYSTEM_PROMPT,
        tools: [...buildDraftTools(draft, round === 1 ? 'plan' : 'revision'), ...buildGeoTools(geo), buildSubmitPlanTool(draft, () => (planPassed = true))],
        userPrompt: plannerUserPrompt(form, research, revisionRequests, longHaulIntel, round > 1 ? draft.render() : undefined, ragContext),
        signal,
        sink: sinkFor('plan'),
        maxTurns: 30,
        recorder: createLlmRequestRecorder({ jobId: job.id, userId: job.userId, phase: 'plan', round }),
      });
      usage.tokensIn += plannerRun.tokensIn;
      usage.tokensOut += plannerRun.tokensOut;
      assertAlive(signal, plannerRun.errorMessage);

      // 完整性兜底（R2）：模型没走 submit_plan 也以实际校验为准
      const problems = draft.validate();
      if (!planPassed && problems.length) {
        throw new GenerationFailure(`行程草稿不完整：${problems.join('；')}。请重试，或换用工具调用能力更强的模型`);
      }

      // 时序前移：编排后立刻解析全量坐标/leg 并跑可行性引擎，供审校用真实报告
      await resolveGeoAndSimulate(sinkFor('plan'));

      // 层3 兜底：确定性修复器 —— 规划 LLM 无视长途点情报仍产出「远郊日混排」且 feasibility 报出
      // hard 违规时，代码级把混排市区活动挪到别的天并重验证（hard 严格递减才采纳，否则回滚）。
      // 修复器属增强路径：任何异常按「未修复」继续走审校（生成不失败原则，取消除外）；
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
          feasibility = draft.feasibility();   // 审校拿「修复器尽力后」的报告
        }
      } catch (err) {
        if (signal.aborted) throw err;
      }
      endPhase('plan', round);

      startPhase('review', round);
      const review: ReviewOutcome = { submitted: false, approved: false, notes: [], revisionRequests: [] };
      const reviewerRun = await runPhaseAgent({
        model,
        apiKey: cfg.apiKey,
        systemPrompt: REVIEWER_SYSTEM_PROMPT,
        tools: [...buildDraftTools(draft).filter((t) => t.name !== 'set_trip_skeleton' && t.name !== 'add_activity' && t.name !== 'set_lodging'), ...buildReviewTools(review)],
        userPrompt: reviewerUserPrompt(form, round, describeFeasibility(feasibility)),
        signal,
        sink: sinkFor('review'),
        maxTurns: 12,
        recorder: createLlmRequestRecorder({ jobId: job.id, userId: job.userId, phase: 'review', round }),
      });
      usage.tokensIn += reviewerRun.tokensIn;
      usage.tokensOut += reviewerRun.tokensOut;
      if (reviewerRun.turnLimitExceeded) {
        assertAlive(signal);
        reviewNotes = [
          ...review.notes,
          '审校模型达到单阶段轮次上限，系统已保留已完成修订，并继续执行餐次完整性与可行性检查。',
        ].slice(0, 5);
        endPhase('review', round, '审校轮次已达上限，转为确定性检查');
        break;
      }
      assertAlive(signal, reviewerRun.errorMessage);

      if (!review.submitted || review.approved || round === MAX_REVIEW_ROUNDS) {
        reviewNotes = review.notes;
        if (review.submitted && !review.approved) {
          // 轮次用尽仍未通过：把修订要求转成「审校遗留」提示（PRD F1）
          reviewNotes = [...review.notes, ...review.revisionRequests.map((r) => `审校遗留：${r}`)].slice(0, 5);
        }
        endPhase('review', round, review.approved ? '审校通过' : '审校有遗留项');
        break;
      }
      revisionRequests = review.revisionRequests;
      endPhase('review', round, `需修订：${revisionRequests.length} 项`);
    }

    const finalSink = sinkFor('review');

    // 审校可 update/remove 活动，旧 legs 会与最终活动序列失配。落库前全量重算一次；geoSession memo
    // 会复用未变化的高德路径，只有新相邻对才消耗路由额度。异常时清空 legs，宁缺勿持久化假路线。
    try {
      // Reviewer may replace a place. Resolve only changed/new queries here; unchanged
      // failed lookups do not gain another full retry pass just because review completed.
      await runSystemTask('review', 'geo_geocode_review_changes', '解析修订地点坐标', () =>
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

    // 最终餐次兜底：正常路径由 submit_plan 的完整性门槛要求模型补齐；这里防止审校阶段
    // 删除/改写最后一个午餐或晚餐后仍把不完整行程持久化。补位使用顺路片区建议，不冒充具体门店。
    const mealRepairs = await runSystemTask('review', 'ensure_meal_coverage', '检查餐次完整性', () =>
      ensureMealCoverage(draft.mutableDays(), form.destination),
    );
    if (mealRepairs.length) {
      const changedDays = [...new Set(mealRepairs.filter((item) => item.action === 'inserted').map((item) => item.dayIndex))];
      try {
        if (changedDays.length) {
          await runSystemTask('review', 'geo_recompute_meal_legs', '更新餐次通勤路线', () =>
            geo.computeLegs(draft, finalSink.onThought, signal, changedDays),
          );
          assertAlive(signal);
        }
      } catch (err) {
        if (signal.aborted) throw err;
      }
      const summary = mealRepairs.map((item) => `第${item.dayIndex}天${item.kind === 'lunch' ? '午餐' : '晚餐'}`).join('、');
      reviewNotes = [`系统已补齐${summary}的顺路就餐时段；具体门店与实时信息请到大众点评或美团确认。`, ...reviewNotes].slice(0, 8);
    }

    // 以最终真实通勤段顺延贴边活动，修复「前一活动结束即开饭但仍需移动」等硬冲突；
    // 单日无法在餐窗/23:00 边界内排下则该天整体不改，由最终可行性说明如实透出。
    const timingDays = await runSystemTask('review', 'repair_transit_timing', '调整通勤时间', () =>
      repairTransitTiming(draft.mutableDays()),
    );
    if (timingDays.length) {
      reviewNotes = [
        `系统已顺延第 ${timingDays.join('、')} 天的部分活动时间，为实际通勤预留间隔。`,
        ...reviewNotes,
      ].slice(0, 8);
    }

    // 层3 修复器的自动调整说明（可信透明）：系统替用户做过的换天动作必须可见，置于 reviewNotes 最前。
    // 真话契约：只保留最终草稿里仍成立的挪动注记（修订轮重排可能已推翻——live beijing 实证
    // 轮1 挪出的活动被轮2 放回原天，跨轮累计若不校验会对用户宣称一次并不存在的调整）。
    const verifiedAutoNotes = verifiedFixNotes(draft, autoFixMoves);
    if (verifiedAutoNotes.length) {
      reviewNotes = [...new Set([...verifiedAutoNotes, ...reviewNotes])].slice(0, 8);
    }

    // 可行性降级（decision 2 守生成不失败）：修订轮用尽仍有 hard 违规 → 如实并入 reviewNotes，任务仍 done 不 throw；
    // soft 违规同样汇入最终 reviewNotes（不阻断，仅提示）。geoPipeline 已在循环内解析，draft 无需再跑后处理。
    // 用最终草稿重算：审校阶段可能已就地 update/remove 活动（时间微调、删点减负），落库前的降级说明须反映
    // 真实持久化状态，否则会报「审校已修掉的」遗留问题或漏报审校新引入的问题（loop 内 feasibility 是审校前快照）。
    // draft.feasibility() 是纯函数（无网络/geoPipeline）：未动的段仍用真实 leg，审校改动的段按 haversine 兜底如实降级。
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
    const trip = await createTrip(job.userId, draft.toTrip(reviewNotes, { overview: research.pool, dataSources }));
    await record('done', trip.id);
    completeJob(job, trip.id, dataSources, reviewNotes);
    terminalStatus = 'done';
  } catch (err) {
    if (signal.aborted) {
      cancelJob(job);
      terminalStatus = 'cancelled';
      // 先发布权威终态，避免审计表写入异常让已接受的取消永久停在 running。
      await record('cancelled', null);           // 取消不计配额（配额只数 done）
      return;
    }
    await record('error', null);
    const message =
      err instanceof GenerationFailure
        ? err.message
        : `生成失败：${err instanceof Error ? err.message : '未知错误'}`;
    failJob(job, message);
    terminalStatus = 'error';
  } finally {
    clearTimeout(timeout);
    logger?.info(
      {
        jobId: job.id,
        ...timing.summary(terminalStatus),
        usage: {
          tokensIn: usage.tokensIn,
          tokensOut: usage.tokensOut,
          amapCalls: poi.stats.calls + geo.stats.calls,
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
