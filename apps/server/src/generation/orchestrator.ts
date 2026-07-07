// Orchestrator：代码级三阶段流水线（调研 → 编排 → 审校，≤2 轮修订）
// 唯一入口 runGeneration —— 路由只见任务号与 SSE，Agent 细节全部封装在此（架构 §2 单入口隔离）
import { type GenerateForm, type GenerationPhase } from '@tripweaver/shared';
import { db } from '../db/client';
import { generations } from '../db/schema';
import { uid } from '@tripweaver/shared';
import type { LlmConfig } from '../services/settingsService';
import { xhsBudgetRemaining } from '../services/quotaService';
import { createTrip } from '../services/tripService';
import {
  createTaskContentSource,
  getContentSource,
  getNullContentSource,
  XHS_MAX_DETAIL_PER_TASK,
  XHS_MAX_SEARCH_PER_TASK,
} from '../integrations/xhs/contentSource';
import { DraftTrip } from './draft';
import { buildModel } from './model';
import { emit, completeJob, failJob, cancelJob, type Job } from './jobManager';
import { runPhaseAgent, type PhaseEventSink } from './agents/runner';
import { buildXhsTools, type ResearchOutcome } from './tools/xhsTools';
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

/** 每任务预留的小红书调用额度；全站余额不足一个任务时直接降级 */
const XHS_TASK_RESERVE = XHS_MAX_SEARCH_PER_TASK + XHS_MAX_DETAIL_PER_TASK;

class GenerationFailure extends Error {}

export async function runGeneration(job: Job, form: GenerateForm, cfg: LlmConfig): Promise<void> {
  const signal = job.abort.signal;
  const usage = { tokensIn: 0, tokensOut: 0 };
  const timeout = setTimeout(() => job.abort.abort(), JOB_TIMEOUT_MS);
  timeout.unref?.();

  // 全站日额度闸门：余额不足则整任务注入 Null 源（不断服，架构 §6）
  const budgetLeft = xhsBudgetRemaining();
  const baseSource = budgetLeft >= XHS_TASK_RESERVE ? getContentSource() : getNullContentSource();
  const { source, stats } = createTaskContentSource(baseSource);
  const xhsEnabled = source.kind === 'xhs';

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
        xhsCalls: stats.searchCalls + stats.detailCalls,
      }),
  });

  const record = (status: 'done' | 'error' | 'cancelled', tripId: string | null) => {
    db.insert(generations)
      .values({
        id: uid(),
        userId: job.userId,
        tripId,
        status,
        usedXhs: stats.gotResults ? 1 : 0,
        usedByok: cfg.byok ? 1 : 0,
        tokensIn: usage.tokensIn,
        tokensOut: usage.tokensOut,
        xhsCalls: stats.searchCalls + stats.detailCalls,
        createdAt: Date.now(),
      })
      .run();
  };

  try {
    emit(job, { type: 'job_start', destination: form.destination, xhsEnabled });
    const model = await buildModel(cfg);   // BYOK：使用时二次 ssrfGuard，失败即 job_error

    // ---------- 阶段 1：调研 ----------
    emit(job, {
      type: 'phase_start',
      phase: 'research',
      round: 1,
      note: xhsEnabled ? undefined : '小红书数据源不可用，本次基于模型知识调研',
    });
    const research: ResearchOutcome = { summary: '' };
    const researchRun = await runPhaseAgent({
      model,
      apiKey: cfg.apiKey,
      systemPrompt: RESEARCH_SYSTEM_PROMPT,
      tools: buildXhsTools(source, research),
      userPrompt: `${formBrief(form)}\n\n请开始调研。`,
      signal,
      sink: sinkFor('research'),
      maxTurns: 12,
    });
    usage.tokensIn += researchRun.tokensIn;
    usage.tokensOut += researchRun.tokensOut;
    assertAlive(signal, researchRun.errorMessage);
    emit(job, { type: 'phase_end', phase: 'research', round: 1, summary: research.summary.slice(0, 200) });

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
        tools: [...buildDraftTools(draft), ...buildGeoTools(form.destination), buildSubmitPlanTool(draft, () => (planPassed = true))],
        userPrompt: plannerUserPrompt(form, research.summary, revisionRequests),
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

    // ---------- 落库 ----------
    const usedXhs = xhsEnabled && stats.gotResults;
    const trip = createTrip(job.userId, draft.toTrip(usedXhs, reviewNotes));
    record('done', trip.id);
    completeJob(job, trip.id, usedXhs, reviewNotes);
  } catch (err) {
    if (signal.aborted) {
      record('cancelled', null);           // 取消不计配额（配额只数 done）
      cancelJob(job);
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
