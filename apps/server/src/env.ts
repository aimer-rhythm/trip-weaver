import 'dotenv/config';

function str(name: string, fallback = ''): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function int(name: string, fallback: number): number {
  const v = Number.parseInt(str(name), 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

const masterKey = str('MASTER_KEY');
if (!/^[0-9a-fA-F]{64}$/.test(masterKey)) {
  throw new Error(
    '[env] MASTER_KEY 缺失或格式错误：需要 32 字节 hex（64 字符）。生成方式：\n' +
      '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
  );
}

const REGISTRATION_MODES = ['open', 'invite', 'closed'] as const;
export type RegistrationMode = (typeof REGISTRATION_MODES)[number];

const inviteCode = str('INVITE_CODE');
const rawMode = str('REGISTRATION_MODE');
// 未设置时兼容旧语义：INVITE_CODE 非空 → invite，否则 open（存量部署升级后行为不变）
const registrationMode = (rawMode || (inviteCode ? 'invite' : 'open')) as RegistrationMode;
if (!REGISTRATION_MODES.includes(registrationMode)) {
  throw new Error(`[env] REGISTRATION_MODE 取值不正确："${rawMode}"，可选 open | invite | closed`);
}
if (registrationMode === 'invite' && !inviteCode) {
  throw new Error('[env] REGISTRATION_MODE=invite 需要同时设置 INVITE_CODE');
}

const githubClientId = str('GITHUB_CLIENT_ID');
const githubClientSecret = str('GITHUB_CLIENT_SECRET');
const appBaseUrl = str('APP_BASE_URL').replace(/\/+$/, '');
if (Boolean(githubClientId) !== Boolean(githubClientSecret)) {
  throw new Error('[env] GITHUB_CLIENT_ID 与 GITHUB_CLIENT_SECRET 必须同时设置');
}
if (githubClientId && !appBaseUrl) {
  throw new Error('[env] 启用 GitHub 登录需要设置 APP_BASE_URL（用于构造回调地址，例如 https://your.domain）');
}

export const env = {
  nodeEnv: str('NODE_ENV', 'development'),
  isProd: str('NODE_ENV') === 'production',
  port: int('PORT', 3001),
  databasePath: str('DATABASE_PATH', './data/tripweaver.db'),
  masterKey,
  registrationMode,
  inviteCode,                                           // 仅 invite 模式使用
  appBaseUrl,
  github: { clientId: githubClientId, clientSecret: githubClientSecret },
  siteLlm: {
    baseUrl: str('SITE_LLM_BASE_URL'),
    apiKey: str('SITE_LLM_API_KEY'),
    model: str('SITE_LLM_MODEL'),
  },
  genDailyLimit: int('GEN_DAILY_LIMIT', 3),
  // 调研数据源（均可选；缺失时对应源 Null 降级，两者皆缺 = 纯模型知识调研）
  amapKey: str('AMAP_KEY'),                             // 高德 Web 服务 Key
  amapDailyBudget: int('AMAP_DAILY_BUDGET', 150),       // 全站高德调用日额度
  searchApiKey: str('SEARCH_API_KEY'),                  // Web 搜索 Key（默认 LangSearch）
  searchApiBaseUrl: str('SEARCH_API_BASE_URL', 'https://api.langsearch.com').replace(/\/+$/, ''),
  searchDailyBudget: int('SEARCH_DAILY_BUDGET', 500),   // 全站搜索调用日额度
  ssrfAllowlist: str('SSRF_ALLOWLIST')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
} as const;

export function hasSiteLlm(): boolean {
  return Boolean(env.siteLlm.baseUrl && env.siteLlm.apiKey && env.siteLlm.model);
}

export function hasGithubOauth(): boolean {
  return Boolean(env.github.clientId && env.github.clientSecret && env.appBaseUrl);
}
