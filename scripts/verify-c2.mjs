// C2 端到端验收（离线可复跑）：mock OpenAI 兼容端点驱动三 Agent 流水线
// 覆盖：SSE 三阶段与 job_done 落库 / Last-Event-ID 重放 / 配额 429 / 取消不计数不残留 / BYOK 走自有端点且计次
// 用法：node scripts/verify-c2.mjs
import { startMockLlm } from './lib/mock-llm.mjs';
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';

const MOCK_PORT = 18788;
const API_PORT = 18791;
const API = `http://127.0.0.1:${API_PORT}`;
const DB_FILE = `./data/verify-c2-${Date.now()}.db`;

const failures = [];
function check(name, cond, extra = '') {
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures.push(name);
}


// ---------- HTTP 小工具 ----------

let cookie = '';
async function api(method, path, body, extraHeaders = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      cookie,
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, json };
}

/** 读 SSE 直到终态事件或超时；返回 {events, lastId} */
async function readEvents(jobId, { lastEventId = 0, timeoutMs = 30000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const events = [];
  let lastId = lastEventId;
  try {
    const res = await fetch(`${API}/api/generations/${jobId}/events?lastEventId=${lastEventId}`, {
      headers: { cookie },
      signal: controller.signal,
    });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    outer: while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const idLine = frame.split('\n').find((l) => l.startsWith('id: '));
        const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
        if (!dataLine) continue;
        if (idLine) lastId = Number(idLine.slice(4));
        const ev = JSON.parse(dataLine.slice(6));
        events.push(ev);
        if (['job_done', 'job_error', 'job_cancelled'].includes(ev.type)) break outer;
      }
    }
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  return { events, lastId };
}

// ---------- 主流程 ----------

