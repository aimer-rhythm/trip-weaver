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

export const env = {
  nodeEnv: str('NODE_ENV', 'development'),
  isProd: str('NODE_ENV') === 'production',
  port: int('PORT', 3001),
  databasePath: str('DATABASE_PATH', './data/tripweaver.db'),
  masterKey,
  inviteCode: str('INVITE_CODE'),                       // 空 = 注册关闭
  siteLlm: {
    baseUrl: str('SITE_LLM_BASE_URL'),
    apiKey: str('SITE_LLM_API_KEY'),
    model: str('SITE_LLM_MODEL'),
  },
  genDailyLimit: int('GEN_DAILY_LIMIT', 3),
  xhsMcpUrl: str('XHS_MCP_URL'),                        // 空 = 小红书降级模式
  xhsDailyBudget: int('XHS_DAILY_BUDGET', 500),
  ssrfAllowlist: str('SSRF_ALLOWLIST')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
} as const;

export function hasSiteLlm(): boolean {
  return Boolean(env.siteLlm.baseUrl && env.siteLlm.apiKey && env.siteLlm.model);
}
