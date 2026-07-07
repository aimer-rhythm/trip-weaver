// C0 冒烟 ②：@modelcontextprotocol/sdk 与 xiaohongshu-mcp 的 Streamable HTTP 握手
// 用法：XHS_MCP_URL=http://localhost:18060/mcp node scripts/smoke-mcp.mjs [--search 关键词]
// 核对架构 §12：握手 / 实际工具名清单 / search_feeds 与 get_feed_detail 返回结构
import { existsSync } from 'node:fs';
import { config } from 'dotenv';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

// 系统代理环境下 Node fetch 需显式接管；本地 MCP 走 noProxy 直连
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy) {
  setGlobalDispatcher(new EnvHttpProxyAgent({ noProxy: process.env.NO_PROXY ?? 'localhost,127.0.0.1,::1,host.docker.internal' }));
}

for (const p of ['apps/server/.env', '.env']) if (existsSync(p)) config({ path: p });

const url = process.env.XHS_MCP_URL ?? '';
if (!url) {
  console.error('[smoke-mcp] 缺少 XHS_MCP_URL（如 http://localhost:18060/mcp），无法握手。');
  console.error('[smoke-mcp] 未部署 MCP 时按计划走 NullContentSource 降级；部署后重跑本脚本。');
  process.exit(2);
}

// TripWeaver 只读用途所需工具（上游 13 个工具中的只读子集）
const REQUIRED = ['check_login_status', 'search_feeds', 'get_feed_detail'];

const client = new Client({ name: 'tripweaver-smoke', version: '0.1.0' });
const transport = new StreamableHTTPClientTransport(new URL(url));
await client.connect(transport);
console.log('[smoke-mcp] Streamable HTTP 握手成功');

const { tools } = await client.listTools();
const names = tools.map((t) => t.name);
console.log(`[smoke-mcp] 工具清单（${names.length}）：${names.join(', ')}`);
const missing = REQUIRED.filter((n) => !names.includes(n));
if (missing.length) {
  console.error(`[smoke-mcp] FAIL —— 缺少所需工具：${missing.join(', ')}（上游版本变动？更新适配器映射表）`);
  await client.close();
  process.exit(1);
}

const login = await client.callTool({ name: 'check_login_status', arguments: {} });
console.log('[smoke-mcp] check_login_status →', JSON.stringify(login.content).slice(0, 300));

const keyword = process.argv.includes('--search') ? process.argv[process.argv.indexOf('--search') + 1] : '';
if (keyword) {
  const res = await client.callTool({ name: 'search_feeds', arguments: { keyword } });
  const text = JSON.stringify(res.content).slice(0, 800);
  console.log(`[smoke-mcp] search_feeds("${keyword}") 返回片段：\n${text}`);
  console.log('[smoke-mcp] 请核对返回中 feed_id 与 xsec_token 字段路径，同步到适配器映射表');
}

await client.close();
console.log('[smoke-mcp] PASS —— 握手与只读工具集核对通过');
