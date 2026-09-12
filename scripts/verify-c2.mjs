// C2 端到端验收（离线可复跑）：mock OpenAI 兼容端点驱动三 Agent 流水线
// 覆盖：SSE 三阶段与 job_done 落库 / candidate 候选池事件 / 预约种子表覆盖 / Last-Event-ID 重放 /
//       配额 429 / 取消不计数不残留 / BYOK 走自有端点且计次
// 用法：node scripts/verify-c2.mjs
import { startMockLlm } from './lib/mock-llm.mjs';
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';

const MOCK_PORT = 18788;
const API_PORT = 18791;
const API = `http://127.0.0.1:${API_PORT}`;
const DB_FILE = `./data/verify-c2-${Date.now()}.db`;
const DATABASE_PATH = `apps/server/${DB_FILE.replace('./', '')}`;
const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
const Database = requireFromServer('better-sqlite3');

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
// 模拟存量库：旧 trips / generations 表缺少当前列，启动迁移必须自动补齐。
// Clean checkouts (e.g. CI) do not have the data/ dir yet — better-sqlite3 requires
// the parent directory to exist before opening a database file. Compute the parent
// programmatically from DATABASE_PATH and create it recursively (idempotent on Windows local runs).
mkdirSync(dirname(DATABASE_PATH), { recursive: true });
const legacyDatabase = new Database(DATABASE_PATH);
legacyDatabase.exec(`CREATE TABLE trips (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  destination TEXT NOT NULL,
  days_count INTEGER NOT NULL,
  activity_count INTEGER NOT NULL,
  total_cost INTEGER NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE generations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  trip_id TEXT,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL
)`);
legacyDatabase.close();

