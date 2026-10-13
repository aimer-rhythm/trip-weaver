// 已入选外链图的持久副本：图片按内容寻址存进对象存储的 `media/`，来源与地点索引存在 `photo-store/`；
// 成功记录不按时间过期。存储实现由调用方注入（默认见 lib/dataStore）。
import { createHash } from 'node:crypto';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { PoiPhotoSchema, type PoiPhoto, } from '@tripweaver/shared';
import { dataStore } from '../lib/dataStore';
import { mediaCacheControl, type MediaStore } from '../lib/mediaStore';
import { createSerialQueue } from '../lib/serialQueue';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const FileSchema = Type.Object({ source: Type.String(), filename: Type.String({ pattern: '^[a-f0-9]{64}\\.(jpg|png|webp)$' }) });
const SelectionSchema = Type.Object({ version: Type.Literal(1), city: Type.String(), name: Type.String(), photos: Type.Array(PoiPhotoSchema, { minItems: 1, maxItems: 3 }) });
const diskQueue = createSerialQueue(0);
const pending = new Map<string, Promise<string | null>>();
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const placeKey = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, '').toLowerCase();
const LOCAL_FILE = /^\/media\/(remote-photos|wikimedia)\/([a-f0-9]{64}\.(?:jpg|png|webp|gif))$/;
const CONTENT_TYPES: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

function allowedImage(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      (['images.pexels.com', 'upload.wikimedia.org', 'thumb.wikimedia.org', 'cdn.pixabay.com'].includes(url.hostname) ||
        (url.hostname === 'pixabay.com' && url.pathname.startsWith('/get/')));
  } catch { return false; }
}

function extension(bytes: Buffer): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) return 'gif';
  return null;
}

const mediaKey = (directory: string, filename: string): string => `media/${directory}/${filename}`;

async function atomicJson(store: MediaStore, key: string, value: unknown): Promise<void> {
  await store.put(key, Buffer.from(JSON.stringify(value)), { contentType: 'application/json' });
}

async function validLocal(store: MediaStore, filename: string, directory = 'remote-photos'): Promise<boolean> {
  if (!/^[a-f0-9]{64}\.(jpg|png|webp|gif)$/.test(filename)) return false;
  const bytes = await store.get(mediaKey(directory, filename));
  if (!bytes || bytes.length > MAX_IMAGE_BYTES) return false;
  return !!extension(bytes) && hash(bytes) === filename.split('.')[0];
}

/** URL 索引在下载前检查，跨地点和进程重启也能复用同一份文件。 */
export async function saveRemotePhoto(photo: PoiPhoto, store: MediaStore = dataStore): Promise<PoiPhoto | null> {
  if (!allowedImage(photo.url)) return null;
  const source = photo.url;
  const indexKey = `photo-store/sources/${hash(source)}.json`;
  let task = pending.get(indexKey);
  if (!task) {
    task = (async () => {
      try {
        const entry: unknown = JSON.parse((await store.get(indexKey))?.toString('utf8') ?? '');
        if (Value.Check(FileSchema, entry) && entry.source === source && await validLocal(store, entry.filename)) return `/media/remote-photos/${entry.filename}`;
      } catch { /* 首次入选或索引损坏，重新取得这张已选图片；不在这里搜索。 */ }
      const response = await fetch(source, { redirect: 'error', signal: AbortSignal.timeout(8_000), headers: { Accept: 'image/jpeg,image/png,image/webp' } });
      if (response.status !== 200 || !/^image\/(jpeg|png|webp)(;|$)/i.test(response.headers.get('content-type') ?? '') || Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) {
        await response.body?.cancel(); return null;
      }
      const reader = response.body?.getReader();
      if (!reader) return null;
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        for (;;) {
          const next = await reader.read(); if (next.done) break;
          size += next.value.byteLength;
          if (size > MAX_IMAGE_BYTES) return null;
          chunks.push(next.value);
        }
      } finally { await reader.cancel(); }
      const bytes = Buffer.concat(chunks), ext = extension(bytes);
      if (!ext) return null;
      const filename = `${hash(bytes)}.${ext}`;
      return diskQueue(async () => {
        if (!await validLocal(store, filename)) {
          // 不做容量上限：内容寻址的文件名内容必然相同，重复入选会被上一行的 validLocal 短路。
          await store.put(mediaKey('remote-photos', filename), bytes,
            { contentType: CONTENT_TYPES[ext], cacheControl: mediaCacheControl(mediaKey('remote-photos', filename)) });
        }
        await atomicJson(store, indexKey, { source, filename });
        return `/media/remote-photos/${filename}`;
      });
    })().catch(() => null).finally(() => pending.delete(indexKey));
    pending.set(indexKey, task);
  }
  const url = await task;
  return url ? { ...photo, url } : null;
}

type LocalPhotoProvider = 'pexels' | 'wikimedia' | 'pixabay';
function selectionKey(city: string, name: string, namespace: LocalPhotoProvider): string {
  const directory = namespace === 'wikimedia' ? 'wiki-places' : namespace === 'pixabay' ? 'pixabay-places' : 'places';
  return `photo-store/${directory}/${hash(JSON.stringify([placeKey(city), placeKey(name)]))}.json`;
}

/** null 表示首次检索；有记录但文件丢失时返回剩余本地图，不偷偷重新搜索。 */
export async function readPhotoSelection(city: string, name: string, store: MediaStore = dataStore, namespace: LocalPhotoProvider = 'pexels'): Promise<PoiPhoto[] | null> {
  try {
    const raw = await store.get(selectionKey(city, name, namespace));
    if (raw === null) return null;
    const entry: unknown = JSON.parse(raw.toString('utf8'));
    if (!Value.Check(SelectionSchema, entry) || entry.city !== placeKey(city) || entry.name !== placeKey(name)) return null;
    const photos: PoiPhoto[] = [];
    for (const photo of entry.photos) {
      const match = LOCAL_FILE.exec(photo.url);
      if (match?.[1] && match[2] && await validLocal(store, match[2], match[1])) photos.push(photo);
    }
    return photos;
  } catch { return null; }
}

export async function writePhotoSelection(city: string, name: string, photos: PoiPhoto[], store: MediaStore = dataStore, namespace: LocalPhotoProvider = 'pexels'): Promise<void> {
  if (!photos.length) return;
  const unique = photos.filter((photo, index) => photos.findIndex(entry => entry.url === photo.url) === index).slice(0, 3);
  const entry = { version: 1, city: placeKey(city), name: placeKey(name), photos: unique };
  if (!Value.Check(SelectionSchema, entry) || unique.some(photo => !LOCAL_FILE.test(photo.url))) throw new Error('Invalid local photo selection');
  await atomicJson(store, selectionKey(city, name, namespace), entry);
}
