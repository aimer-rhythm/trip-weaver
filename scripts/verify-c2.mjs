// C2 端到端验收（离线可复跑）：mock OpenAI 兼容端点驱动三 Agent 流水线
// 覆盖：SSE 三阶段与 job_done 落库 / candidate 候选池事件 / 预约种子表覆盖 / Last-Event-ID 重放 /
//       配额 429 / 取消不计数不残留 / BYOK 走自有端点且计次 / 第二轮只局部修订并保留活动 ID
// 用法：node scripts/verify-c2.mjs
// 数据库：09-18 起运行态为 PostgreSQL。本脚本独占一个专用测试库（默认 tripweaver_verify_c2，
// 可用 VERIFY_C2_DATABASE_URL 覆盖），每次运行先 drop/create 保证干净，结束时 drop 清理。
import { startMockLlm } from './lib/mock-llm.mjs';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';

const MOCK_PORT = 18788;
const API_PORT = 18791;
const API = `http://127.0.0.1:${API_PORT}`;
const DATABASE_URL =
  process.env.VERIFY_C2_DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/tripweaver_verify_c2';
const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { Client } = requireFromServer('pg');

const failures = [];
function check(name, cond, extra = '') {
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures.push(name);
}

// ---------- 测试库管理 ----------

/** 解析出库名，并返回连到 postgres 维护库的连接串（drop/create 需在库外执行） */
function adminUrlAndDbName(url) {
  const u = new URL(url);
  const dbName = u.pathname.replace(/^\//, '');
  if (!dbName || dbName === 'postgres') throw new Error('VERIFY_C2_DATABASE_URL 必须指向专用测试库，禁止 postgres');
  u.pathname = '/postgres';
  return { adminUrl: u.toString(), dbName };
}

async function dropDatabase(adminClient, dbName) {
  // PG 13+ 支持 WITH (FORCE)，自动断开存量连接
  await adminClient.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
}

async function recreateTestDatabase() {
  const { adminUrl, dbName } = adminUrlAndDbName(DATABASE_URL);
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await dropDatabase(admin, dbName);
    await admin.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.end();
  }
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
// 每次运行先重建测试库（drop + create），避免上一轮残留影响幂等迁移断言。
await recreateTestDatabase();
const legacyClient = new Client({ connectionString: DATABASE_URL });
await legacyClient.connect();
try {
  await legacyClient.query(`CREATE TABLE trips (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    destination TEXT NOT NULL,
    days_count INTEGER NOT NULL,
    activity_count INTEGER NOT NULL,
    total_cost INTEGER NOT NULL,
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
  )`);
  await legacyClient.query(`CREATE TABLE generations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    trip_id TEXT,
    status TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
  )`);
} finally {
  await legacyClient.end();
}

// 首个完成任务让审校模型持续 get_draft 直到超过 12 轮，验证审校耗尽只降级、不拖垮整次生成。
const mock = await startMockLlm(MOCK_PORT, { delayMs: 300, reviewerOverrunOnce: true, requestRevisionOnce: true });
const seenAuthHeaders = mock.seenAuthHeaders;
console.log(`[mock] OpenAI 兼容端点就绪 :${MOCK_PORT}`);
try {
  server = spawn(process.execPath, ['../../node_modules/tsx/dist/cli.mjs', 'src/index.ts'], {
    cwd: 'apps/server',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: 'development',
      // 隔离真实 .env：PG 连接由 DATABASE_URL 显式指定，不再依赖 sqlite 文件路径
      DOTENV_CONFIG_PATH: `./data/verify-c2-${Date.now()}.absent.env`,
      PORT: String(API_PORT),
      DATABASE_URL,
      MASTER_KEY: crypto.randomBytes(32).toString('hex'),
      REGISTRATION_MODE: 'invite',
      INVITE_CODE: 'C2TEST',
      GITHUB_CLIENT_ID: '',
      GITHUB_CLIENT_SECRET: '',
      APP_BASE_URL: '',
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
    '文案阶段未触发结构修订轮',
    run.events.filter((event) => event.type === 'phase_start' && event.phase === 'plan').length === 1,
  );
  const reviewPhaseEnd = run.events.find((event) => event.type === 'phase_end' && event.phase === 'review');
  check('review 阶段已降为文案阶段', reviewPhaseEnd?.summary?.includes('文案') === true, reviewPhaseEnd?.summary);

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
  check('活动已填充', trip.json?.days?.every((d) => d.activities.length >= 1));
  check('overview 随行程持久化', Array.isArray(trip.json?.overview) && trip.json.overview.length === 3, `overview=${trip.json?.overview?.length}`);
  check('overview 预约徽章数据正确', trip.json?.overview?.find((p) => p.name === '故宫博物院')?.reservation === 'required');
  check('meta.dataSources 未配 Key 时不写入', trip.json?.meta?.dataSources === undefined, JSON.stringify(trip.json?.meta));
  // ST3：transportMode 缺省 transit 持久化；住宿区域由代码推导（用户未填时取知识库住宿候选）。
  // 坐标解析走高德→Nominatim 降级链：本脚本无高德 Key，Nominatim 视网络可用性可能成功——
  // 两种结果都合法，按「有坐标 ⇔ 有住宿哨兵 leg」的一致性断言（哨兵契约见 TransitLegSchema）。
  check('transportMode 缺省 transit 持久化', trip.json?.transportMode === 'transit', trip.json?.transportMode);
  check('住宿区域由代码推导自知识库住宿候选', trip.json?.lodging?.name === '测试酒店', JSON.stringify(trip.json?.lodging));
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
  const planRounds = runD.events.filter((event) => event.type === 'phase_start' && event.phase === 'plan').map((event) => event.round);
  check('确定性排程只跑一轮（无修订轮）', planRounds.join(',') === '1', planRounds.join(','));
  const structureTools = ['set_trip_skeleton', 'add_activity', 'update_activity', 'move_activity', 'remove_activity', 'check_feasibility', 'submit_plan'];
  const structureCalls = runD.events.filter((event) => event.type === 'tool_start' && structureTools.includes(event.tool)).map((event) => event.tool);
  check('排程阶段零 LLM 规划工具（结构由代码决定）', structureCalls.length === 0, structureCalls.join(','));
  const writer = mock.seenWriter;
  check(
    '文案阶段拿到草稿且工具面仅 get_draft / update_description / submit_review',
    Boolean(writer?.hasDraft)
      && JSON.stringify(writer?.tools ?? []) === JSON.stringify(['get_draft', 'submit_review', 'update_description']),
    JSON.stringify(writer?.tools),
  );
  const revisedTrip = await api('GET', `/api/trips/${runD.events.at(-1)?.tripId}`);
  const revisedActivities = revisedTrip.json?.days?.flatMap((day) => day.activities) ?? [];
  check('文案改写已落库', revisedActivities.some((activity) => activity.description.startsWith('文案阶段改写')));
  check('排程保证每天至少一个活动', (revisedTrip.json?.days ?? []).every((day) => day.activities.length >= 1));
  check(
    '行程不产出时间轴（时间留空，前端按未排时刻展示）',
    revisedActivities.every((activity) => activity.startTime === '' && activity.endTime === ''),
    JSON.stringify(revisedActivities.map((activity) => `${activity.startTime}-${activity.endTime}`)),
  );
  check('生成内部定位引用未泄漏到持久化 Trip', revisedActivities.length > 0 && revisedActivities.every((activity) => !('placeName' in activity) && !('poiId' in activity)));
  const byokAuths = seenAuthHeaders.slice(authCountBefore);
  check('BYOK 请求带自己的 Key', byokAuths.length > 0 && byokAuths.every((a) => a.includes('byok-secret-key')), byokAuths[0]);
  const usage2 = await api('GET', '/api/usage');
  check('BYOK 计入次数配额', usage2.json?.usedToday === 1, `usedToday=${usage2.json?.usedToday}`);

  // ⑤ generations 表落库核对（直接查 PG）
  console.log('\n— generations 表 —');
  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();
  try {
    const colsOf = async (table) =>
      (await db.query('select column_name from information_schema.columns where table_schema = current_schema() and table_name = $1', [table]))
        .rows.map((r) => r.column_name);
    const tripColumns = await colsOf('trips');
    check('存量 trips 表迁移补齐 used_xhs', tripColumns.includes('used_xhs'), tripColumns.join(','));
    const persistedTrip = (await db.query('select used_xhs from trips where id = $1', [done.tripId])).rows[0];
    check('迁移后行程写入 used_xhs 成功', persistedTrip?.used_xhs === false, `used_xhs=${persistedTrip?.used_xhs}`);
    const generationColumns = await colsOf('generations');
    check(
      '存量 generations 表迁移补齐审计列',
      ['used_xhs', 'used_byok', 'tokens_in', 'tokens_out', 'xhs_calls', 'amap_calls', 'search_calls'].every((column) =>
        generationColumns.includes(column),
      ),
      generationColumns.join(','),
    );
    const rows = (
      await db.query('select status, used_byok, tokens_in, tokens_out, amap_calls, search_calls, trip_id from generations order by created_at')
    ).rows;
    check('三行记录（cancelled/done/done）', rows.length === 3, JSON.stringify(rows.map((r) => r.status)));
    check('cancelled 无 trip', rows[0]?.status === 'cancelled' && rows[0]?.trip_id === null);
    check('done 有 token 用量', rows[1]?.status === 'done' && rows[1].tokens_in > 0 && rows[1].tokens_out > 0, `in=${rows[1]?.tokens_in} out=${rows[1]?.tokens_out}`);
    check('Null 源不烧数据源额度', rows[1]?.amap_calls === 0 && rows[1]?.search_calls === 0, `amap=${rows[1]?.amap_calls} search=${rows[1]?.search_calls}`);
    check('BYOK 行 used_byok=true', rows[2]?.used_byok === true);
  } finally {
    await db.end();
  }

  console.log(failures.length ? `\nFAIL：${failures.length} 项未过` : '\nPASS —— C2 验收全过');
} catch (err) {
  console.error('\n[verify-c2] 异常终止：', err);
  failures.push('脚本异常');
} finally {
  mock.close();
  server?.kill();
  await sleep(500);
  // 清理：杀掉服务后 drop 整个测试库（比 truncate 更干净，也避免下轮遗留 schema 漂移）
  try {
    const { adminUrl, dbName } = adminUrlAndDbName(DATABASE_URL);
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await dropDatabase(admin, dbName);
    } finally {
      await admin.end();
    }
  } catch {}
}
process.exit(failures.length ? 1 : 0);
