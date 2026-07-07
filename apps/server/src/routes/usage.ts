import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { requireAuth } from '../auth/guard';
import { usageView } from '../services/quotaService';

export const usageRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.addHook('preHandler', requireAuth);
  app.get('/', async (request) => usageView(request.user!.id));
};
