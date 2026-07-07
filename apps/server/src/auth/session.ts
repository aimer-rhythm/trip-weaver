// 会话：随机 256bit token 下发 Cookie，库中仅存 sha256 哈希；30 天滑动续期
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, lt } from 'drizzle-orm';
import { db } from '../db/client';
import { sessions, users } from '../db/schema';
import { uid } from '@tripweaver/shared';

export const SESSION_COOKIE = 'tw_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RENEW_THRESHOLD_MS = 15 * 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createSession(userId: string): { token: string; expiresAt: number } {
  const token = randomBytes(32).toString('hex');
  const now = Date.now();
  db.insert(sessions)
    .values({ id: uid(), userId, tokenHash: hashToken(token), expiresAt: now + SESSION_TTL_MS, createdAt: now })
    .run();
  // 顺手清理该用户的过期会话
  db.delete(sessions).where(and(eq(sessions.userId, userId), lt(sessions.expiresAt, now))).run();
  return { token, expiresAt: now + SESSION_TTL_MS };
}

export function validateSession(token: string): { id: string; email: string } | null {
  const now = Date.now();
  const row = db
    .select({ sessionId: sessions.id, expiresAt: sessions.expiresAt, userId: users.id, email: users.email })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, now)))
    .get();
  if (!row) return null;
  if (row.expiresAt - now < RENEW_THRESHOLD_MS) {
    db.update(sessions).set({ expiresAt: now + SESSION_TTL_MS }).where(eq(sessions.id, row.sessionId)).run();
  }
  return { id: row.userId, email: row.email };
}

export function destroySession(token: string): void {
  db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token))).run();
}
