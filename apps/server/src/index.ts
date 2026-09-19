import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { env } from './env';
import './lib/proxy';                        // 需在任何出站 fetch 之前接管代理
import './db/client';                       // 触发建库与迁移
import { SsrfError } from './integrations/ssrfGuard';
import { authRoutes } from './routes/auth';
import { settingsRoutes } from './routes/settings';
import { tripRoutes } from './routes/trips';
import { usageRoutes } from './routes/usage';
import { generationRoutes } from './routes/generations';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const app = Fastify({
    logger: { level: env.isProd ? 'info' : 'debug' },
  }).withTypeProvider<TypeBoxTypeProvider>();

  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  app.setErrorHandler((error: unknown, _request, reply) => {
    if (error instanceof SsrfError) {
      return reply.code(400).send({ error: error.message });
    }
    const err = error as { statusCode?: number; validation?: unknown; message?: string };
    if (err.validation) {
      return reply.code(400).send({ error: '请求参数不正确', detail: err.message });
    }
    const statusCode = err.statusCode ?? 500;
    if (statusCode >= 500) app.log.error(error);
    return reply.code(statusCode).send({ error: statusCode >= 500 ? '服务器内部错误' : (err.message ?? '请求失败') });
  });

  app.get('/api/health', async () => ({
    ok: true,
    name: 'tripweaver',
    time: Date.now(),
    commit: process.env.COMMIT_SHA ?? 'unknown',
    buildDate: process.env.BUILD_DATE ?? 'unknown',
  }));

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(settingsRoutes, { prefix: '/api/settings' });
  await app.register(tripRoutes, { prefix: '/api/trips' });
  await app.register(usageRoutes, { prefix: '/api/usage' });
  await app.register(generationRoutes, { prefix: '/api/generations' });

  // 生产模式：托管前端构建产物 + SPA fallback
  const webDist = path.resolve(__dirname, '../../web/dist');
  if (env.isProd && fs.existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist });
    app.setNotFoundHandler(async (request, reply) => {
      if (request.raw.url?.startsWith('/api/')) {
        return reply.code(404).send({ error: 'Not Found' });
      }
      return reply.sendFile('index.html');
    });
  }

  await app.listen({ port: env.port, host: '0.0.0.0' });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
