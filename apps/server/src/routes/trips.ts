import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { RenameTripSchema, RouteOptionsRequestSchema, RouteOptionsResponseSchema, TripExportSchema, TripSchema, TRIP_LIST_PAGE_SIZE, TRIP_LIST_PAGE_SIZE_MAX } from '@tripweaver/shared';
import { getRouteOptions } from '../services/routeOptionsService';
import { TripShareImageRequestSchema, TripShareImageResponseSchema } from '@tripweaver/shared';
import { getTripShareImage } from '../services/tripShareImageService';
import { requireAuth } from '../auth/guard';
import { createTrip, deleteTrip, getTrip, listTripsPage, listTripVersions, renameTrip, updateTrip } from '../services/tripService';
import { findConversationForTrip } from '../services/conversationService';

const IdParams = Type.Object({ id: Type.String() });

export const tripRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.addHook('preHandler', requireAuth);
// 行程列表分页（10-03）：筛选/排序/计数都在服务端；Fastify 默认 coerce，query 里的字符串会转成 integer
const TripListQuerySchema = Type.Object({
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: TRIP_LIST_PAGE_SIZE_MAX })),
  q: Type.Optional(Type.String({ maxLength: 100 })),
  city: Type.Optional(Type.String({ maxLength: 100 })),
  sort: Type.Optional(Type.Union([Type.Literal('updated'), Type.Literal('created'), Type.Literal('name')])),
});


  app.get('/', { schema: { querystring: TripListQuerySchema } }, async (request) => listTripsPage(request.user!.id, {
    offset: request.query.offset ?? 0,
    limit: request.query.limit ?? TRIP_LIST_PAGE_SIZE,
    q: request.query.q,
    city: request.query.city,
    sort: request.query.sort,
  }));

  app.post('/:id/share-image', {
    schema: { params: IdParams, body: TripShareImageRequestSchema, response: { 200: TripShareImageResponseSchema, 400: Type.Object({ error: Type.String() }), 404: Type.Object({ error: Type.String() }) } },
    bodyLimit: 1024 * 1024,
    config: { rateLimit: { max: 6, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    if (!(await getTrip(request.user!.id, request.params.id))) return reply.code(404).send({ error: '行程不存在' });
    if (request.body.trip.id !== request.params.id) return reply.code(400).send({ error: '行程标识不一致' });
    const started = Date.now();
    try {
      const image = await getTripShareImage(request.user!.id, request.body.trip);
      request.log.info({ outcome: 'success', durationMs: Date.now() - started }, '[trip-share-image]');
      return reply.header('Cache-Control', 'no-store').send(image);
    } catch (error) {
      request.log.warn({ outcome: 'failed', durationMs: Date.now() - started }, '[trip-share-image]');
      throw error;
    }
  });

  app.post('/:id/route-options', {
    schema: { params: IdParams, body: RouteOptionsRequestSchema, response: { 200: RouteOptionsResponseSchema, 404: Type.Object({ error: Type.String() }) } },
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    if (!(await getTrip(request.user!.id, request.params.id))) return reply.code(404).send({ error: '行程不存在' });
    return getRouteOptions(request.user!.id, request.body);
  });

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

  // 版本链：详情页版本切换用（含历史版本，按 version 升序）
  app.get('/:id/versions', { schema: { params: IdParams } }, async (request, reply) => {
    const chain = await listTripVersions(request.user!.id, request.params.id);
    if (!chain) return reply.code(404).send({ error: '行程不存在' });
    return chain;
  });

  // 编辑器内嵌对话（09-24 R2）：行程 → 来源会话反查；无关联会话（导入/旧数据）返回 conversationId=null
  app.get('/:id/conversation', { schema: { params: IdParams } }, async (request, reply) => {
    if (!(await getTrip(request.user!.id, request.params.id))) return reply.code(404).send({ error: '行程不存在' });
    const conversationId = await findConversationForTrip(request.user!.id, request.params.id);
    return { conversationId };
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
