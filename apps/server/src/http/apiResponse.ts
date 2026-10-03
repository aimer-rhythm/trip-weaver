import type { FastifyInstance } from 'fastify';
import { isApiResponse, type ApiResponse } from '@tripweaver/shared';
import { SsrfError } from '../integrations/ssrfGuard';

/** 在路由 schema 序列化之后包装：业务字段仍由原 schema 过滤。 */
export function installApiResponses(app: FastifyInstance): void {
  app.addHook('onSend', async (request, reply, payload) => {
    const path = request.url.split('?')[0] ?? '';
    if (path !== '/api' && !path.startsWith('/api/')) return payload;
    if (reply.statusCode === 204 || reply.statusCode === 304 || (reply.statusCode >= 300 && reply.statusCode < 400)) return payload;
    if (!String(reply.getHeader('content-type')).includes('application/json') || typeof payload !== 'string') return payload;
    const value: unknown = JSON.parse(payload);
    if (isApiResponse(value)) return payload;
    let response: ApiResponse;
    if (reply.statusCode < 400) {
      response = { code: 0, message: '成功', data: value };
    } else {
      const body = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
      const { error, message, code, statusCode: _status, ...data } = body;
      response = {
        code: typeof code === 'string' && code && !code.startsWith('FST_') ? code :
          typeof code === 'number' && Number.isInteger(code) && code !== 0 ? code : reply.statusCode,
        message: typeof message === 'string' ? message : typeof error === 'string' ? error : '请求失败',
        data: Object.keys(data).length ? data : null,
      };
    }
    reply.removeHeader('content-length');
    return JSON.stringify(response);
  });

  app.setErrorHandler((error: unknown, _request, reply) => {
    if (error instanceof SsrfError) return reply.code(400).send({ error: error.message });
    const err = error as { statusCode?: number; validation?: unknown; message?: string };
    if (err.validation) return reply.code(400).send({ error: '请求参数不正确' });
    const status = err.statusCode ?? 500;
    if (status >= 500) app.log.error(error);
    return reply.code(status).send({ error: status >= 500 ? '服务器内部错误' : (err.message ?? '请求失败') });
  });
}
