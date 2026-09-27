import 'dotenv/config';

export const DEFAULT_SEARCH_API_BASE_URL = 'https://api.langsearch.com';

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

// 地图服务商（09-25 二次调整）：两家**互补共存**，不再是站点级二选一 —— MAP_PROVIDER 已废弃。
//   · POI 搜索（search_pois） → 固定天地图：高德 v5/place/text 与地理编码主路径共用同一份个人配额，
//                              实测会被打满（USER_DAILY_QUERY_OVER_LIMIT 10044），两者互相挤占
//   · 路线规划 + 地理编码      → 高德优先（有 AMAP_KEY 就用），缺失时降级天地图
// 天地图搜索不可用（未配 tk / 未开通地名搜索权限 / 请求失败）→ 空结果 + 模型知识，**不回落高德**。
const MAP_PROVIDERS = ['amap', 'tianditu'] as const;
/** 服务商标识：两家并存，各自承担不同能力（见上） */
export type MapProvider = (typeof MAP_PROVIDERS)[number];

const amapKey = str('AMAP_KEY');
// 前端地图渲染的凭据（09-26）：高德 JS API 需要**独立类型**的 Key（创建时选「Web端(JS API)」，
// 并绑定域名白名单）+ 安全密钥。两者都会明文下发到浏览器 —— 这是 JS API 的设计，
// 安全性靠域名白名单而不是保密。缺失即视为「未启用高德渲染」，前端静默降级到 Leaflet + 栅格瓦片。
const amapJsKey = str('AMAP_JS_KEY');
const amapJsSecurityCode = str('AMAP_JS_SECURITY_CODE');
const tiandituKey = str('TIANDITU_KEY');
if (!amapKey) {
  console.warn('[env] AMAP_KEY 未配置：路线规划与地理编码降级为天地图（天地图 Key 也缺则整链降级）');
}
if (!tiandituKey) {
  console.warn('[env] TIANDITU_KEY 未配置：地点搜索不可用，调研只能依赖知识库与模型知识');
}

export const env = {
  nodeEnv: str('NODE_ENV', 'development'),
  isProd: str('NODE_ENV') === 'production',
  port: int('PORT', 3001),
  // PostgreSQL 连接串（09-18 起为唯一运行态数据库）
  databaseUrl: str('DATABASE_URL', 'postgres://postgres:postgres@127.0.0.1:5432/tripweaver'),
  // 旧 SQLite 文件路径：仅一次性迁移脚本 scripts/migrate-sqlite-to-pg.ts 读取
  databasePath: str('DATABASE_PATH', './data/tripweaver.db'),
  // 媒体静态资源 URL 前缀（09-27）：库内景点封面只存相对 key，由这里拼成可展示 URL。
  // 缺省 /media 即同源相对路径（images.ts 已挂载该前缀）；换对象存储只改这一个变量。
  mediaBaseUrl: str('MEDIA_BASE_URL', '/media').replace(/\/+$/, ''),
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
  // Embedding（RAG 向量召回，可选）：缺省回落到站点 LLM 的 baseUrl/apiKey（OpenAI 兼容端点普遍同址提供 /embeddings）
  embedding: {
    baseUrl: str('EMBEDDING_BASE_URL') || str('SITE_LLM_BASE_URL'),
    apiKey: str('EMBEDDING_API_KEY') || str('SITE_LLM_API_KEY'),
    model: str('EMBEDDING_MODEL', 'cf/bge-m3'),
    dims: int('EMBEDDING_DIMS', 1024),
  },
  genDailyLimit: int('GEN_DAILY_LIMIT', 3),
  chatDailyLimit: int('CHAT_DAILY_LIMIT', 40),   // 每日对话轮数上限（独立于生成配额；对话轮次不消耗 GEN_DAILY_LIMIT）
  // 调研数据源（均可选；缺失时对应源 Null 降级，两者皆缺 = 纯模型知识调研）
  amapKey,                                              // 高德 Web 服务 Key（路线规划 + 地理编码）
  amapJsKey,                                            // 高德「Web端(JS API)」Key：前端地图渲染，与 Web 服务 Key 不通用
  amapJsSecurityCode,                                   // JS API 2.0 必需的安全密钥，与 amapJsKey 一同下发
  amapDailyBudget: int('AMAP_DAILY_BUDGET', 150),       // 全站高德调用日额度
  tiandituKey,                                          // 天地图 Web 服务 Key（接口参数名 tk）
  tiandituDailyBudget: int('TIANDITU_DAILY_BUDGET', 150),   // 全站天地图调用日额度（与高德分别计数）
  searchApiKey: str('SEARCH_API_KEY'),                  // Web 搜索 Key（默认 LangSearch）
  searchApiBaseUrl: str('SEARCH_API_BASE_URL', DEFAULT_SEARCH_API_BASE_URL).replace(/\/+$/, ''),
  searchDailyBudget: int('SEARCH_DAILY_BUDGET', 500),   // 全站搜索调用日额度
  ssrfAllowlist: str('SSRF_ALLOWLIST')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
} as const;

export function hasSiteLlm(): boolean {
  return Boolean(env.siteLlm.baseUrl && env.siteLlm.apiKey && env.siteLlm.model);
}

export function hasEmbedding(): boolean {
  return Boolean(env.embedding.baseUrl && env.embedding.apiKey && env.embedding.model);
}

export function hasGithubOauth(): boolean {
  return Boolean(env.github.clientId && env.github.clientSecret && env.appBaseUrl);
}
