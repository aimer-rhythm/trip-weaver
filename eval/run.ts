// 评测 harness CLI（M0-B）
// 默认离线：重放 eval/snapshots/<caseId>.json 快照 → 确定性检查 → 报告（零成本，CI 可跑）
// --live：真实 LLM + 高德全流程生成（env：SITE_LLM_BASE_URL/SITE_LLM_API_KEY/SITE_LLM_MODEL；AMAP_KEY 必需，
//         降级需显式 --allow-no-geo），生成结果落快照后再检查。--case <id> 只跑单例。
// 门槛口径：全部用例 hard=0 且结构=0 且 geo 可信（checks.ts EVAL_GEO_THRESHOLDS）→ gate PASS
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GenerateForm, ResearchPoi, Trip } from '@tripweaver/shared';
import { config } from 'dotenv';
import { GOLDEN_CASES, type GoldenCase } from './golden/cases';
import { runChecks, type CaseResult, type SnapshotTiming } from './checks';

const EVAL_DIR = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DIR = path.join(EVAL_DIR, 'snapshots');
const REPORT_DIR = path.join(EVAL_DIR, 'reports');

// v2 新增（均可选，v1 快照缺省时对应检查自动跳过）：
// research —— 调研候选池（candidate 事件全量收集）；timing —— 阶段耗时与 token 用量（phase_end/usage/job_done 事件）
interface Snapshot {
  caseId: string;
  generatedAt: number;
  model: string;      // 快照产自哪个模型（历史对比用）；离线手工快照可为 'manual'
  form: GenerateForm;
  trip: Trip;
  research?: { candidates: ResearchPoi[] };
  timing?: SnapshotTiming;
}

// ---------- CLI 参数 ----------

const args = process.argv.slice(2);
const live = args.includes('--live');
const caseFilter = args.includes('--case') ? args[args.indexOf('--case') + 1] : undefined;

if (live) {
  // 与 smoke-pi 一致：终端显式变量优先，其次 apps/server/.env，最后根 .env。
  for (const envFile of [path.join(EVAL_DIR, '../apps/server/.env'), path.join(EVAL_DIR, '../.env')]) {
    if (fs.existsSync(envFile)) config({ path: envFile, quiet: true });
  }
  // 隔离铁律（07-16 教训：dotenv 先加载使 `||=` 失效，评测写进了开发库）——
  // 库与主密钥一律无条件覆盖：独立 eval.db + 一次性密钥，绝不触碰开发库。
  process.env.DATABASE_PATH = path.join(EVAL_DIR, 'data', 'eval.db');
  process.env.MASTER_KEY = crypto.randomBytes(32).toString('hex');
  // 满跑 9 用例最多 ~630 次高德调用（geocode 40 + route 30 / 例）；生产保守默认 150 会中途关闸静默降级
  process.env.AMAP_DAILY_BUDGET ||= '700';
  // fail-loud（07-16 教训：本机 Nominatim 直连不可达，无 AMAP_KEY 只会产出被 geo 门槛整批拒收的空心快照）
  if (!process.env.AMAP_KEY && !args.includes('--allow-no-geo')) {
    console.error('--live 需要 AMAP_KEY：地理链路是可行性检查的前提，缺 Key 的快照会被 geo 门槛整批判 FAIL。');
    console.error('确要无地理降级跑：npm run eval:live -- --allow-no-geo');
    process.exit(2);
  }
  console.log(
    `live 环境：独立 eval.db｜AMAP_DAILY_BUDGET=${process.env.AMAP_DAILY_BUDGET}｜AMAP_KEY ${process.env.AMAP_KEY ? '已配置' : '缺失（--allow-no-geo 降级）'}`,
  );
  // 与 server 入口同款代理接管（index.ts:10）：否则本机 Clash 环境下 Nominatim 兜底在 eval 路径永远直连超时
  await import('../apps/server/src/lib/proxy');
}

const cases = caseFilter ? GOLDEN_CASES.filter((c) => c.id === caseFilter) : GOLDEN_CASES;
if (cases.length === 0) {
  console.error(`未找到用例：${caseFilter}。可用：${GOLDEN_CASES.map((c) => c.id).join(', ')}`);
  process.exit(2);
}

// ---------- live：直调 runGeneration（不经 HTTP，不占用户配额） ----------

