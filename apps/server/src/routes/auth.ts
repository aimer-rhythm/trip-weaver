import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { randomBytes } from 'node:crypto';
import { Type } from '@sinclair/typebox';
import { eq } from 'drizzle-orm';
import { EmailCodeBodySchema, LoginBodySchema, PasswordResetBodySchema, RegisterBodySchema, uid } from '@tripweaver/shared';
import { db } from '../db/client';
import { sessions, users } from '../db/schema';
import { hashPassword, verifyPassword } from '../auth/password';
import { consumeEmailCode, issueEmailCode, EmailCodeError } from '../auth/emailCode';
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
import { requireAuth, resolveUser } from '../auth/guard';
import { env, hasEmailDelivery, hasGithubOauth } from '../env';

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
    // 发信通道是否就绪（10-18）：前端据此决定开放按钮还是提示「注册暂不可用」
    emailCodeEnabled: hasEmailDelivery(),
  }));

  // 发送邮箱验证码（10-18）：open 模式注册 + 找回密码共用。
  // IP 限流 10 次/小时；同邮箱的 60 秒与 5 次/小时频控在 emailCode.ts。
  app.post(
    '/email-code',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
      schema: { body: EmailCodeBodySchema },
    },
    async (request, reply) => {
      const { email, purpose } = request.body;
      const normalized = email.trim().toLowerCase();
      if (!hasEmailDelivery()) return reply.code(503).send({ error: '邮件服务未配置，暂时无法发送验证码' });
      if (purpose === 'register' && env.registrationMode !== 'open') {
        return reply.code(403).send({ error: '当前注册方式不需要邮箱验证' });
      }
      // 注册码：邮箱已存在则静默成功；重置码：邮箱不存在或为 OAuth-only 账号也静默成功。
      // 两者都是为了不泄露账号是否存在，代价是这种情况下用户收不到信。
      const [existing] = await db.select({ id: users.id, passwordHash: users.passwordHash }).from(users).where(eq(users.email, normalized));
      if (purpose === 'register' ? Boolean(existing) : !existing || !existing.passwordHash) {
        return reply.send({ ok: true });
      }
      try {
        await issueEmailCode(normalized, purpose);
      } catch (err) {
        if (err instanceof EmailCodeError) return reply.code(err.status).send({ error: err.message });
        request.log.warn({ err, purpose }, 'email code delivery failed');
        return reply.code(502).send({ error: '验证码邮件发送失败，请稍后重试' });
      }
      return reply.send({ ok: true });
    },
  );

  app.post(
    '/register',
    {
      config: { rateLimit: { max: 3, timeWindow: '1 minute' } },
      schema: { body: RegisterBodySchema },
    },
    async (request, reply) => {
      const { email, password, inviteCode, code } = request.body;
      if (env.registrationMode === 'closed') {
        return reply.code(403).send({ error: '注册暂未开放，请联系站长' });
      }
      if (env.registrationMode === 'invite' && !checkInviteCode(inviteCode ?? '')) {
        return reply.code(403).send({ error: '邀请码不正确' });
      }
      const normalized = email.trim().toLowerCase();
      const exists = await db.select({ id: users.id }).from(users).where(eq(users.email, normalized));
      if (exists.length) {
        return reply.code(409).send({ error: '该邮箱已注册' });
      }
      // open 模式无邀请码门槛，改用邮箱验证码证明邮箱归属（10-18）；invite 模式沿用邀请码，不叠加。
      // 查重放在验证码之前：已注册邮箱不必消耗一个验证码
      if (env.registrationMode === 'open') {
        if (!hasEmailDelivery()) return reply.code(503).send({ error: '邮件服务未配置，暂时无法注册' });
        if (!code) return reply.code(400).send({ error: '请输入邮箱验证码' });
        if (!(await consumeEmailCode(normalized, 'register', code))) {
          return reply.code(400).send({ error: '验证码不正确或已过期' });
        }
      }
      const user = { id: uid(), email: normalized, passwordHash: await hashPassword(password), createdAt: new Date() };
      await db.insert(users).values(user);
      const { token } = await createSession(user.id);
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
      const [row] = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase()));
      // 统一失败文案，不泄露账号是否存在；passwordHash 为空 = OAuth-only 账号，禁用密码登录
      if (!row || !row.passwordHash || !(await verifyPassword(password, row.passwordHash))) {
        return reply.code(401).send({ error: '邮箱或密码不正确' });
      }
      const { token } = await createSession(row.id);
      return reply.setCookie(SESSION_COOKIE, token, COOKIE_OPTS).send({ id: row.id, email: row.email });
    },
  );

  // 凭邮箱验证码重置密码（10-18）：重置成功后该用户全部会话作废，必须重新登录
  app.post(
    '/password-reset',
    {
      config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
      schema: { body: PasswordResetBodySchema },
    },
    async (request, reply) => {
      const { email, code, password } = request.body;
      if (!hasEmailDelivery()) return reply.code(503).send({ error: '邮件服务未配置，暂时无法重置密码' });
      const normalized = email.trim().toLowerCase();
      const [row] = await db.select().from(users).where(eq(users.email, normalized));
      // OAuth-only 账号（空 hash）不走密码重置：保持「GitHub 注册的账号没有密码」这一既有语义
      if (!row || !row.passwordHash || !(await consumeEmailCode(normalized, 'reset', code))) {
        return reply.code(400).send({ error: '验证码不正确或已过期' });
      }
      await db.update(users).set({ passwordHash: await hashPassword(password) }).where(eq(users.id, row.id));
      await db.delete(sessions).where(eq(sessions.userId, row.id));
      return reply.send({ ok: true });
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

        let user = (await db.select().from(users).where(eq(users.githubId, identity.githubId)))[0];
        if (!user) {
          // 仅信 verified 邮箱做关联：同邮箱既有账号 → 自动绑定
          const byEmail = (await db.select().from(users).where(eq(users.email, identity.email)))[0];
          if (byEmail) {
            await db.update(users).set({ githubId: identity.githubId }).where(eq(users.id, byEmail.id));
            user = { ...byEmail, githubId: identity.githubId };
          } else {
            if (env.registrationMode !== 'open') return fail('signup_closed');
            user = {
              id: uid(),
              email: identity.email,
              passwordHash: '',                          // OAuth-only：空串 = 禁用密码登录
              githubId: identity.githubId,
              createdAt: new Date(),
            };
            await db.insert(users).values(user);
          }
        }
        const { token: session } = await createSession(user.id);
        return reply.setCookie(SESSION_COOKIE, session, COOKIE_OPTS).redirect('/trips');
      } catch (err) {
        request.log.warn({ err }, 'github oauth failed');
        return fail(err instanceof GithubOauthError ? err.code : 'github_failed');
      }
    },
  );

  app.post('/logout', { preHandler: requireAuth }, async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await destroySession(token);
    return reply.clearCookie(SESSION_COOKIE, { path: '/' }).send({ ok: true });
  });

  // 未登录返回 200 + data:null：访客态是正常状态，401 只会让浏览器在控制台打红字
  app.get('/me', async (request) => resolveUser(request));
};
