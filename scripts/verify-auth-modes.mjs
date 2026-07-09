// 认证模式验收：REGISTRATION_MODE 三态 + 兼容推断 + GitHub OAuth 路由骨架
// 自行拉起服务（每场景独立 env + 临时库），无需预先启动；运行：node scripts/verify-auth-modes.mjs
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SERVER_DIR = path.resolve(import.meta.dirname, '../apps/server');
const results = [];
let failed = 0;

function check(name, ok, detail = '') {
  results.push(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
}

function baseEnv(port, dbDir) {
  return {
    ...process.env,
    NODE_ENV: 'development',
    PORT: String(port),
    DATABASE_PATH: path.join(dbDir, 'test.db'),
    MASTER_KEY: randomBytes(32).toString('hex'),
    // 显式清空，隔离 apps/server/.env 的本地值（dotenv 不覆盖已定义变量）
    REGISTRATION_MODE: '',
    INVITE_CODE: '',
    GITHUB_CLIENT_ID: '',
    GITHUB_CLIENT_SECRET: '',
    APP_BASE_URL: '',
    SITE_LLM_BASE_URL: '',
    SITE_LLM_API_KEY: '',
    // 本地 fetch 不走系统代理
    NO_PROXY: 'localhost,127.0.0.1',
    no_proxy: 'localhost,127.0.0.1',
  };
}

function startServer(env) {
  const child = spawn('npx', ['tsx', 'src/index.ts'], { cwd: SERVER_DIR, env, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  return { child, getOutput: () => output };
}

async function waitHealth(port, child, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return false;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) return true;
    } catch { /* 未就绪 */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

function stop(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    // shell:true 包装下 child.kill 只杀 shell 壳，必须 taskkill 整棵进程树并等其结束（否则 WAL 文件仍被占用）
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { shell: true, stdio: 'ignore' });
    killer.on('exit', () => setTimeout(resolve, 600));
    setTimeout(resolve, 6000);
  });
}

function cleanupDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  } catch { /* 临时目录残留可接受 */ }
}

/** 在指定 env 下拉起服务并执行断言 */
async function scenario(name, port, envOverrides, fn) {
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-auth-'));
  const env = { ...baseEnv(port, dbDir), ...envOverrides };
  const { child, getOutput } = startServer(env);
  const up = await waitHealth(port, child);
  if (!up) {
    check(`${name}：服务启动`, false, getOutput().slice(-300));
    await stop(child);
    return;
  }
  try {
    await fn(`http://127.0.0.1:${port}`);
  } catch (err) {
    check(`${name}：断言执行`, false, String(err));
  } finally {
    await stop(child);
    cleanupDir(dbDir);
  }
}

const post = (base, p, body) =>
  fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const uniqueEmail = () => `vm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.dev`;

// ---- 场景 1：open 模式（显式）----
await scenario('open', 18931, { REGISTRATION_MODE: 'open' }, async (base) => {
  const cfg = await (await fetch(`${base}/api/auth/config`)).json();
  check('open：config 上报 open + github 关闭', cfg.registrationMode === 'open' && cfg.githubEnabled === false, JSON.stringify(cfg));
  const res = await post(base, '/api/auth/register', { email: uniqueEmail(), password: 'password123' });
  check('open：免邀请码注册成功', res.status === 201, `status=${res.status}`);
  check('open：注册即下发会话 Cookie', (res.headers.get('set-cookie') ?? '').includes('tw_session='));
  const gh = await fetch(`${base}/api/auth/github`, { redirect: 'manual' });
  check('open：GitHub 未配置时端点 404', gh.status === 404, `status=${gh.status}`);
});