async function generateLive(gc: GoldenCase): Promise<Snapshot | null> {
  const baseUrl = process.env.SITE_LLM_BASE_URL ?? '';
  const apiKey = process.env.SITE_LLM_API_KEY ?? '';
  const model = process.env.SITE_LLM_MODEL ?? '';
  if (!baseUrl || !apiKey || !model) {
    console.error('--live 需要在 apps/server/.env、根 .env 或当前环境中配置 SITE_LLM_BASE_URL / SITE_LLM_API_KEY / SITE_LLM_MODEL');
    process.exit(2);
  }
  // server 模块 import 期强校验 env：库与密钥已在启动时强制指向 eval 专属值（见顶部隔离段）
  const { runGeneration } = await import('../apps/server/src/generation/orchestrator');
  const { createJob, subscribe } = await import('../apps/server/src/generation/jobManager');
  const { getTrip } = await import('../apps/server/src/services/tripService');

  const job = createJob('eval-user');
  let errorMessage = '';
  // v2 快照采集：候选池 + 阶段耗时 + token 用量（usage 事件为累计值，末次即全量）
  const candidates: ResearchPoi[] = [];
  const phases: Record<string, number> = {};
  let tokensIn: number | undefined;
  let tokensOut: number | undefined;
  let totalMs: number | undefined;
  subscribe(job, 0, ({ event }) => {
    if (event.type === 'job_error') errorMessage = event.message;
    if (event.type === 'phase_start') console.log(`    [${gc.id}] 阶段 ${event.phase}（第 ${event.round ?? 1} 轮）`);
    if (event.type === 'candidate') candidates.push(event.poi);
    if (event.type === 'phase_end' && event.durationMs !== undefined) phases[`${event.phase}#${event.round}`] = event.durationMs;
    if (event.type === 'usage') { tokensIn = event.tokensIn; tokensOut = event.tokensOut; }
    if (event.type === 'job_done') totalMs = event.durationMs;
  });
  await runGeneration(job, gc.form, { baseUrl, apiKey, model, byok: false });

  if (!job.tripId) {
    console.error(`    [${gc.id}] 生成失败：${errorMessage || `终态 ${job.status}`}`);
    return null;
  }
  const trip = await getTrip('eval-user', job.tripId);
  if (!trip) {
    console.error(`    [${gc.id}] 落库后读回失败（tripId=${job.tripId}）`);
    return null;
  }
  const snapshot: Snapshot = {
    caseId: gc.id,
    generatedAt: Date.now(),
    model,
    form: gc.form,
    trip,
    research: { candidates },
    timing: { phases, totalMs, tokensIn, tokensOut },
  };
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  fs.writeFileSync(path.join(SNAPSHOT_DIR, `${gc.id}.json`), JSON.stringify(snapshot, null, 2));
  console.log(`    [${gc.id}] 快照已落盘`);
  return snapshot;
}

function loadSnapshot(gc: GoldenCase): Snapshot | null {
  const file = path.join(SNAPSHOT_DIR, `${gc.id}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Snapshot;
}

// ---------- 主流程 ----------

const results: CaseResult[] = [];
const skipped: string[] = [];

for (const gc of cases) {
  console.log(`▶ ${gc.id} — ${gc.note}`);
  const snapshot = live ? await generateLive(gc) : loadSnapshot(gc);
  if (!snapshot) {
    skipped.push(gc.id);
    if (!live) console.log('    无快照，跳过（先 npm run eval:live 生成）');
    continue;
  }
  const result = runChecks(gc.id, snapshot.trip, gc.form, {
    candidates: snapshot.research?.candidates,
    timing: snapshot.timing,
  });
  results.push(result);
  const hard = result.hardViolations.length;
  const soft = result.softViolations.length;
  console.log(
    `    ${result.pass ? '✓ PASS' : '✗ FAIL'}｜hard ${hard}｜soft ${soft}｜结构问题 ${result.structural.length}` +
      `｜located ${(result.geo.locatedRatio * 100).toFixed(0)}%｜geocode ${(result.geo.geocodedRatio * 100).toFixed(0)}%｜amap leg ${(result.geo.amapLegRatio * 100).toFixed(0)}%`,
  );
  if (result.research) {
    const r = result.research;
    console.log(
      `    调研：候选 ${r.poolSize}（景点 ${r.categoryCounts['attraction'] ?? 0}｜美食 ${r.categoryCounts['food'] ?? 0}｜住宿 ${r.categoryCounts['hotel'] ?? 0}）｜采用率 ${(r.adoptionRatio * 100).toFixed(0)}%（${r.adoptedCount}/${r.activityCount}）`,
    );
  }
  if (result.timing && (result.timing.totalMs !== undefined || Object.keys(result.timing.phases).length > 0)) {
    const t = result.timing;
    const phaseText = Object.entries(t.phases).map(([k, ms]) => `${k} ${(ms / 1000).toFixed(0)}s`).join(' ');
    console.log(
      `    耗时：${t.totalMs !== undefined ? `总 ${(t.totalMs / 1000).toFixed(0)}s｜` : ''}${phaseText}` +
        `${t.tokensIn !== undefined ? `｜token ${t.tokensIn}/${t.tokensOut}` : ''}`,
    );
  }
  for (const v of result.hardViolations) console.log(`      [hard/${v.code}] D${v.dayIndex} ${v.message}`);
  for (const p of result.structural) console.log(`      [结构] ${p}`);
  for (const p of result.geoGate) console.log(`      [geo] ${p}`);
}

// ---------- 汇总与报告 ----------

const totalHard = results.reduce((n, r) => n + r.hardViolations.length, 0);
const totalSoft = results.reduce((n, r) => n + r.softViolations.length, 0);
const gatePass = results.length > 0 && skipped.length === 0 && results.every((r) => r.pass);

const report = {
  ranAt: new Date().toISOString(),
  mode: live ? 'live' : 'offline',
  caseFilter: caseFilter ?? null,
  gate: { pass: gatePass, totalHard, totalSoft, cases: results.length, skipped },
  results,
};
fs.mkdirSync(REPORT_DIR, { recursive: true });
const reportFile = path.join(REPORT_DIR, `${report.ranAt.replace(/[:.]/g, '-')}.json`);
fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));

console.log('\n========== 评测汇总 ==========');
console.log(`用例 ${results.length}/${cases.length}（跳过 ${skipped.length}）｜hard ${totalHard}｜soft ${totalSoft}`);
console.log(`门槛（hard=0 且结构=0 且 geo 可信 且无跳过）：${gatePass ? '✅ PASS' : '❌ FAIL'}`);
console.log(`报告：${path.relative(process.cwd(), reportFile)}`);
process.exit(gatePass ? 0 : 1);
