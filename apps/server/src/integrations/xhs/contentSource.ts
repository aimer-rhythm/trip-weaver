// 小红书内容源接入层（架构 §6 / §12.1 映射表）
// ContentSource 接口 + XhsMcpContentSource（串行限速/TTL 缓存）+ NullContentSource 降级
// 原则：任何 MCP 故障都不抛错到上层 —— search 回空、getDetail 回 null、selfCheck 变红
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { env } from '../../env';
import { createSerialQueue } from '../../lib/serialQueue';
import { TtlCache } from '../../lib/ttlCache';

export interface XhsNote {
  id: string;
  xsecToken: string;        // 与 id 成对出现，get_feed_detail 必带
  title: string;
  snippet: string;
  likes: number;
  url: string;
}

export interface XhsNoteDetail {
  id: string;
  url: string;
  title: string;
  content: string;          // 已截断（控 token 成本，R8）
  authorName: string;
  likes: number;
  topComments: string[];
}

export interface XhsStatus {
  configured: boolean;
  checked: boolean;
  ok: boolean | null;
  loggedIn: boolean | null;
  message: string;
}

export interface ContentSource {
  readonly kind: 'xhs' | 'null';
  search(keyword: string): Promise<XhsNote[]>;
  getDetail(id: string, xsecToken: string): Promise<XhsNoteDetail | null>;
  selfCheck(): Promise<XhsStatus>;
}

// ---------- Null 降级 ----------

export class NullContentSource implements ContentSource {
  readonly kind = 'null' as const;
  constructor(private reason = '站点未配置小红书数据源') {}

  async search(): Promise<XhsNote[]> {
    return [];
  }
  async getDetail(): Promise<XhsNoteDetail | null> {
    return null;
  }
  async selfCheck(): Promise<XhsStatus> {
    return { configured: false, checked: true, ok: null, loggedIn: null, message: `${this.reason}（生成时自动降级为模型知识调研）` };
  }
}

// ---------- 宽容解析（实际返回结构以 scripts/smoke-mcp.mjs 在线核对为准） ----------

const MAX_CONTENT_CHARS = 800;
const MAX_COMMENT_CHARS = 100;
const MAX_COMMENTS = 5;
const MAX_SEARCH_RESULTS = 10;

function textOf(result: { content?: unknown }): string {
  const blocks = Array.isArray(result.content) ? result.content : [];
  return blocks
    .filter((b): b is { type: string; text: string } => typeof (b as { text?: unknown })?.text === 'string')
    .map((b) => b.text)
    .join('\n');
}

function tryJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

/** 在返回体中定位 feed 数组：顶层数组或常见容器字段，逐层向下找 */
function pickFeedArray(v: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 3 || v === null || typeof v !== 'object') return [];
  if (Array.isArray(v)) return v.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null);
  const obj = v as Record<string, unknown>;
  for (const key of ['feeds', 'notes', 'items', 'data', 'result', 'list']) {
    if (key in obj) {
      const found = pickFeedArray(obj[key], depth + 1);
      if (found.length) return found;
    }
  }
  return [];
}

function firstString(...vals: unknown[]): string {
  for (const v of vals) if (typeof v === 'string' && v) return v;
  return '';
}

function firstNumber(...vals: unknown[]): number {
  for (const v of vals) {
    const n = typeof v === 'string' ? Number.parseInt(v, 10) : v;
    if (typeof n === 'number' && Number.isFinite(n)) return n;
  }
  return 0;
}

function noteUrl(id: string, xsecToken: string): string {
  return `https://www.xiaohongshu.com/explore/${id}?xsec_token=${encodeURIComponent(xsecToken)}`;
}

function mapNote(raw: Record<string, unknown>): XhsNote | null {
  const card = (raw.note_card ?? raw.noteCard ?? {}) as Record<string, unknown>;
  const interact = (card.interact_info ?? raw.interact_info ?? {}) as Record<string, unknown>;
  const id = firstString(raw.feed_id, raw.id, raw.note_id, card.note_id);
  const xsecToken = firstString(raw.xsec_token, raw.xsecToken, card.xsec_token);
  if (!id || !xsecToken) return null;
  return {
    id,
    xsecToken,
    title: firstString(raw.title, card.display_title, card.title).slice(0, 100),
    snippet: firstString(raw.desc, card.desc, raw.snippet).slice(0, 120),
    likes: firstNumber(interact.liked_count, raw.likes, card.liked_count),
    url: noteUrl(id, xsecToken),
  };
}

function mapDetail(v: unknown, id: string, xsecToken: string, rawText: string): XhsNoteDetail {
  const root = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  const data = (root.data ?? root) as Record<string, unknown>;
  const note = (data.note ?? data.feed ?? data) as Record<string, unknown>;
  const user = (note.user ?? note.author ?? {}) as Record<string, unknown>;
  const interact = (note.interact_info ?? {}) as Record<string, unknown>;
  const rawComments = pickFeedArray((data.comments ?? note.comments) as unknown);
  return {
    id,
    url: noteUrl(id, xsecToken),
    title: firstString(note.title, note.display_title).slice(0, 100),
    // 解析不出结构时退回原始文本 —— 摘要化截断兜底
    content: (firstString(note.desc, note.content) || rawText).slice(0, MAX_CONTENT_CHARS),
    authorName: firstString(user.nickname, user.name),
    likes: firstNumber(interact.liked_count, note.liked_count),
    topComments: rawComments
      .map((c) => firstString(c.content, c.text).slice(0, MAX_COMMENT_CHARS))
      .filter(Boolean)
      .slice(0, MAX_COMMENTS),
  };
}

