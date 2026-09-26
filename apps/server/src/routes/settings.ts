import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { SettingsPutSchema } from '@tripweaver/shared';
import { requireAuth } from '../auth/guard';
import { getSettingsView, upsertSettings } from '../services/settingsService';
import { resolvePoiSourceForUser } from '../integrations/geoProvider';
import { resolveSearchSourceForUser } from '../integrations/websearch/searchSource';
import { env, type MapProvider } from '../env';
import type { SourceStatus } from '../integrations/sourceStatus';

// 自检结果 60s 记忆化：按用户与凭据 revision 隔离，缓存中不保存凭据或数据源实例。
const STATUS_TTL_MS = 60_000;
interface SourceStatusMemo {
  at: number;
  geoCredentialRevision: string;
  searchCredentialRevision: string;
  value: { geo: SourceStatus; websearch: SourceStatus };
}

const statusMemoByUser = new Map<string, SourceStatusMemo>();

export interface SourcesStatusView {
  /** 当前生效的地图服务商：前端据此标注自检卡片走的是哪条链路 */
  provider: MapProvider;
  geo: SourceStatus;
  websearch: SourceStatus;
}

export async function probeSourcesForUser(userId: string): Promise<SourcesStatusView> {
  const resolvedPoiSource = await resolvePoiSourceForUser(userId);
  const resolvedSearchSource = await resolveSearchSourceForUser(userId);
  const memo = statusMemoByUser.get(userId);
  if (
    memo &&
    memo.geoCredentialRevision === resolvedPoiSource.credentialRevision &&
    memo.searchCredentialRevision === resolvedSearchSource.credentialRevision &&
    Date.now() - memo.at <= STATUS_TTL_MS
  ) {
    return { provider: env.mapProvider, ...memo.value };
  }

  const [geo, websearch] = await Promise.all([
    resolvedPoiSource.source.selfCheck(),
    resolvedSearchSource.source.selfCheck(),
  ]);
  const value = { geo, websearch };
  statusMemoByUser.set(userId, {
    at: Date.now(),
    geoCredentialRevision: resolvedPoiSource.credentialRevision,
    searchCredentialRevision: resolvedSearchSource.credentialRevision,
    value,
  });
  return { provider: env.mapProvider, ...value };
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
