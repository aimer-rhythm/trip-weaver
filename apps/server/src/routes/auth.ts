import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { randomBytes } from 'node:crypto';
import { Type } from '@sinclair/typebox';
import { eq } from 'drizzle-orm';
import { LoginBodySchema, RegisterBodySchema, uid } from '@tripweaver/shared';
import { db } from '../db/client';
import { users } from '../db/schema';
import { hashPassword, verifyPassword } from '../auth/password';
import { checkInviteCode } from '../auth/invite';
import {
  GithubOauthError,
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_TTL_S,
  buildAuthorizeUrl,
  exchangeCode,
  fetchGithubIdentity,
} from '../auth/github';
import { SESSION_COOKIE, createSession, destroySession } from '../auth/session';
import { requireAuth } from '../auth/guard';
import { env, hasGithubOauth } from '../env';

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: env.isProd,
  path: '/',
  maxAge: 30 * 24 * 60 * 60,
} as const;

const GithubCallbackQuerySchema = Type.Object({
  code: Type.Optional(Type.String({ maxLength: 200 })),
  state: Type.Optional(Type.String({ maxLength: 200 })),
  error: Type.Optional(Type.String({ maxLength: 100 })),
});

export const authRoutes: FastifyPluginAsyncTypebox = async (app) => {
  // 公开配置：前端据此渲染邀请码栏与 GitHub 按钮
  app.get('/config', async () => ({
    registrationMode: env.registrationMode,
    githubEnabled: hasGithubOauth(),
  }));

  app.post(
    '/register',
    {
      config: { rateLimit: { max: 3, timeWindow: '1 minute' } },
      schema: { body: RegisterBodySchema },
    },
    async (request, reply) => {
      const { email, password, inviteCode } = request.body;
      if (env.registrationMode === 'closed') {
        return reply.code(403).send({ error: '注册暂未开放，请联系站长' });
      }
      if (env.registrationMode === 'invite' && !checkInviteCode(inviteCode ?? '')) {
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
      // 统一失败文案，不泄露账号是否存在；passwordHash 为空 = OAuth-only 账号，禁用密码登录
      if (!row || !row.passwordHash || !(await verifyPassword(password, row.passwordHash))) {
        return reply.code(401).send({ error: '邮箱或密码不正确' });
      }
      const { token } = createSession(row.id);
      return reply.setCookie(SESSION_COOKIE, token, COOKIE_OPTS).send({ id: row.id, email: row.email });
    },
  );

  // GitHub OAuth：跳转授权页（state 防 CSRF，短时 cookie 存放）
  app.get(
    '/github',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (_request, reply) => {
      if (!hasGithubOauth()) return reply.code(404).send({ error: 'GitHub 登录未启用' });
      const state = randomBytes(32).toString('hex');
      return reply
        .setCookie(OAUTH_STATE_COOKIE, state, { ...COOKIE_OPTS, maxAge: OAUTH_STATE_TTL_S })
        .redirect(buildAuthorizeUrl(state));
    },
  );

  // GitHub OAuth 回调：state 校验 → 换 token → 拉身份 → 关联/建号 → 签发全新会话
  app.get(
    '/github/callback',
    {
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: { querystring: GithubCallbackQuerySchema },
    },
    async (request, reply) => {
      const fail = (code: string) => reply.redirect(`/login?error=${code}`);
      if (!hasGithubOauth()) return reply.code(404).send({ error: 'GitHub 登录未启用' });

      const { code, state, error } = request.query;
      const stateCookie = request.cookies[OAUTH_STATE_COOKIE];
      reply.clearCookie(OAUTH_STATE_COOKIE, { path: '/' });
      if (error) return fail('github_denied');
      // 必须先确认双方 state 都存在，再比对（漏查存在性是常见错误）
      if (!code || !state || !stateCookie || state !== stateCookie) return fail('github_state');

      try {
        const token = await exchangeCode(code);          // access token 用完即弃，不落库
        const identity = await fetchGithubIdentity(token);

        let user = db.select().from(users).where(eq(users.githubId, identity.githubId)).get();
        if (!user) {
          // 仅信 verified 邮箱做关联：同邮箱既有账号 → 自动绑定
          const byEmail = db.select().from(users).where(eq(users.email, identity.email)).get();
          if (byEmail) {
            db.update(users).set({ githubId: identity.githubId }).where(eq(users.id, byEmail.id)).run();
            user = { ...byEmail, githubId: identity.githubId };
          } else {
            if (env.registrationMode !== 'open') return fail('signup_closed');
            user = {
              id: uid(),
              email: identity.email,
              passwordHash: '',                          // OAuth-only：空串 = 禁用密码登录
              githubId: identity.githubId,
              createdAt: Date.now(),
            };
            db.insert(users).values(user).run();
          }
        }
        const { token: session } = createSession(user.id);
        return reply.setCookie(SESSION_COOKIE, session, COOKIE_OPTS).redirect('/trips');
      } catch (err) {
        request.log.warn({ err }, 'github oauth failed');
        return fail(err instanceof GithubOauthError ? err.code : 'github_failed');
      }
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