// 首个完成任务让审校模型持续 get_draft 直到超过 12 轮，验证审校耗尽只降级、不拖垮整次生成。
const mock = await startMockLlm(MOCK_PORT, { delayMs: 300, reviewerOverrunOnce: true });
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
      AMAP_KEY: '',
      SEARCH_API_KEY: '',
      SSRF_ALLOWLIST: `127.0.0.1:${MOCK_PORT}`,
      // Keep this verification offline and deterministic: localhost reaches the mock LLM,
      // while optional public geocoding fails fast into its documented null fallback.
      HTTP_PROXY: 'http://127.0.0.1:1',
      HTTPS_PROXY: 'http://127.0.0.1:1',
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
  check('取消事件携带 reason=user', cancelled.events.at(-1)?.reason === 'user', String(cancelled.events.at(-1)?.reason));
  const cancelledSnapshot = await api('GET', `/api/generations/${jobA.json.jobId}`);
  check('取消快照收敛到 cancelled', cancelledSnapshot.json?.status === 'cancelled', cancelledSnapshot.json?.status);
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
  check('job_done 数据源为空（未配 Key）', Array.isArray(done?.dataSources) && done.dataSources.length === 0, JSON.stringify(done?.dataSources));
  check('审校建议传递', Array.isArray(done?.reviewNotes) && done.reviewNotes.length > 0, JSON.stringify(done?.reviewNotes));
  check(
    '审校轮次超限降级后仍完成生成',
    done?.reviewNotes?.some((note) => note.includes('审校模型达到单阶段轮次上限')) === true,
    JSON.stringify(done?.reviewNotes),
  );

  // 时序前移（M0-A）：geoPipeline 移到审校前 —— 坐标/通勤解析的 thought 必须出现在首个 review phase_start 之前，
  // 保证审校（及可行性引擎）拿到的是已解析的真实坐标/leg，而非空坐标。
  const firstReviewIdx = run.events.findIndex((e) => e.type === 'phase_start' && e.phase === 'review');
  const geoResolveIdx = run.events.findIndex((e) => e.type === 'thought' && /解析坐标与通勤|解析活动坐标/.test(e.text ?? ''));
  check(
    '坐标/通勤在审校前已解析（时序前移）',
    geoResolveIdx >= 0 && firstReviewIdx >= 0 && geoResolveIdx < firstReviewIdx,
    `geoIdx=${geoResolveIdx} reviewIdx=${firstReviewIdx}`,
  );
  check(
    '解析发生在编排阶段（thought 归属 plan）',
    run.events[geoResolveIdx]?.phase === 'plan',
    run.events[geoResolveIdx]?.phase,
  );

  // 候选池 SSE 事件：mock 调 4 次 add_candidate（1 次同名去重）→ 3 条 candidate
  const candidates = run.events.filter((e) => e.type === 'candidate');
  check('candidate 事件 3 条（同名去重）', candidates.length === 3, `count=${candidates.length}`);
  const gugong = candidates.find((e) => e.poi?.name === '故宫博物院');
  check('预约种子表强制覆盖 required', gugong?.poi?.reservation === 'required', gugong?.poi?.reservation);
  check('种子来源链接注入', gugong?.poi?.sourceLinks?.[0]?.url?.includes('dpm.org.cn') === true, JSON.stringify(gugong?.poi?.sourceLinks));
  check('candidate 三类齐全', ['attraction', 'food', 'hotel'].every((c) => candidates.some((e) => e.poi?.category === c)));

  const trip = await api('GET', `/api/trips/${done.tripId}`);
  check('行程已落库', trip.status === 200 && trip.json?.days?.length === 2, `days=${trip.json?.days?.length}`);
  check('活动已填充', trip.json?.days?.every((d) => d.activities.length === 3));
  check('overview 随行程持久化', Array.isArray(trip.json?.overview) && trip.json.overview.length === 3, `overview=${trip.json?.overview?.length}`);
  check('overview 预约徽章数据正确', trip.json?.overview?.find((p) => p.name === '故宫博物院')?.reservation === 'required');
  check('meta.dataSources 未配 Key 时不写入', trip.json?.meta?.dataSources === undefined, JSON.stringify(trip.json?.meta));
  // ST3：transportMode 缺省 transit 持久化；set_lodging 建议区域落 Trip.lodging。
  // 坐标解析走高德→Nominatim 降级链：本脚本无高德 Key，Nominatim 视网络可用性可能成功——
  // 两种结果都合法，按「有坐标 ⇔ 有住宿哨兵 leg」的一致性断言（哨兵契约见 TransitLegSchema）。
  check('transportMode 缺省 transit 持久化', trip.json?.transportMode === 'transit', trip.json?.transportMode);
  check('lodging 建议区域持久化', trip.json?.lodging?.name === '市中心站前区域', JSON.stringify(trip.json?.lodging));
  const lodgingHasCoord = typeof trip.json?.lodging?.lat === 'number' && typeof trip.json?.lodging?.lng === 'number';
  const sentinelConsistent = trip.json?.days?.every((d) => {
    const legs = d.legs ?? [];
    const dep = legs.some((l) => l.fromActivityId === 'lodging' && l.toActivityId === d.activities[0]?.id);
    const ret = legs.some((l) => l.toActivityId === 'lodging' && l.fromActivityId === d.activities.at(-1)?.id);
    return lodgingHasCoord ? dep && ret : !legs.some((l) => l.fromActivityId === 'lodging' || l.toActivityId === 'lodging');
  });
  check(
    `住宿哨兵 leg 与坐标解析结果一致（本次${lodgingHasCoord ? '解析成功→首尾住宿 leg' : '解析失败→无住宿 leg，不报错'}）`,
    sentinelConsistent === true,
  );

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
  const db = new Database(DATABASE_PATH, { readonly: true });
  const tripColumns = db.pragma('table_info(trips)').map((column) => column.name);
  check('存量 trips 表迁移补齐 used_xhs', tripColumns.includes('used_xhs'), tripColumns.join(','));
  const persistedTrip = db.prepare('select used_xhs from trips where id = ?').get(done.tripId);
  check('迁移后行程写入 used_xhs 成功', persistedTrip?.used_xhs === 0, `used_xhs=${persistedTrip?.used_xhs}`);
  const generationColumns = db.pragma('table_info(generations)').map((column) => column.name);
  check(
    '存量 generations 表迁移补齐审计列',
    ['used_xhs', 'used_byok', 'tokens_in', 'tokens_out', 'xhs_calls', 'amap_calls', 'search_calls'].every((column) =>
      generationColumns.includes(column),
    ),
    generationColumns.join(','),
  );
  const rows = db.prepare('select status, used_byok, tokens_in, tokens_out, amap_calls, search_calls, trip_id from generations order by created_at').all();
  db.close();
  check('三行记录（cancelled/done/done）', rows.length === 3, JSON.stringify(rows.map((r) => r.status)));
  check('cancelled 无 trip', rows[0]?.status === 'cancelled' && rows[0]?.trip_id === null);
  check('done 有 token 用量', rows[1]?.status === 'done' && rows[1].tokens_in > 0 && rows[1].tokens_out > 0, `in=${rows[1]?.tokens_in} out=${rows[1]?.tokens_out}`);
  check('Null 源不烧数据源额度', rows[1]?.amap_calls === 0 && rows[1]?.search_calls === 0, `amap=${rows[1]?.amap_calls} search=${rows[1]?.search_calls}`);
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
    rmSync(DATABASE_PATH, { force: true });
    rmSync(`${DATABASE_PATH}-shm`, { force: true });
    rmSync(`${DATABASE_PATH}-wal`, { force: true });
  } catch {}
}
process.exit(failures.length ? 1 : 0);
