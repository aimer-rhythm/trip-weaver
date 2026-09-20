// LLM 模型构造：settingsService.resolveLlmConfig 的双轨结果 → pi-ai 自定义 Model
// BYOK baseUrl 在使用时二次过 ssrfGuard（防 DNS 重绑定，架构 §5.1/§9）
import type { Model } from '@mariozechner/pi-ai';
import type { LlmConfig } from '../services/settingsService';
import { assertSafeBaseUrl } from '../integrations/ssrfGuard';

export class NoLlmConfiguredError extends Error {
  constructor() {
    super('未配置可用的 LLM Key');
  }
}

/** 自定义 OpenAI 兼容端点模型；compat 由 pi-ai 按 baseUrl 自动探测（§12 已核对） */
export async function buildModel(cfg: LlmConfig): Promise<Model<'openai-completions'>> {
  if (cfg.byok) await assertSafeBaseUrl(cfg.baseUrl);
  return {
    id: cfg.model,
    name: cfg.model,
    api: 'openai-completions',
    provider: cfg.byok ? 'tripweaver-byok' : 'tripweaver-site',
    baseUrl: cfg.baseUrl,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 65536,
    // pi-ai 的 streamSimple 会把 maxTokens 截到 min(model.maxTokens, 32000)：写更大值无意义。
    // 8192 曾让 plan 阶段把预算烧在隐藏推理上（stopReason=length、正文为空）。
    maxTokens: 32000,
  };
}
