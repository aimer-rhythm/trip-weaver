import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { RenameTripSchema, TripExportSchema, TripSchema } from '@tripweaver/shared';
import { requireAuth } from '../auth/guard';
import { createTrip, deleteTrip, getTrip, listTrips, renameTrip, updateTrip } from '../services/tripService';

const IdParams = Type.Object({ id: Type.String() });

export const tripRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/', async (request) => listTrips(request.user!.id));

  // JSON 导入 → 新建一条历史行程
  app.post('/', { schema: { body: TripExportSchema } }, async (request, reply) => {
    const trip = await createTrip(request.user!.id, request.body.trip);
    return reply.code(201).send(trip);
  });

  app.get('/:id', { schema: { params: IdParams } }, async (request, reply) => {
    const trip = await getTrip(request.user!.id, request.params.id);
    if (!trip) return reply.code(404).send({ error: '行程不存在' });
    return trip;
  });

  app.put('/:id', { schema: { params: IdParams, body: TripSchema } }, async (request, reply) => {
    const trip = await updateTrip(request.user!.id, request.params.id, request.body);
    if (!trip) return reply.code(404).send({ error: '行程不存在' });
    return trip;
  });

  app.patch('/:id/title', { schema: { params: IdParams, body: RenameTripSchema } }, async (request, reply) => {
    const ok = await renameTrip(request.user!.id, request.params.id, request.body.title);
    if (!ok) return reply.code(404).send({ error: '行程不存在' });
    return { ok: true };
  });

  app.delete('/:id', { schema: { params: IdParams } }, async (request, reply) => {
    const ok = await deleteTrip(request.user!.id, request.params.id);
    if (!ok) return reply.code(404).send({ error: '行程不存在' });
    return { ok: true };
  });
};
