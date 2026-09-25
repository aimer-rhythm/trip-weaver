// 会话 / 消息 / Brief 的数据库操作。
// 遵循目录规范：路由只管 HTTP，服务层负责查询与所有权谓词（每个读写都带 userId）。
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  BRIEF_STATUSES,
  CHAT_MESSAGE_ROLES,
  CONVERSATION_STATUSES,
  requiredBriefFields,
  uid,
  type BriefIntake,
  type BriefStatus,
  type ChatMessage,
  type Conversation,
  type ConversationDetail,
  type ConversationStatus,
  type ConversationTripRef,
  type PlanningBriefData,
  type PlanningBriefView,
} from '@tripweaver/shared';
import { normalizeBriefData } from '../chat/brief';
import { db } from '../db/client';
import { chatMessages, conversations, generations, planningBriefs, trips } from '../db/schema';

export const DEFAULT_CONVERSATION_TITLE = '新对话';
const TITLE_MAX = 30;

type ConversationRow = typeof conversations.$inferSelect;
type BriefRow = typeof planningBriefs.$inferSelect;
type MessageRow = typeof chatMessages.$inferSelect;

function oneOf<T extends readonly string[]>(values: T, value: unknown, fallback: T[number]): T[number] {
  return typeof value === 'string' && (values as readonly string[]).includes(value) ? (value as T[number]) : fallback;
}

/** Brief 视图从 data 派生 missingFields —— 不落库，避免两处状态漂移 */
function toBriefView(row: BriefRow | null | undefined, fallbackAt: Date): PlanningBriefView {
  const data = normalizeBriefData(row?.data);
  return {
    status: oneOf(BRIEF_STATUSES, row?.status, 'collecting'),
    data,
    missingFields: requiredBriefFields(data),
    updatedAt: (row?.updatedAt ?? fallbackAt).getTime(),
  };
}

function toConversation(row: ConversationRow, brief?: BriefRow | null): Conversation {
  return {
    id: row.id,
    title: row.title,
    status: oneOf(CONVERSATION_STATUSES, row.status, 'active'),
    brief: toBriefView(brief, row.createdAt),
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

function toChatMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    conversationId: row.conversationId,
    role: oneOf(CHAT_MESSAGE_ROLES, row.role, 'assistant'),
    content: row.content,
    sequence: row.sequence,
    ...(row.intake ? { intake: row.intake as BriefIntake } : {}),
    ...(row.relatedTripId ? { relatedTripId: row.relatedTripId } : {}),
    createdAt: row.createdAt.getTime(),
  };
}

/** 会话 + 其 Brief 的联合读取，供列表与详情共用 */
async function selectConversations(userId: string, id?: string): Promise<Conversation[]> {
  const where = id
    ? and(eq(conversations.userId, userId), eq(conversations.id, id))
    : eq(conversations.userId, userId);
  const rows = await db
    .select({ conversation: conversations, brief: planningBriefs })
    .from(conversations)
    .leftJoin(planningBriefs, eq(planningBriefs.conversationId, conversations.id))
    .where(where)
    .orderBy(desc(conversations.updatedAt));
  return rows.map((r) => toConversation(r.conversation, r.brief));
}

export function listConversations(userId: string): Promise<Conversation[]> {
  return selectConversations(userId);
}

export async function getConversation(userId: string, id: string): Promise<Conversation | null> {
  const [conversation] = await selectConversations(userId, id);
  return conversation ?? null;
}

/**
 * 行程 → 来源会话反查（09-24 R2：编辑器内嵌对话用）。
 * 沿版本链找：generations.conversationId（生成/整单重跑产出）优先，
 * 其次 chat_messages.relatedTripId（按需编辑产出，编辑不写 generations）。
 * 都没有（表单时代/导入的行程）返回 null，编辑器据此隐藏对话面板。
 */
