// 排程结果预览：跑一次真实生成，把落库行程按天打印（活动 / 通勤），用于人工检查分组质量
// 用法（apps/server 目录）：npx tsx test-schedule-preview.mts
import 'dotenv/config';
import { runGeneration } from './src/generation/orchestrator';
import { createJob, subscribe } from './src/generation/jobManager';
import { pool } from './src/db/client';
import type { GenerateForm, Trip } from '@tripweaver/shared';

const form: GenerateForm = {
  destination: '北京',
  days: 3,
  startDate: '',
  budgetLevel: 'medium',
  totalBudget: 0,
  preferences: ['历史文化'],
  partySize: 2,
  extraNotes: '',
  transportMode: 'transit',
};

let tripId: string | null = null;
let candidates = 0;
const job = createJob('rag-test-user');
subscribe(job, 0, ({ event }) => {
  if (event.type === 'candidate') candidates += 1;
  if (event.type === 'phase_end') {
    const e = event as unknown as { phase: string; summary?: string };
    if (e.summary) console.log(`[${e.phase}] ${e.summary.slice(0, 200)}`);
  }
  if (event.type === 'job_error') console.error('生成失败:', (event as { message: string }).message);
});

const cfg = {
  baseUrl: process.env.SITE_LLM_BASE_URL!,
  apiKey: process.env.SITE_LLM_API_KEY!,
  model: process.env.SITE_LLM_MODEL!,
  byok: false,
};

console.log(`模型 ${cfg.model}｜${form.destination} ${form.days} 天｜偏好 ${form.preferences.join('/')}｜非美食导向\n`);
await runGeneration(job, form, cfg);
tripId = job.tripId;

if (!tripId) {
  console.error(`未产出行程：status=${job.status}`);
  process.exit(1);
}

const { rows } = await pool.query<{ data: Trip }>('SELECT data FROM trips WHERE id = $1', [tripId]);
const trip = rows[0]?.data;
if (!trip) {
  console.error('行程未落库');
  process.exit(1);
}

console.log(`\n========== 行程预览 ==========`);
console.log(`标题 ${trip.title}｜住宿 ${trip.lodging?.name ?? '（无）'}｜候选池 ${candidates} 个\n`);
for (const day of trip.days) {
  const legs = day.legs ?? [];
  console.log(`Day${day.dayIndex}「${day.title}」活动 ${day.activities.length} 个`);
  day.activities.forEach((activity, index) => {
    const time = activity.startTime ? `${activity.startTime}-${activity.endTime} ` : '';
    const leg = legs.find((item) => item.toActivityId === activity.id);
    const via = leg ? `  ←${leg.mode} ${leg.durationMin}min(${leg.source})` : '';
    console.log(`  ${index + 1}. ${time}${activity.name} [${activity.category}]${via}`);
    console.log(`     ${activity.description.slice(0, 80)}`);
  });
  const totalLeg = legs.reduce((sum, leg) => sum + leg.durationMin, 0);
  console.log(`  通勤合计 ${totalLeg}min（${legs.length} 段）\n`);
}
if (trip.meta?.reviewNotes?.length) {
  console.log('reviewNotes：');
  for (const note of trip.meta.reviewNotes) console.log(`  - ${note}`);
}
await pool.end();
process.exit(0);
