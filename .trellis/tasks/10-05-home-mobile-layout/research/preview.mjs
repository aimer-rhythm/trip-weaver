// 本地验收预览：使用构建产物与固定 API 数据，禁止业务写入。
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiFailure, apiSuccess } from '../../../../scripts/lib/api-contract.mjs';

const root = fileURLToPath(new URL('../../../../apps/web/dist/', import.meta.url));
const fixtures = {
  '/api/auth/me': { id: 'home-preview', email: 'preview@example.test' },
  '/api/auth/config': { registrationMode: 'open', githubEnabled: false },
  '/api/destinations/covered': { cities: ['北京', '上海', '厦门', '广州', '成都', '杭州', '重庆', '济南', '苏州', '西安', '青岛'] },
  '/api/settings/travel-preferences': { pace: 'moderate', partySize: 2, preferences: [], transportMode: 'transit', extraNotes: '' },
  '/api/usage': { remaining: 5, dailyLimit: 5 },
  '/api/generations/current': null,
  '/api/notifications': { items: [], hasUnread: false, readThrough: 0, nextCursor: null },
  '/api/trips': { items: [], total: 0, destinations: [] },
};
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname.startsWith('/api/')) {
      const allowed = req.method === 'GET' && Object.hasOwn(fixtures, pathname);
      res.writeHead(allowed ? 200 : 503, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(allowed ? apiSuccess(fixtures[pathname]) : apiFailure(503, '这是首页界面预览，不会创建或修改真实行程。')));
      return;
    }
    const file = resolve(root, `.${pathname}`);
    if ((file !== resolve(root) && !file.startsWith(resolve(root) + sep)) || req.method !== 'GET') { res.writeHead(404); res.end(); return; }
    const target = extname(file) ? file : resolve(root, 'index.html');
    const bytes = await readFile(target);
    res.writeHead(200, { 'content-type': mime[extname(target)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(bytes);
  } catch { res.writeHead(404); res.end(); }
}).listen(5175, '127.0.0.1', () => console.log('首页界面预览（隔离数据）：http://127.0.0.1:5175/'));
