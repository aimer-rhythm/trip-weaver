import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { SettingsPutSchema } from '@tripweaver/shared';
import { requireAuth } from '../auth/guard';
import { getSettingsView, upsertSettings } from '../services/settingsService';
import { resolvePoiSourceForUser } from '../integrations/amap/poiSource';
import { resolveSearchSourceForUser } from '../integrations/websearch/searchSource';
import type { SourceStatus } from '../integrations/sourceStatus';

// 自检结果 60s 记忆化：按用户与凭据 revision 隔离，缓存中不保存凭据或数据源实例。
const STATUS_TTL_MS = 60_000;
interface SourceStatusMemo {
  at: number;
  amapCredentialRevision: string;
  searchCredentialRevision: string;
  value: { amap: SourceStatus; websearch: SourceStatus };
}

const statusMemoByUser = new Map<string, SourceStatusMemo>();

export async function probeSourcesForUser(userId: string): Promise<{ amap: SourceStatus; websearch: SourceStatus }> {
  const resolvedPoiSource = await resolvePoiSourceForUser(userId);
  const resolvedSearchSource = await resolveSearchSourceForUser(userId);
  const memo = statusMemoByUser.get(userId);
  if (
    memo &&
    memo.amapCredentialRevision === resolvedPoiSource.credentialRevision &&
    memo.searchCredentialRevision === resolvedSearchSource.credentialRevision &&
    Date.now() - memo.at <= STATUS_TTL_MS
  ) {
    return memo.value;
  }

  const [amap, websearch] = await Promise.all([
    resolvedPoiSource.source.selfCheck(),
    resolvedSearchSource.source.selfCheck(),
  ]);
  const value = { amap, websearch };
  statusMemoByUser.set(userId, {
    at: Date.now(),
    amapCredentialRevision: resolvedPoiSource.credentialRevision,
    searchCredentialRevision: resolvedSearchSource.credentialRevision,
    value,
  });
  return value;
}

export const settingsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/', async (request) => getSettingsView(request.user!.id));

  app.put('/', { schema: { body: SettingsPutSchema } }, async (request) => {
    return upsertSettings(request.user!.id, request.body);
  });

  // 调研数据源自检（真实探测，60s 记忆化；未配置时由 Null 源回报降级说明）
  app.get('/sources-status', async (request) => probeSourcesForUser(request.user!.id));
};
