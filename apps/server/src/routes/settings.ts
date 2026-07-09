import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { SettingsPutSchema } from '@tripweaver/shared';
import { requireAuth } from '../auth/guard';
import { getSettingsView, upsertSettings } from '../services/settingsService';
import { getPoiSource } from '../integrations/amap/poiSource';
import { getSearchSource } from '../integrations/websearch/searchSource';
import type { SourceStatus } from '../integrations/sourceStatus';

// 自检结果 60s 记忆化：探测是真实外呼（高德/搜索均计费额度），防止刷接口烧掉全站配额
const STATUS_TTL_MS = 60_000;
let statusMemo: { at: number; value: Promise<{ amap: SourceStatus; websearch: SourceStatus }> } | null = null;

function probeSources() {
  if (!statusMemo || Date.now() - statusMemo.at > STATUS_TTL_MS) {
    const value = Promise.all([getPoiSource().selfCheck(), getSearchSource().selfCheck()]).then(
      ([amap, websearch]) => ({ amap, websearch }),
    );
    statusMemo = { at: Date.now(), value };
  }
  return statusMemo.value;
}

export const settingsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/', async (request) => getSettingsView(request.user!.id));

  app.put('/', { schema: { body: SettingsPutSchema } }, async (request) => {
    return upsertSettings(request.user!.id, request.body);
  });

  // 调研数据源自检（真实探测，60s 记忆化；未配置时由 Null 源回报降级说明）
  app.get('/sources-status', async () => probeSources());
};
