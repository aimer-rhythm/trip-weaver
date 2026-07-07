import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { SettingsPutSchema } from '@tripweaver/shared';
import { requireAuth } from '../auth/guard';
import { getSettingsView, upsertSettings } from '../services/settingsService';
import { getContentSource } from '../integrations/xhs/contentSource';

export const settingsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/', async (request) => getSettingsView(request.user!.id));

  app.put('/', { schema: { body: SettingsPutSchema } }, async (request) => {
    return upsertSettings(request.user!.id, request.body);
  });

  // 小红书 MCP 连接自检（真实探测；未配置时由 NullContentSource 回报降级说明）
  app.get('/xhs-status', async () => getContentSource().selfCheck());
};