export async function findConversationForTrip(userId: string, tripId: string): Promise<string | null> {
  const [anchor] = await db
    .select({ rootId: trips.rootId })
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.userId, userId)));
  if (!anchor) return null;
  const chainIds = db.select({ id: trips.id }).from(trips).where(and(eq(trips.rootId, anchor.rootId), eq(trips.userId, userId)));
  const [fromGeneration] = await db
    .select({ conversationId: generations.conversationId })
    .from(generations)
    .where(and(eq(generations.userId, userId), inArray(generations.tripId, chainIds)))
    .orderBy(desc(generations.createdAt))
    .limit(1);
  if (fromGeneration?.conversationId) return fromGeneration.conversationId;
  const [fromMessage] = await db
    .select({ conversationId: chatMessages.conversationId })
    .from(chatMessages)
    .where(and(eq(chatMessages.userId, userId), inArray(chatMessages.relatedTripId, chainIds)))
    .orderBy(desc(chatMessages.sequence))
    .limit(1);
  return fromMessage?.conversationId ?? null;
}

/**
 * 本会话当前生效的行程（修订目标 + 版本引用）。
 * 两个来源取版本更高者：generations 行（生成/整单重跑产出）与
 * chat_messages.relatedTripId（09-24 R1 按需编辑产出 —— 编辑不写 generations，
 * 不看消息来源的话，下一轮「再改一下」会锚回旧版本）。
 */
export async function latestConversationTrip(
  userId: string,
  conversationId: string,
): Promise<ConversationTripRef | null> {
  const [fromGeneration] = await db
    .select({ id: trips.id, title: trips.title, version: trips.version })
    .from(generations)
    .innerJoin(trips, eq(trips.id, generations.tripId))
    .where(
      and(
        eq(generations.conversationId, conversationId),
        eq(generations.userId, userId),
        eq(generations.status, 'done'),
      ),
    )
    .orderBy(desc(generations.createdAt))
    .limit(1);
  const [fromMessage] = await db
    .select({ id: trips.id, title: trips.title, version: trips.version })
    .from(chatMessages)
    .innerJoin(trips, eq(trips.id, chatMessages.relatedTripId))
    .where(and(eq(chatMessages.conversationId, conversationId), eq(chatMessages.userId, userId)))
    .orderBy(desc(chatMessages.sequence))
    .limit(1);
  if (!fromGeneration) return fromMessage ?? null;
  if (!fromMessage) return fromGeneration;
  // 同一版本链内比版本；消息指向不同链（理论不该发生）时信生成记录
  return fromMessage.version > fromGeneration.version ? fromMessage : fromGeneration;
}

export async function getConversationDetail(userId: string, id: string): Promise<ConversationDetail | null> {
  const conversation = await getConversation(userId, id);
  if (!conversation) return null;
  const rows = await db
    .select()
    .from(chatMessages)
    .where(and(eq(chatMessages.conversationId, id), eq(chatMessages.userId, userId)))
    .orderBy(asc(chatMessages.sequence));
  const latestTrip = await latestConversationTrip(userId, id);
  return { conversation, messages: rows.map(toChatMessage), ...(latestTrip ? { latestTrip } : {}) };
}

