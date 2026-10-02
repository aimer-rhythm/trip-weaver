// 本任务只读验收服务：审核总览和实际应用页面；任何写请求均拒绝。
import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const preview = path.join(here, 'preview');
const dist = path.join(root, 'apps/web/dist');
const trip = JSON.parse(await readFile(path.join(preview, 'trip.json'), 'utf8'));
const server = http.createServer(async (request, response) => {
  if (request.method !== 'GET') { response.writeHead(405); response.end('只读验收'); return; }
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname.startsWith('/api/')) {
      let value = {};
      if (pathname === '/api/auth/me') value = { id: 'preview', email: 'preview@example.test' };
      else if (pathname === '/api/usage') value = { remaining: 0, dailyLimit: 0 };
      else if (pathname === '/api/settings/config') value = { amapJsKey: '', amapJsSecurityCode: '' };
      else if (pathname.endsWith('/conversation')) value = { conversationId: 'preview-chat' };
      else if (pathname === '/api/conversations/preview-chat') value = { messages: [] };
      else if (pathname === '/api/trips/ranked-photos-preview') value = trip;
      response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)); return;
    }
    let base = preview;
    let relative = 'index.html';
    if (pathname.startsWith('/media/')) relative = pathname.slice(1);
    else if (pathname.startsWith('/assets/')) { base = dist; relative = pathname.slice(1); }
    else if (pathname === '/trips/ranked-photos-preview') { base = dist; relative = 'index.html'; }
    else if (pathname !== '/') { response.writeHead(404); response.end(); return; }
    const file = path.resolve(base, relative);
    if (!file.startsWith(path.resolve(base) + path.sep)) throw new Error('path');
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.woff2': 'font/woff2', '.png': 'image/png' };
    response.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(await readFile(file));
  } catch { if (!response.headersSent) response.writeHead(404); response.end(); }
});
server.listen(18841, '127.0.0.1', () => console.log('只读摄影验收：http://127.0.0.1:18841/'));
