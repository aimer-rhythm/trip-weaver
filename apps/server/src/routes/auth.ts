import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { eq } from 'drizzle-orm';
import { LoginBodySchema, RegisterBodySchema, uid } from '@tripweaver/shared';
import { db } from '../db/client';
import { users } from '../db/schema';
import { hashPassword, verifyPassword } from '../auth/password';
import { checkInviteCode, isRegistrationOpen } from '../auth/invite';
import { SESSION_COOKIE, createSession, destroySession } from '../auth/session';
import { requireAuth } from '../auth/guard';
import { env } from '../env';

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: env.isProd,
  path: '/',
  maxAge: 30 * 24 * 60 * 60,
} as const;

export const authRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.post(
    '/register',
    {
      config: { rateLimit: { max: 3, timeWindow: '1 minute' } },
      schema: { body: RegisterBodySchema },
    },
    async (request, reply) => {
      const { email, password, inviteCode } = request.body;
      if (!isRegistrationOpen()) {
        return reply.code(403).send({ error: '注册暂未开放，请联系站长' });
      }
      if (!checkInviteCode(inviteCode)) {
        return reply.code(403).send({ error: '邀请码不正确' });
      }
      const normalized = email.trim().toLowerCase();
      const exists = db.select({ id: users.id }).from(users).where(eq(users.email, normalized)).get();
      if (exists) {
        return reply.code(409).send({ error: '该邮箱已注册' });
      }
      const user = { id: uid(), email: normalized, passwordHash: await hashPassword(password), createdAt: Date.now() };
      db.insert(users).values(user).run();
      const { token } = createSession(user.id);
      return reply.setCookie(SESSION_COOKIE, token, COOKIE_OPTS).code(201).send({ id: user.id, email: user.email });
    },
  );

  app.post(
    '/login',
    {
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: { body: LoginBodySchema },
    },
    async (request, reply) => {
      const { email, password } = request.body;
      const row = db.select().from(users).where(eq(users.email, email.trim().toLowerCase())).get();
      // 统一失败文案，不泄露账号是否存在
      if (!row || !(await verifyPassword(password, row.passwordHash))) {
        return reply.code(401).send({ error: '邮箱或密码不正确' });
      }
      const { token } = createSession(row.id);
      return reply.setCookie(SESSION_COOKIE, token, COOKIE_OPTS).send({ id: row.id, email: row.email });
    },
  );

  app.post('/logout', { preHandler: requireAuth }, async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) destroySession(token);
    return reply.clearCookie(SESSION_COOKIE, { path: '/' }).send({ ok: true });
  });

  app.get('/me', { preHandler: requireAuth }, async (request) => {
    return request.user!;
  });
};
