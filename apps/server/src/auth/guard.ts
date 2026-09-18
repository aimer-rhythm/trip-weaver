import type { FastifyReply, FastifyRequest } from 'fastify';
import { SESSION_COOKIE, validateSession } from './session';

declare module 'fastify' {
  interface FastifyRequest {
    user?: { id: string; email: string };
  }
}

// 受保护路由的 preHandler；通过后 request.user 可用
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = request.cookies[SESSION_COOKIE];
  const user = token ? await validateSession(token) : null;
  if (!user) {
    await reply.code(401).send({ error: '未登录或会话已过期' });
    return;
  }
  request.user = user;
}
