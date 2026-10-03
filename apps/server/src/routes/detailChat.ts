import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { DetailChatRequestSchema, AddFoodRequestSchema, type ChatStreamEvent } from '@tripweaver/shared';
import { hasSiteLlm } from '../env';
import { getConversation } from '../services/conversationService';
import { prepareDetailChat, runDetailChat } from '../services/detailChatService';
import { readOperation, startDetailTurn, stopDetailTurn } from '../services/detailOperationService';
import { resolveLlmConfig } from '../services/settingsService';
import { addFood } from '../services/tripHistoryService';

const Id = Type.Object({ id: Type.String({ maxLength: 100 }) });
const Operation = Type.Object({ id: Type.String({ maxLength: 100 }), operationId: Type.String({ maxLength: 100 }) });

export const detailChatRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get('/:id/operations/:operationId', { schema: { params: Operation } }, async (request, reply) => {
    if (!await getConversation(request.user!.id, request.params.id)) return reply.code(404).send({ error: '会话不存在' });
    return { result: await readOperation(request.user!.id, request.params.operationId) };
  });
  app.post('/:id/operations/:operationId/stop', { schema: { params: Operation } }, async (request, reply) => {
    if (!await getConversation(request.user!.id, request.params.id)) return reply.code(404).send({ error: '会话不存在' });
    stopDetailTurn(request.user!.id, request.params.id, request.params.operationId);
    return { result: await readOperation(request.user!.id, request.params.operationId) };
  });
  app.post('/:id/food', { schema: { params: Id, body: AddFoodRequestSchema } }, async (request) =>
    addFood(request.user!.id, request.params.id, request.body));

  app.post('/:id/messages/stream', { schema: { params: Id, body: DetailChatRequestSchema } }, async (request, reply) => {
    const userId = request.user!.id;
    const conversationId = request.params.id;
    const input = request.body;
    const prepared = await prepareDetailChat(userId, conversationId, input);
    const cfg = prepared.saved ? null : await resolveLlmConfig(userId);
    if (!prepared.saved && !cfg) return reply.code(400).send({ error: '当前没有可用的 AI 配置', code: 'no_llm', hasSiteKey: hasSiteLlm() });
    const turn = startDetailTurn(userId, conversationId, input.requestId);
    let sequence = 0;
    let terminal = false;
    type Payload = ChatStreamEvent extends infer E ? E extends ChatStreamEvent ? Omit<E, 'requestId' | 'sequence'> : never : never;
    const send = (event: Payload) => {
      if (terminal || reply.raw.destroyed) return;
      if (event.type === 'done' || event.type === 'error') terminal = true;
      reply.raw.write(`data: ${JSON.stringify({ ...event, requestId: input.requestId, sequence: ++sequence })}\n\n`);
    };
    reply.hijack();
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
    const disconnect = () => { if (!reply.raw.writableEnded) turn.controller.abort(); };
    reply.raw.on('close', disconnect);
    const heartbeat = setInterval(() => { if (!reply.raw.destroyed) reply.raw.write(': heartbeat\n\n'); }, 15000);
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; turn.controller.abort(); }, 5 * 60 * 1000);
    try {
      send({ type: 'accepted' });
      const result = prepared.saved ?? await runDetailChat(userId, conversationId, input, cfg!, turn.controller.signal, (type, text) => send({ type, text }));
      if (result.replyMessage.attachment) send({ type: 'recommendations', attachment: result.replyMessage.attachment });
      if (result.editResult) send({ type: 'edit_result', result: result.editResult });
      send({ type: 'done', result });
    } catch (error) {
      const stopped = turn.controller.signal.aborted;
      const expected = error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number' && error.statusCode < 500;
      if (!stopped && !expected) request.log.warn({ requestId: input.requestId }, '详情对话失败');
      send({ type: 'error', code: timedOut ? 'timeout' : stopped ? 'stopped' : 'chat_failed', error: timedOut ? '处理超时，原行程未改动，请重试或缩小范围' : stopped ? '已停止' : expected ? error.message : '回答中断，请重试' });
    } finally {
      clearInterval(heartbeat);
      clearTimeout(timeout);
      reply.raw.removeListener('close', disconnect);
      turn.release();
      reply.raw.end();
    }
  });
};
