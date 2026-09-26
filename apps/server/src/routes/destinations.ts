// 目的地路由（09-26 城市选择首页）：已覆盖城市列表，供首页城市图集渲染
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { CoveredCitiesView } from '@tripweaver/shared';
import { requireAuth } from '../auth/guard';
import { listCoveredCities } from '../services/cityCoverageService';

export const destinationRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/covered', async (): Promise<CoveredCitiesView> => ({ cities: await listCoveredCities() }));
};
