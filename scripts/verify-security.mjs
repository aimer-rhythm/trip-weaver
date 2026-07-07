// D2 安全走查（自动化）：横向越权 / 限流 / Key 不见于响应·日志·库文件 / Cookie 属性 / ssrfGuard / 邀请码
// 运行：node scripts/verify-security.mjs
import { spawn } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import crypto from 'node:crypto';
import { startMockLlm } from './lib/mock-llm.mjs';

const MOCK_PORT = 18788;
const DEV_PORT = 18791;
const PROD_PORT = 18792;
const DEV = `http://127.0.0.1:${DEV_PORT}`;
const DB_FILE = `./data/verify-sec-${Date.now()}.db`;
const SECRET_KEY = `sk-SECRET-${crypto.randomBytes(8).toString('hex')}`;

const failures = [];
function check(name, cond, extra = '') {
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures.push(name);
}

let serverLog = '';
function spawnServer(port, nodeEnv, dbFile) {
  const child = spawn(process.execPath, ['../../node_modules/tsx/dist/cli.mjs', 'src/index.ts'], {
    cwd: 'apps/server',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: nodeEnv,
      PORT: String(port),
      DATABASE_PATH: dbFile,
      MASTER_KEY: crypto.randomBytes(32).toString('hex'),
      INVITE_CODE: 'SECTEST',
      SITE_LLM_BASE_URL: `http://127.0.0.1:${MOCK_PORT}/v1`,
      SITE_LLM_API_KEY: 'site-mock-key',
      SITE_LLM_MODEL: 'mock-chat',
      GEN_DAILY_LIMIT: '5',
      XHS_MCP_URL: '',
      SSRF_ALLOWLIST: `127.0.0.1:${MOCK_PORT}`,
      NO_PROXY: 'localhost,127.0.0.1',
    },
  });
  child.stdout.on('data', (d) => (serverLog += String(d)));
  child.stderr.on('data', (d) => (serverLog += String(d)));
  return child;
}

async function waitHealth(base) {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch {}
    await sleep(500);
  }
  throw new Error(`服务端启动超时：${base}`);
}

/** 简单 cookie-jar 客户端 */
function makeClient(base) {
  let cookie = '';
  return {
    get lastCookieHeader() {
      return cookie;
    },
    async call(method, path, body, rawCookie) {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          cookie: rawCookie ?? cookie,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const setCookie = res.headers.get('set-cookie') ?? '';
      if (setCookie && rawCookie === undefined) cookie = setCookie.split(';')[0];
      let json = null;
      try {
        json = await res.json();
      } catch {}
      return { status: res.status, json, setCookie };
    },
  };
}

function minimalTripExport(title) {
  const now = Date.now();
  return {
    version: 2,
    trip: {
      id: 'x',
      title,
      destination: '测试地',
      startDate: '',
      budgetLevel: '经济',
      totalBudget: 0,
      preferences: [],
      partySize: 1,
      extraNotes: '',
      days: [{ id: 'd1', dayIndex: 1, title: '', activities: [] }],
      meta: { usedXhs: false, reviewNotes: [] },
      createdAt: now,
      updatedAt: now,
    },
  };
}

const mock = await startMockLlm(MOCK_PORT, { delayMs: 800 });
const devServer = spawnServer(DEV_PORT, 'development', DB_FILE);
const prodServer = spawnServer(PROD_PORT, 'production', `${DB_FILE}.prod.db`);