let server;
const mock = await startMockLlm(MOCK_PORT, { delayMs: 300 });
const seenAuthHeaders = mock.seenAuthHeaders;
console.log(`[mock] OpenAI 兼容端点就绪 :${MOCK_PORT}`);
try {
  server = spawn(process.execPath, ['../../node_modules/tsx/dist/cli.mjs', 'src/index.ts'], {
    cwd: 'apps/server',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(API_PORT),
      DATABASE_PATH: DB_FILE,
      MASTER_KEY: crypto.randomBytes(32).toString('hex'),
      INVITE_CODE: 'C2TEST',
      SITE_LLM_BASE_URL: `http://127.0.0.1:${MOCK_PORT}/v1`,
      SITE_LLM_API_KEY: 'site-mock-key',
      SITE_LLM_MODEL: 'mock-chat',
      GEN_DAILY_LIMIT: '1',
      XHS_MCP_URL: '',
      SSRF_ALLOWLIST: `127.0.0.1:${MOCK_PORT}`,
      NO_PROXY: 'localhost,127.0.0.1',
    },
  });
  server.stdout.on('data', () => {});
  server.stderr.on('data', (d) => process.env.VERBOSE && console.error(String(d)));

  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${API}/api/health`);
      if (r.ok) break;
    } catch {}
    await sleep(500);
    if (i === 119) throw new Error('服务端启动超时');
  }
  console.log('[api] 服务端就绪');

  // 用户 1：站点 Key 路径
  const email = `u${Date.now()}@test.dev`;
  const reg = await api('POST', '/api/auth/register', { email, password: 'password123', inviteCode: 'C2TEST' });
  check('注册成功', reg.status === 200 || reg.status === 201, `status=${reg.status}`);

  // ① 取消：不残留、不计数
  console.log('\n— 取消路径 —');
  const jobA = await api('POST', '/api/generations', { destination: '东京', days: 2, budgetLevel: '经济', partySize: 1 });
  check('建任务 A 202', jobA.status === 202, JSON.stringify(jobA.json));
  const cancelRes = await api('POST', `/api/generations/${jobA.json.jobId}/cancel`);
  check('取消 202', cancelRes.status === 202);
  const cancelled = await readEvents(jobA.json.jobId);
  check('收到 job_cancelled', cancelled.events.at(-1)?.type === 'job_cancelled', cancelled.events.at(-1)?.type);
  const usageAfterCancel = await api('GET', '/api/usage');
  check('取消不计配额', usageAfterCancel.json?.usedToday === 0, `usedToday=${usageAfterCancel.json?.usedToday}`);

  // ② 完整流水线：三阶段 + job_done 落库
  console.log('\n— 完整流水线（站点 Key）—');
  const jobB = await api('POST', '/api/generations', { destination: '东京', days: 2, budgetLevel: '经济', partySize: 1 });
  check('取消后可立即新建（无残留）', jobB.status === 202, `status=${jobB.status}`);
  const run = await readEvents(jobB.json.jobId);
  const types = run.events.map((e) => e.type);
  const phases = run.events.filter((e) => e.type === 'phase_start').map((e) => e.phase);
  check('三阶段齐全', ['research', 'plan', 'review'].every((p) => phases.includes(p)), phases.join(','));
  check('有工具时间线', types.includes('tool_start') && types.includes('tool_end'));
  check('有用量事件', types.includes('usage'));
  const done = run.events.at(-1);
  check('job_done 收尾', done?.type === 'job_done', done?.type);
  check('降级标注 usedXhs=false', done?.usedXhs === false);
  check('审校建议传递', Array.isArray(done?.reviewNotes) && done.reviewNotes.length > 0, JSON.stringify(done?.reviewNotes));

  const trip = await api('GET', `/api/trips/${done.tripId}`);
  check('行程已落库', trip.status === 200 && trip.json?.days?.length === 2, `days=${trip.json?.days?.length}`);
  check('活动已填充', trip.json?.days?.every((d) => d.activities.length === 3));

  // Last-Event-ID 重放（终态任务在 TTL 内可全量重放）
  const replay = await readEvents(jobB.json.jobId, { lastEventId: 0 });
  check('SSE 全量重放', replay.events.at(-1)?.type === 'job_done', `events=${replay.events.length}`);
  const partial = await readEvents(jobB.json.jobId, { lastEventId: run.lastId - 1 });
  check('Last-Event-ID 增量重放', partial.events.length === 1 && partial.events[0].type === 'job_done', `events=${partial.events.length}`);

  // 快照端点
  const snap = await api('GET', `/api/generations/${jobB.json.jobId}`);
  check('快照 done+tripId', snap.json?.status === 'done' && snap.json?.tripId === done.tripId);

  // ③ 配额用尽 → 429 + resetAt
  console.log('\n— 配额路径 —');
  const usage = await api('GET', '/api/usage');
  check('usedToday=1', usage.json?.usedToday === 1, `usedToday=${usage.json?.usedToday}`);
  const jobC = await api('POST', '/api/generations', { destination: '东京', days: 2, budgetLevel: '经济', partySize: 1 });
  check('配额尽 429', jobC.status === 429, `status=${jobC.status}`);
  check('429 带 resetAt', typeof jobC.json?.resetAt === 'number');

  // ④ BYOK：走自有端点 + 计次
  console.log('\n— BYOK 路径 —');
  cookie = '';
  const email2 = `b${Date.now()}@test.dev`;
  await api('POST', '/api/auth/register', { email: email2, password: 'password123', inviteCode: 'C2TEST' });
  const put = await api('PUT', '/api/settings', {
    byokEnabled: true,
    baseUrl: `http://127.0.0.1:${MOCK_PORT}/v1`,
    apiKey: 'byok-secret-key',
    model: 'mock-chat',
  });
  check('BYOK 设置保存（SSRF 白名单放行）', put.status === 200, JSON.stringify(put.json));
  const authCountBefore = seenAuthHeaders.length;
  const jobD = await api('POST', '/api/generations', { destination: '大阪', days: 2, budgetLevel: '舒适', partySize: 2 });
  check('BYOK 建任务 202', jobD.status === 202);
  const runD = await readEvents(jobD.json.jobId);
  check('BYOK job_done', runD.events.at(-1)?.type === 'job_done', runD.events.at(-1)?.type);
  const byokAuths = seenAuthHeaders.slice(authCountBefore);
  check('BYOK 请求带自己的 Key', byokAuths.length > 0 && byokAuths.every((a) => a.includes('byok-secret-key')), byokAuths[0]);
  const usage2 = await api('GET', '/api/usage');
  check('BYOK 计入次数配额', usage2.json?.usedToday === 1, `usedToday=${usage2.json?.usedToday}`);

  // ⑤ generations 表落库核对（直接读 SQLite）
  console.log('\n— generations 表 —');
  const require2 = createRequire(new URL('../apps/server/package.json', import.meta.url));
  const Database = require2('better-sqlite3');
  const db = new Database(`apps/server/${DB_FILE.replace('./', '')}`, { readonly: true });
  const rows = db.prepare('select status, used_byok, tokens_in, tokens_out, xhs_calls, trip_id from generations order by created_at').all();
  db.close();
  check('三行记录（cancelled/done/done）', rows.length === 3, JSON.stringify(rows.map((r) => r.status)));
  check('cancelled 无 trip', rows[0]?.status === 'cancelled' && rows[0]?.trip_id === null);
  check('done 有 token 用量', rows[1]?.status === 'done' && rows[1].tokens_in > 0 && rows[1].tokens_out > 0, `in=${rows[1]?.tokens_in} out=${rows[1]?.tokens_out}`);
  check('BYOK 行 used_byok=1', rows[2]?.used_byok === 1);

  console.log(failures.length ? `\nFAIL：${failures.length} 项未过` : '\nPASS —— C2 验收全过');
} catch (err) {
  console.error('\n[verify-c2] 异常终止：', err);
  failures.push('脚本异常');
} finally {
  mock.close();
  server?.kill();
  await sleep(300);
  try {
    rmSync(`apps/server/${DB_FILE.replace('./', '')}`, { force: true });
    rmSync(`apps/server/${DB_FILE.replace('./', '')}-shm`, { force: true });
    rmSync(`apps/server/${DB_FILE.replace('./', '')}-wal`, { force: true });
  } catch {}
}
process.exit(failures.length ? 1 : 0);
