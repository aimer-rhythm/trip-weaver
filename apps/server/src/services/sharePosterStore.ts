// 分享海报成品的持久层：图片按内容寻址落盘 data/media/share-posters/，库表只存索引。
// 表主键 (trip_id, style) 即「同一行程同一风格只留最新一张」，被替换的旧文件在写入后删除。
// 磁盘与数据库都通过 createSharePosterStore 注入，单测用内存实现即可避开副作用。
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq } from 'drizzle-orm';
import type { TripShareImageResponse, TripShareImageStyle } from '@tripweaver/shared';
import { db } from '../db/client';
import { tripShareImages } from '../db/schema';
import { createSerialQueue } from '../lib/serialQueue';

type MimeType = TripShareImageResponse['mimeType'];

export type StoredSharePoster = { promptHash: string; image: TripShareImageResponse };
export type SharePosterInput = {
  userId: string;
  tripId: string;
  style: TripShareImageStyle;
  promptHash: string;
  bytes: Buffer;
  mimeType: MimeType;
};

export interface SharePosterStore {
  /** 没有记录、mime_type 异常或磁盘文件已丢失时返回 null，调用方据此重新生成 */
  find(userId: string, tripId: string, style: TripShareImageStyle): Promise<StoredSharePoster | null>;
  /** 覆盖写入：先落盘再 upsert，最后删除被替换的旧文件 */
  save(input: SharePosterInput): Promise<StoredSharePoster>;
}

// 与 photoStore 同一媒体根：index.ts 已把 data/media 以 /media/ 前缀静态托管（dev 与 prod）
const MEDIA_ROOT = fileURLToPath(new URL('../../../../data/media/', import.meta.url));
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const FILE_NAME = /^[a-f0-9]{64}\.(?:png|jpg|webp)$/;
const EXTENSIONS: Record<MimeType, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const MIME_TYPES: MimeType[] = ['image/png', 'image/jpeg', 'image/webp'];
const diskQueue = createSerialQueue(0);

export const sharePosterUrl = (fileName: string): string => `/media/share-posters/${fileName}`;

function mimeTypeOf(value: string): MimeType | null {
  return MIME_TYPES.includes(value as MimeType) ? value as MimeType : null;
}

async function onDisk(root: string, fileName: string): Promise<boolean> {
  if (!FILE_NAME.test(fileName)) return false;
  try {
    const info = await stat(path.join(root, 'share-posters', fileName));
    return info.isFile() && info.size > 0 && info.size <= MAX_IMAGE_BYTES;
  } catch { return false; }
}

async function writePoster(root: string, fileName: string, bytes: Buffer): Promise<void> {
  // 内容寻址：同名文件必然同内容，已存在就不重写（Windows 下 rename 覆盖已存在文件会失败）
  if (await onDisk(root, fileName)) return;
  const directory = path.join(root, 'share-posters');
  const target = path.join(directory, fileName);
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(temporary, bytes, { flag: 'wx' });
    await rename(temporary, target);
  } finally { await unlink(temporary).catch(() => {}); }
}

async function removePoster(root: string, fileName: string): Promise<void> {
  if (!FILE_NAME.test(fileName)) return;
  await unlink(path.join(root, 'share-posters', fileName)).catch(() => {});
}

export function createSharePosterStore(root = MEDIA_ROOT): SharePosterStore {
  return {
    async find(userId, tripId, style) {
      const [row] = await db.select({
        promptHash: tripShareImages.promptHash, fileName: tripShareImages.fileName, mimeType: tripShareImages.mimeType,
      }).from(tripShareImages)
        .where(and(eq(tripShareImages.userId, userId), eq(tripShareImages.tripId, tripId), eq(tripShareImages.style, style)))
        .limit(1);
      const mime = row ? mimeTypeOf(row.mimeType) : null;
      if (!row || !mime || !await onDisk(root, row.fileName)) return null;
      return { promptHash: row.promptHash, image: { url: sharePosterUrl(row.fileName), mimeType: mime } };
    },

    async save({ userId, tripId, style, promptHash, bytes, mimeType }) {
      if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('海报图片大小异常');
      const fileName = `${createHash('sha256').update(bytes).digest('hex')}.${EXTENSIONS[mimeType]}`;
      await diskQueue(() => writePoster(root, fileName, bytes));
      const [previous] = await db.select({ fileName: tripShareImages.fileName }).from(tripShareImages)
        .where(and(eq(tripShareImages.userId, userId), eq(tripShareImages.tripId, tripId), eq(tripShareImages.style, style)))
        .limit(1);
      const createdAt = new Date();
      await db.insert(tripShareImages).values({ userId, tripId, style, promptHash, fileName, mimeType, createdAt })
        .onConflictDoUpdate({
          target: [tripShareImages.tripId, tripShareImages.style],
          set: { userId, promptHash, fileName, mimeType, createdAt },
        });
      // 旧图可能仍被浏览器缓存引用，但库里已不再指向它，删掉避免磁盘无限增长
      if (previous && previous.fileName !== fileName) await removePoster(root, previous.fileName);
      return { promptHash, image: { url: sharePosterUrl(fileName), mimeType } };
    },
  };
}

export const sharePosterStore = createSharePosterStore();
