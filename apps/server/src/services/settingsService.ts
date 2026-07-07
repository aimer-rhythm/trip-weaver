import { eq } from 'drizzle-orm';
import type { SettingsPut } from '@tripweaver/shared';
import { db } from '../db/client';
import { userSettings } from '../db/schema';
import { decryptSecret, encryptSecret } from '../crypto/secretBox';
import { assertSafeBaseUrl } from '../integrations/ssrfGuard';
import { env, hasSiteLlm } from '../env';

export interface SettingsView {
  byokEnabled: boolean;
  baseUrl: string;
  model: string;
  apiKeyLast4: string;
  hasSiteKey: boolean;
}

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  byok: boolean;
}

function getRow(userId: string) {
  return db.select().from(userSettings).where(eq(userSettings.userId, userId)).get();
}

export function getSettingsView(userId: string): SettingsView {
  const row = getRow(userId);
  return {
    byokEnabled: Boolean(row?.byokEnabled),
    baseUrl: row?.baseUrl ?? '',
    model: row?.model ?? '',
    apiKeyLast4: row?.apiKeyLast4 ?? '',
    hasSiteKey: hasSiteLlm(),
  };
}

export async function upsertSettings(userId: string, body: SettingsPut): Promise<SettingsView> {
  const prev = getRow(userId);
  const baseUrl = body.baseUrl?.trim() ?? prev?.baseUrl ?? '';
  const model = body.model?.trim() ?? prev?.model ?? '';

  // 保存时即做 SSRF 校验（使用时会二次校验，防 DNS 重绑定）
  if (baseUrl) await assertSafeBaseUrl(baseUrl);

  let apiKeyCiphertext = prev?.apiKeyCiphertext ?? '';
  let apiKeyLast4 = prev?.apiKeyLast4 ?? '';
  if (body.apiKey !== undefined && body.apiKey !== '') {
    apiKeyCiphertext = encryptSecret(body.apiKey);
    apiKeyLast4 = body.apiKey.slice(-4);
  }

  if (body.byokEnabled && (!baseUrl || !model || !apiKeyCiphertext)) {
    throw Object.assign(new Error('启用自有 Key 需要完整填写 Base URL、API Key 和模型名'), { statusCode: 400 });
  }

  const now = Date.now();
  const values = {
    userId,
    byokEnabled: body.byokEnabled ? 1 : 0,
    baseUrl,
    apiKeyCiphertext,
    apiKeyLast4,
    model,
    updatedAt: now,
  };
  db.insert(userSettings)
    .values(values)
    .onConflictDoUpdate({ target: userSettings.userId, set: values })
    .run();
  return getSettingsView(userId);
}

/** Key 双轨解析：用户 BYOK → 站点 Key → null（调用方负责给出 PRD F1 的对应文案） */
export function resolveLlmConfig(userId: string): LlmConfig | null {
  const row = getRow(userId);
  if (row?.byokEnabled && row.baseUrl && row.model && row.apiKeyCiphertext) {
    return { baseUrl: row.baseUrl, apiKey: decryptSecret(row.apiKeyCiphertext), model: row.model, byok: true };
  }
  if (hasSiteLlm()) {
    return { baseUrl: env.siteLlm.baseUrl, apiKey: env.siteLlm.apiKey, model: env.siteLlm.model, byok: false };
  }
  return null;
}