// ---------- MCP 实现 ----------

const XHS_MIN_INTERVAL_MS = 2000;             // 串行限速：只读保守姿态（架构 §6）
const XHS_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 目的地高度重合 → 24h 缓存提高命中率

export class XhsMcpContentSource implements ContentSource {
  readonly kind = 'xhs' as const;
  private client: Client | null = null;
  private queue = createSerialQueue(XHS_MIN_INTERVAL_MS);
  private searchCache = new TtlCache<XhsNote[]>(XHS_CACHE_TTL_MS, 200);
  private detailCache = new TtlCache<XhsNoteDetail>(XHS_CACHE_TTL_MS, 500);
  /** 真实外呼计数（缓存命中不计）——供全站日额度核算 */
  onRealCall?: () => void;

  constructor(private mcpUrl: string) {}

  private async getClient(): Promise<Client> {
    if (this.client) return this.client;
    const client = new Client({ name: 'tripweaver', version: '0.1.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(this.mcpUrl)));
    this.client = client;
    return client;
  }

  /** 串行 + 失败重连一次；再失败抛给调用方分支处理 */
  private callTool(name: string, args: Record<string, unknown>): Promise<{ content?: unknown }> {
    return this.queue(async () => {
      try {
        const client = await this.getClient();
        const result = await client.callTool({ name, arguments: args });
        this.onRealCall?.();
        return result as { content?: unknown };
      } catch (err) {
        this.client = null;                    // 连接可能已失效，下次重建
        throw err;
      }
    });
  }

  async search(keyword: string): Promise<XhsNote[]> {
    const key = keyword.trim().toLowerCase();
    const cached = this.searchCache.get(key);
    if (cached) return cached;
    try {
      const result = await this.callTool('search_feeds', { keyword });
      const text = textOf(result);
      const notes = pickFeedArray(tryJson(text))
        .map(mapNote)
        .filter((n): n is XhsNote => n !== null)
        .slice(0, MAX_SEARCH_RESULTS);
      this.searchCache.set(key, notes);
      return notes;
    } catch {
      return [];                               // 不抛错：调研 Agent 自动降级为模型知识
    }
  }

  async getDetail(id: string, xsecToken: string): Promise<XhsNoteDetail | null> {
    const cached = this.detailCache.get(id);
    if (cached) return cached;
    try {
      const result = await this.callTool('get_feed_detail', { feed_id: id, xsec_token: xsecToken });
      const text = textOf(result);
      const detail = mapDetail(tryJson(text), id, xsecToken, text);
      this.detailCache.set(id, detail);
      return detail;
    } catch {
      return null;
    }
  }

  async selfCheck(): Promise<XhsStatus> {
    try {
      const result = await this.callTool('check_login_status', {});
      const text = textOf(result);
      const parsed = tryJson(text) as Record<string, unknown> | undefined;
      const loggedIn =
        typeof parsed?.logged_in === 'boolean'
          ? parsed.logged_in
          : typeof parsed?.is_logged_in === 'boolean'
            ? parsed.is_logged_in
            : /已登录|logged.?in.{0,6}true|"login"\s*:\s*true/i.test(text);
      return {
        configured: true,
        checked: true,
        ok: true,
        loggedIn,
        message: loggedIn ? '小红书数据源连接正常' : 'MCP 已连通，但小红书账号未登录（生成时自动降级）',
      };
    } catch (err) {
      return {
        configured: true,
        checked: true,
        ok: false,
        loggedIn: null,
        message: `小红书 MCP 连接失败：${err instanceof Error ? err.message : '未知错误'}（生成时自动降级）`,
      };
    }
  }
}

// ---------- 任务级上限包装（单次生成 ≤6 搜索 + ≤8 详情，架构 §6） ----------

export const XHS_MAX_SEARCH_PER_TASK = 6;
export const XHS_MAX_DETAIL_PER_TASK = 8;

export interface TaskContentSource {
  source: ContentSource;
  stats: { searchCalls: number; detailCalls: number; gotResults: boolean };
}

export function createTaskContentSource(inner: ContentSource): TaskContentSource {
  const stats = { searchCalls: 0, detailCalls: 0, gotResults: false };
  const source: ContentSource = {
    kind: inner.kind,
    async search(keyword) {
      if (stats.searchCalls >= XHS_MAX_SEARCH_PER_TASK) return [];
      stats.searchCalls += 1;
      const notes = await inner.search(keyword);
      if (notes.length) stats.gotResults = true;
      return notes;
    },
    async getDetail(id, xsecToken) {
      if (stats.detailCalls >= XHS_MAX_DETAIL_PER_TASK) return null;
      stats.detailCalls += 1;
      const detail = await inner.getDetail(id, xsecToken);
      if (detail) stats.gotResults = true;
      return detail;
    },
    selfCheck: () => inner.selfCheck(),
  };
  return { source, stats };
}

// ---------- 单例 ----------

const nullSource = new NullContentSource();
const mcpSource = env.xhsMcpUrl ? new XhsMcpContentSource(env.xhsMcpUrl) : null;

/** 站点级内容源：未配置 XHS_MCP_URL 时为 Null 降级 */
export function getContentSource(): ContentSource {
  return mcpSource ?? nullSource;
}

/** 全站日额度用尽等场景下按需取用 Null 源（C2 配额检查用） */
export function getNullContentSource(): ContentSource {
  return nullSource;
}
