import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { NotificationPageSchema, NotificationQuerySchema, NotificationReadAllSchema } from '@tripweaver/shared';
import { requireAuth } from '../auth/guard';
import { listNotifications, readAllNotifications, readNotification } from '../services/notificationService';

export const notificationRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.addHook('preHandler', requireAuth);
  app.get('/', { schema: { querystring: NotificationQuerySchema, response: { 200: NotificationPageSchema } } }, async (request) =>
    listNotifications(request.user!.id, request.query.before, request.query.limit));
  app.post('/read-all', { schema: { body: NotificationReadAllSchema } }, async (request) => {
    await readAllNotifications(request.user!.id, request.body.through);
    return { ok: true };
  });
  app.post('/:id/read', { schema: { params: Type.Object({ id: Type.String({ minLength: 1, maxLength: 128 }) }) } }, async (request, reply) => {
    if (!(await readNotification(request.user!.id, request.params.id))) return reply.code(404).send({ error: '通知不存在' });
    return { ok: true };
  });
};