try {
  await Promise.all([waitHealth(DEV), waitHealth(`http://127.0.0.1:${PROD_PORT}`)]);
  console.log('[api] dev/prod 双实例就绪\n— 邀请码与注册限流 —');

  const A = makeClient(DEV);
  const B = makeClient(DEV);

  const regA = await A.call('POST', '/api/auth/register', { email: 'a@sec.dev', password: 'password123', inviteCode: 'SECTEST' });
  check('正确邀请码注册通过', regA.status === 201);
  check('Cookie: HttpOnly + SameSite=Lax（开发态无 Secure）', /HttpOnly/i.test(regA.setCookie) && /SameSite=Lax/i.test(regA.setCookie) && !/Secure/i.test(regA.setCookie), regA.setCookie.replace(/tw_session=[^;]+/, 'tw_session=***'));

  const regB = await B.call('POST', '/api/auth/register', { email: 'b@sec.dev', password: 'password123', inviteCode: 'SECTEST' });
  check('第二账号注册通过', regB.status === 201);
  const regBad = await A.call('POST', '/api/auth/register', { email: 'c@sec.dev', password: 'password123', inviteCode: 'WRONG' }, '');
  check('错误邀请码被拒 403', regBad.status === 403, `status=${regBad.status}`);
  const regLimited = await A.call('POST', '/api/auth/register', { email: 'd@sec.dev', password: 'password123', inviteCode: 'SECTEST' }, '');
  check('注册限流（第 4 次/分钟 → 429）', regLimited.status === 429, `status=${regLimited.status}`);

  console.log('— 登录限流与失败文案 —');
  let last = null;
  for (let i = 0; i < 6; i++) {
    last = await A.call('POST', '/api/auth/login', { email: 'a@sec.dev', password: 'wrong-password' }, '');
  }
  check('登录限流（第 6 次/分钟 → 429）', last.status === 429, `status=${last.status}`);
  const probe = await A.call('POST', '/api/auth/login', { email: 'ghost@sec.dev', password: 'x'.repeat(10) }, '');
  check('登录失败不泄露账号存在性', probe.json?.error === '邮箱或密码不正确' || probe.status === 429, JSON.stringify(probe.json));

  console.log('— 未登录与横向越权 —');
  const anon = await A.call('GET', '/api/trips', undefined, '');
  check('未登录访问 401', anon.status === 401);

  const created = await A.call('POST', '/api/trips', minimalTripExport('A 的行程'));
  check('A 建行程', created.status === 200 || created.status === 201, `status=${created.status}`);
  const tripId = created.json?.id;
  const bGet = await B.call('GET', `/api/trips/${tripId}`);
  const bPut = await B.call('PUT', `/api/trips/${tripId}`, created.json);
  const bDel = await B.call('DELETE', `/api/trips/${tripId}`);
  check('B 读/改/删 A 的行程均 404', bGet.status === 404 && bPut.status === 404 && bDel.status === 404, `${bGet.status}/${bPut.status}/${bDel.status}`);
  const bList = await B.call('GET', '/api/trips');
  check('B 列表看不到 A 数据', Array.isArray(bList.json) && bList.json.length === 0);

  console.log('— 生成任务越权 —');
  const jobRes = await A.call('POST', '/api/generations', { destination: '东京', days: 1, budgetLevel: '经济', partySize: 1 });
  check('A 建生成任务', jobRes.status === 202, `status=${jobRes.status}`);
  const jobId = jobRes.json?.jobId;
  const bJob = await B.call('GET', `/api/generations/${jobId}`);
  const bCancel = await B.call('POST', `/api/generations/${jobId}/cancel`);
  const bSse = await fetch(`${DEV}/api/generations/${jobId}/events`, { headers: { cookie: B.lastCookieHeader } });
  check('B 访问 A 的任务快照/取消/SSE 均 404', bJob.status === 404 && bCancel.status === 404 && bSse.status === 404, `${bJob.status}/${bCancel.status}/${bSse.status}`);
  await A.call('POST', `/api/generations/${jobId}/cancel`);

  console.log('— SSRF 双查与 Key 泄露 —');
  for (const bad of ['http://192.168.1.1/v1', 'http://localhost:9999/v1', 'ftp://example.com/v1', 'http://127.0.0.1:1/v1']) {
    const res = await A.call('PUT', '/api/settings', { byokEnabled: false, baseUrl: bad, model: 'm' });
    check(`SSRF 拦截：${bad}`, res.status === 400, `status=${res.status}`);
  }
  const allowRes = await A.call('PUT', '/api/settings', {
    byokEnabled: true,
    baseUrl: `http://127.0.0.1:${MOCK_PORT}/v1`,
    apiKey: SECRET_KEY,
    model: 'mock-chat',
  });
  check('SSRF 白名单放行 BYOK 保存', allowRes.status === 200, JSON.stringify(allowRes.json));
  const settingsView = await A.call('GET', '/api/settings');
  const viewStr = JSON.stringify(settingsView.json);
  check('设置响应仅回显 last4', viewStr.includes(SECRET_KEY.slice(-4)) && !viewStr.includes(SECRET_KEY), viewStr.slice(0, 120));

  // BYOK 生成一次，让 Key 流经模型调用路径，再验证日志
  const byokJob = await A.call('POST', '/api/generations', { destination: '东京', days: 1, budgetLevel: '经济', partySize: 1 });
  if (byokJob.status === 202) {
    await sleep(4000);
    await A.call('POST', `/api/generations/${byokJob.json.jobId}/cancel`);
  }
  await sleep(500);
  check('Key 不见于服务端日志', !serverLog.includes(SECRET_KEY), `日志 ${serverLog.length} 字节`);
  const dbRaw = readFileSync(`apps/server/${DB_FILE.replace('./', '')}`, 'latin1');
  check('Key 不以明文落库（AES-256-GCM）', !dbRaw.includes(SECRET_KEY));
  check('mock 收到过 BYOK Key（证明确实流经了调用路径）', mock.seenAuthHeaders.some((h) => h.includes(SECRET_KEY)) || byokJob.status !== 202, `calls=${mock.seenAuthHeaders.length}`);

  console.log('— 生产实例 Cookie Secure —');
  const P = makeClient(`http://127.0.0.1:${PROD_PORT}`);
  const regP = await P.call('POST', '/api/auth/register', { email: 'p@sec.dev', password: 'password123', inviteCode: 'SECTEST' });
  check('生产态 Cookie 含 Secure', regP.status === 201 && /Secure/i.test(regP.setCookie), regP.setCookie.replace(/tw_session=[^;]+/, 'tw_session=***'));

  console.log(failures.length ? `\nFAIL：${failures.length} 项未过` : '\nPASS —— 安全走查全过');
} catch (err) {
  console.error('\n[verify-security] 异常终止：', err);
  failures.push('脚本异常');
} finally {
  mock.close();
  devServer.kill();
  prodServer.kill();
  await sleep(800);
  for (const f of [DB_FILE, `${DB_FILE}.prod.db`]) {
    for (const suffix of ['', '-shm', '-wal']) {
      try {
        rmSync(`apps/server/${f.replace('./', '')}${suffix}`, { force: true });
      } catch {}
    }
  }
}
process.exit(failures.length ? 1 : 0);