// ---- 场景 2：兼容推断（REGISTRATION_MODE 未设 + INVITE_CODE 非空 → invite，旧版行为）----
await scenario('legacy-invite', 18932, { INVITE_CODE: 'legacy-code-2026' }, async (base) => {
  const cfg = await (await fetch(`${base}/api/auth/config`)).json();
  check('推断：INVITE_CODE 非空自动进入 invite 模式', cfg.registrationMode === 'invite', JSON.stringify(cfg));
  const noCode = await post(base, '/api/auth/register', { email: uniqueEmail(), password: 'password123' });
  check('推断：缺邀请码被拒 403', noCode.status === 403, `status=${noCode.status}`);
  const wrong = await post(base, '/api/auth/register', { email: uniqueEmail(), password: 'password123', inviteCode: 'nope' });
  check('推断：错误邀请码被拒 403', wrong.status === 403, `status=${wrong.status}`);
  const ok = await post(base, '/api/auth/register', { email: uniqueEmail(), password: 'password123', inviteCode: 'legacy-code-2026' });
  check('推断：正确邀请码注册成功', ok.status === 201, `status=${ok.status}`);
});

// ---- 场景 3：closed 模式（存量用户仍可登录）----
await scenario('closed', 18933, { REGISTRATION_MODE: 'closed' }, async (base) => {
  const res = await post(base, '/api/auth/register', { email: uniqueEmail(), password: 'password123' });
  check('closed：注册被拒 403', res.status === 403, `status=${res.status}`);
  const cfg = await (await fetch(`${base}/api/auth/config`)).json();
  check('closed：config 上报 closed', cfg.registrationMode === 'closed', JSON.stringify(cfg));
});

// ---- 场景 4：invite 模式缺 INVITE_CODE → 启动即失败 ----
{
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-auth-'));
  const env = { ...baseEnv(18934, dbDir), REGISTRATION_MODE: 'invite' };
  const { child, getOutput } = startServer(env);
  const exited = await new Promise((resolve) => {
    child.on('exit', (code) => resolve(code));
    setTimeout(() => resolve(null), 20_000);
  });
  check('invite 缺 INVITE_CODE：启动报错退出', exited !== null && exited !== 0, `exit=${exited}, ${getOutput().slice(-160)}`);
  await stop(child);
  cleanupDir(dbDir);
}

// ---- 场景 5：GitHub 已配置 → 跳转与 state 防线 ----
await scenario(
  'github',
  18935,
  {
    REGISTRATION_MODE: 'open',
    GITHUB_CLIENT_ID: 'Iv1.test-client-id',
    GITHUB_CLIENT_SECRET: 'test-secret',
    APP_BASE_URL: 'http://localhost:5173',
  },
  async (base) => {
    const cfg = await (await fetch(`${base}/api/auth/config`)).json();
    check('github：config 上报 githubEnabled=true', cfg.githubEnabled === true, JSON.stringify(cfg));
    const go = await fetch(`${base}/api/auth/github`, { redirect: 'manual' });
    const loc = go.headers.get('location') ?? '';
    const cookie = go.headers.get('set-cookie') ?? '';
    check('github：302 跳转 authorize 且带 state/scope/redirect_uri',
      go.status === 302 &&
        loc.startsWith('https://github.com/login/oauth/authorize') &&
        loc.includes('state=') &&
        loc.includes('scope=user%3Aemail') &&
        loc.includes(encodeURIComponent('http://localhost:5173/api/auth/github/callback')),
      loc.slice(0, 160));
    check('github：state 存入 httpOnly cookie', cookie.includes('tw_oauth_state=') && /httponly/i.test(cookie));
    const cb = await fetch(`${base}/api/auth/github/callback?code=x&state=mismatch`, {
      redirect: 'manual',
      headers: { cookie: 'tw_oauth_state=another' },
    });
    check('github：state 不匹配 → 302 /login?error=github_state',
      cb.status === 302 && (cb.headers.get('location') ?? '').includes('/login?error=github_state'),
      `${cb.status} ${cb.headers.get('location')}`);
    const noState = await fetch(`${base}/api/auth/github/callback?code=x&state=abc`, { redirect: 'manual' });
    check('github：无 state cookie → 拒绝',
      noState.status === 302 && (noState.headers.get('location') ?? '').includes('error=github_state'));
  },
);

console.log(`\n===== 认证模式验收 =====`);
for (const line of results) console.log(line);
console.log(`\n${failed === 0 ? '🎉 全部通过' : `💥 ${failed} 项失败`}（共 ${results.length} 项）`);
process.exit(failed === 0 ? 0 : 1);
