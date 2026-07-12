// Orchestrator：代码级三阶段流水线（调研 → 编排 → 审校，≤2 轮修订）
// 唯一入口 runGeneration —— 路由只见任务号与 SSE，Agent 细节全部封装在此（架构 §2 单入口隔离）
import { type DataSourceKind, type GenerateForm, type GenerationPhase } from '@tripweaver/shared';
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
import { buildModel } from './model';
import { emit, completeJob, failJob, cancelJob, type Job } from './jobManager';
import { runPhaseAgent, type PhaseEventSink } from './agents/runner';
import { buildResearchTools, type ResearchOutcome } from './tools/researchTools';
import { buildGeoTools } from './tools/geoTools';
import { buildDraftTools, buildSubmitPlanTool } from './tools/draftTools';
import { buildReviewTools, type ReviewOutcome } from './tools/reviewTools';
import {
  PLANNER_SYSTEM_PROMPT,
  RESEARCH_SYSTEM_PROMPT,
  REVIEWER_SYSTEM_PROMPT,
  formBrief,
  plannerUserPrompt,
  reviewerUserPrompt,
} from './prompts';

const JOB_TIMEOUT_MS = 10 * 60 * 1000;   // 整任务兜底超时
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

export async function runGeneration(job: Job, form: GenerateForm, cfg: LlmConfig): Promise<void> {
  const signal = job.abort.signal;
  const usage = { tokensIn: 0, tokensOut: 0 };
  const timeout = setTimeout(() => job.abort.abort(), JOB_TIMEOUT_MS);
  timeout.unref?.();

  // 全站日额度闸门：某源余额不足则该源整任务注入 Null 降级（不断服，架构 §6）
  const poiBase =
    amapBudgetRemaining() >= AMAP_MAX_PER_TASK
      ? resolvePoiSourceForUser(job.userId).source
      : getNullPoiSource();
  const searchBase =
    searchBudgetRemaining() >= SEARCH_MAX_PER_TASK
      ? (await resolveSearchSourceForUser(job.userId)).source
      : getNullSearchSource();
  const poi = createTaskPoiSource(poiBase);
  const search = createTaskSearchSource(searchBase);
  // 地理会话（v0.5）：geocode/route 统一凭据解析、任务上限与日额度记账（计入 amap_calls）
  const geo = createGeoSession(job.userId, form.destination);
  const enabledSources: DataSourceKind[] = [
    ...(poi.source.kind === 'amap' ? (['amap'] as const) : []),
    ...(search.source.kind === 'websearch' ? (['websearch'] as const) : []),
  ];

  const sinkFor = (phase: GenerationPhase): PhaseEventSink => ({
    onThought: (text) => emit(job, { type: 'thought', phase, text }),
    onToolStart: (toolCallId, tool, label, args) =>
      emit(job, { type: 'tool_start', phase, toolCallId, tool, label, args: JSON.stringify(args ?? {}).slice(0, 200) }),
    onToolEnd: (toolCallId, tool, label, summary, isError) =>
      emit(job, { type: 'tool_end', phase, toolCallId, tool, label, summary, isError }),
    onUsage: (tokensIn, tokensOut) =>
      emit(job, {
        type: 'usage',
        tokensIn: usage.tokensIn + tokensIn,
        tokensOut: usage.tokensOut + tokensOut,
        xhsCalls: 0,   // 旧前端兼容字段（小红书已移除）
        amapCalls: poi.stats.calls + geo.stats.calls,
        searchCalls: search.stats.calls,
      }),
  });

  const record = (status: 'done' | 'error' | 'cancelled', tripId: string | null) => {
    db.insert(generations)
      .values({
        id: uid(),
        userId: job.userId,
        tripId,
        status,
        usedXhs: 0,   // 列保留供旧数据读取；新生成恒 0
        usedByok: cfg.byok ? 1 : 0,
        tokensIn: usage.tokensIn,
        tokensOut: usage.tokensOut,
        amapCalls: poi.stats.calls + geo.stats.calls,
        searchCalls: search.stats.calls,
        createdAt: Date.now(),
      })
      .run();
  };

  try {
    // xhsEnabled 为旧前端兼容字段，现语义 =「有任一外部调研数据源可用」
    emit(job, { type: 'job_start', destination: form.destination, xhsEnabled: enabledSources.length > 0, dataSources: enabledSources });
    const model = await buildModel(cfg);   // BYOK：使用时二次 ssrfGuard，失败即 job_error

    // ---------- 阶段 1：调研 ----------
    emit(job, { type: 'phase_start', phase: 'research', round: 1, note: researchNote(enabledSources) });
    const research: ResearchOutcome = { summary: '', pool: [] };
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
    });
    usage.tokensIn += researchRun.tokensIn;
    usage.tokensOut += researchRun.tokensOut;
    assertAlive(signal, researchRun.errorMessage);
    emit(job, {
      type: 'phase_end',
      phase: 'research',
      round: 1,
      summary: `候选 ${research.pool.length} 个｜${research.summary.slice(0, 160)}`,
    });

    // ---------- 阶段 2/3：编排 ⇆ 审校（≤2 轮） ----------
    const draft = new DraftTrip(form);
    let reviewNotes: string[] = [];
    let revisionRequests: string[] = [];

    for (let round = 1; round <= MAX_REVIEW_ROUNDS; round++) {
      emit(job, { type: 'phase_start', phase: 'plan', round, note: round > 1 ? '按审校意见修订' : undefined });
      let planPassed = false;
      const plannerRun = await runPhaseAgent({
        model,
        apiKey: cfg.apiKey,
        systemPrompt: PLANNER_SYSTEM_PROMPT,
        tools: [...buildDraftTools(draft), ...buildGeoTools(geo), buildSubmitPlanTool(draft, () => (planPassed = true))],
        userPrompt: plannerUserPrompt(form, research, revisionRequests),
        signal,
        sink: sinkFor('plan'),
        maxTurns: 30,
      });
      usage.tokensIn += plannerRun.tokensIn;
      usage.tokensOut += plannerRun.tokensOut;
      assertAlive(signal, plannerRun.errorMessage);

      // 完整性兜底（R2）：模型没走 submit_plan 也以实际校验为准
      const problems = draft.validate();
      if (!planPassed && problems.length) {
        throw new GenerationFailure(`行程草稿不完整：${problems.join('；')}。请重试，或换用工具调用能力更强的模型`);
      }
      emit(job, { type: 'phase_end', phase: 'plan', round });

      emit(job, { type: 'phase_start', phase: 'review', round });
      const review: ReviewOutcome = { submitted: false, approved: false, notes: [], revisionRequests: [] };
      const reviewerRun = await runPhaseAgent({
        model,
        apiKey: cfg.apiKey,
        systemPrompt: REVIEWER_SYSTEM_PROMPT,
        tools: [...buildDraftTools(draft).filter((t) => t.name !== 'set_trip_skeleton' && t.name !== 'add_activity'), ...buildReviewTools(draft, form, review)],
        userPrompt: reviewerUserPrompt(form, round),
        signal,
        sink: sinkFor('review'),
        maxTurns: 12,
      });
      usage.tokensIn += reviewerRun.tokensIn;
      usage.tokensOut += reviewerRun.tokensOut;
      assertAlive(signal, reviewerRun.errorMessage);

      if (!review.submitted || review.approved || round === MAX_REVIEW_ROUNDS) {
        reviewNotes = review.notes;
        if (review.submitted && !review.approved) {
          // 轮次用尽仍未通过：把修订要求转成「审校遗留」提示（PRD F1）
          reviewNotes = [...review.notes, ...review.revisionRequests.map((r) => `审校遗留：${r}`)].slice(0, 5);
        }
        emit(job, { type: 'phase_end', phase: 'review', round, summary: review.approved ? '审校通过' : '审校有遗留项' });
        break;
      }
      revisionRequests = review.revisionRequests;
      emit(job, { type: 'phase_end', phase: 'review', round, summary: `需修订：${revisionRequests.length} 项` });
    }

    // ---------- 确定性地理后处理（v0.5，R4）：全量坐标解析 + 通勤段，机械工作移出 LLM 循环 ----------
    // 进度经现有 thought 事件透出（不新增 SSE 事件类型，前端改造属 ST2）
    const geoSink = sinkFor('review');
    try {
      geoSink.onThought('正在解析坐标与通勤…');
      await geo.geocodeAll(draft, geoSink.onThought, signal);
      assertAlive(signal);
      await geo.computeLegs(draft, geoSink.onThought, signal);
      assertAlive(signal);
    } catch (err) {
      if (signal.aborted) throw err;
      // 后处理属增强路径：意外异常只损失坐标补全/通勤段，不失败整个任务
    }

    // ---------- 落库 ----------
    // 实际用到的数据源（该源真拿到过结果才标注）；候选池随 Trip JSON 持久化
    const dataSources: DataSourceKind[] = [
      ...(poi.stats.gotResults ? (['amap'] as const) : []),
      ...(search.stats.gotResults ? (['websearch'] as const) : []),
    ];
    const trip = createTrip(job.userId, draft.toTrip(reviewNotes, { overview: research.pool, dataSources }));
    record('done', trip.id);
    completeJob(job, trip.id, dataSources, reviewNotes);
  } catch (err) {
    if (signal.aborted) {
      cancelJob(job);
      // 先发布权威终态，避免审计表写入异常让已接受的取消永久停在 running。
      record('cancelled', null);           // 取消不计配额（配额只数 done）
      return;
    }
    record('error', null);
    const message =
      err instanceof GenerationFailure
        ? err.message
        : `生成失败：${err instanceof Error ? err.message : '未知错误'}`;
    failJob(job, message);
  } finally {
    clearTimeout(timeout);
  }
}

/** 取消或 LLM 错误时立刻终止流水线 */
function assertAlive(signal: AbortSignal, errorMessage?: string): void {
  if (signal.aborted) throw new GenerationFailure('已取消');
  if (errorMessage) throw new GenerationFailure(`模型调用异常：${errorMessage}`);
}