/** 新建会话同时建好空的 Brief：保证「会话存在 ⇒ Brief 行存在」，读取路径无需合成假数据 */
export async function createConversation(userId: string, title?: string): Promise<Conversation> {
  const now = new Date();
  const id = uid();
  const data: PlanningBriefData = { constraints: [] };
  await db.transaction(async (tx) => {
    await tx.insert(conversations).values({
      id,
      userId,
      title: title?.trim().slice(0, TITLE_MAX) || DEFAULT_CONVERSATION_TITLE,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(planningBriefs).values({ conversationId: id, userId, status: 'collecting', data, updatedAt: now });
  });
  const conversation = await getConversation(userId, id);
  if (!conversation) throw new Error('会话创建后读取失败');
  return conversation;
}

export async function deleteConversation(userId: string, id: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .delete(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
      .returning({ id: conversations.id });
    if (rows.length === 0) return false;
    await tx.delete(chatMessages).where(and(eq(chatMessages.conversationId, id), eq(chatMessages.userId, userId)));
    await tx.delete(planningBriefs).where(and(eq(planningBriefs.conversationId, id), eq(planningBriefs.userId, userId)));
    return true;
  });
}

export interface AppendMessageInput {
  role: 'user' | 'assistant';
  content: string;
  intake?: BriefIntake;
  relatedTripId?: string;
}

export interface AppendMessagesInput {
  userId: string;
  conversationId: string;
  messages: AppendMessageInput[];
}

/**
 * 成批追加消息（一轮对话 = 用户消息 + AI 回复，一次事务写入）。
 *
 * 为何成批：理解失败时不应留下半条会话记录、也不应消耗对话额度 ——
 * 与生成链路「失败不计配额」的现有约定保持一致。
 * sequence 靠 `SELECT … FOR UPDATE` 锁住会话行，避免并发写入撞号。
 * 归属校验失败返回 null（路由统一映射 404），不抛错。
 */
export async function appendMessages(input: AppendMessagesInput): Promise<ChatMessage[] | null> {
  const now = new Date();
  return db.transaction(async (tx) => {
    const [conversation] = await tx
      .select({ id: conversations.id, title: conversations.title })
      .from(conversations)
      .where(and(eq(conversations.id, input.conversationId), eq(conversations.userId, input.userId)))
      .for('update');
    if (!conversation) return null;

    const [maxRow] = await tx
      .select({ n: sql<number>`coalesce(max(${chatMessages.sequence}), 0)` })
      .from(chatMessages)
      .where(eq(chatMessages.conversationId, input.conversationId));
    const hadMessages = Number(maxRow?.n ?? 0) > 0;
    let sequence = Number(maxRow?.n ?? 0);

    const appended: ChatMessage[] = [];
    for (const message of input.messages) {
      sequence += 1;
      const id = uid();
      const values: typeof chatMessages.$inferInsert = {
        id,
        conversationId: input.conversationId,
        userId: input.userId,
        role: message.role,
        content: message.content,
        sequence,
        createdAt: now,
      };
      if (message.intake) values.intake = message.intake;
      if (message.relatedTripId) values.relatedTripId = message.relatedTripId;
      await tx.insert(chatMessages).values(values);
      appended.push({
        id,
        conversationId: input.conversationId,
        role: message.role,
        content: message.content,
        sequence,
        ...(message.intake ? { intake: message.intake } : {}),
        ...(message.relatedTripId ? { relatedTripId: message.relatedTripId } : {}),
        createdAt: now.getTime(),
      });
    }

    const patch: Partial<typeof conversations.$inferInsert> = { updatedAt: now };
    // 本会话的第一条消息顺手当标题；用户改过名（不再是默认标题）时不覆盖
    const firstUser = input.messages.find((m) => m.role === 'user');
    if (!hadMessages && firstUser && conversation.title === DEFAULT_CONVERSATION_TITLE) {
      patch.title = firstUser.content.trim().slice(0, TITLE_MAX) || DEFAULT_CONVERSATION_TITLE;
    }
    await tx.update(conversations).set(patch).where(eq(conversations.id, input.conversationId));

    return appended;
  });
}

/** 写入 Brief（整体替换 data）并同步 status；返回派生好的视图 */
export async function saveBrief(
  userId: string,
  conversationId: string,
  data: PlanningBriefData,
  status: BriefStatus,
): Promise<PlanningBriefView | null> {
  const now = new Date();
  const rows = await db
    .update(planningBriefs)
    .set({ data, status, updatedAt: now })
    .where(and(eq(planningBriefs.conversationId, conversationId), eq(planningBriefs.userId, userId)))
    .returning();
  const [row] = rows;
  if (!row) return null;
  await db.update(conversations).set({ updatedAt: now }).where(eq(conversations.id, conversationId));
  return toBriefView(row, now);
}

/** 记录某轮对话产出的行程（用于消息流里的「已生成」卡片） */
export async function linkMessageToTrip(userId: string, messageId: string, tripId: string): Promise<void> {
  await db
    .update(chatMessages)
    .set({ relatedTripId: tripId })
    .where(and(eq(chatMessages.id, messageId), eq(chatMessages.userId, userId)));
}
