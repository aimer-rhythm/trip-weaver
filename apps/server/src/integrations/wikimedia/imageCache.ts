import { createHash } from 'node:crypto';
import { dataStore } from '../../lib/dataStore';
import { mediaCacheControl, type MediaStore } from '../../lib/mediaStore';

const DIRECTORY = 'media/wikimedia';
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const USER_AGENT = 'Tripweaver/0.1 (https://github.com/aimer-rhythm/trip-weaver)';

function extension(bytes: Uint8Array): string | null {
  const text = Buffer.from(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (text.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (text.toString('ascii', 0, 4) === 'RIFF' && text.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (['GIF87a', 'GIF89a'].includes(text.toString('ascii', 0, 6))) return 'gif';
  return null;
}

const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
};

/** Only API-selected Wikimedia raster images; no arbitrary URL proxy. */
export async function downloadWikiImage(url: string): Promise<Buffer | null> {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port ||
    !['upload.wikimedia.org', 'thumb.wikimedia.org'].includes(parsed.hostname)) return null;
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'image/*' },
    redirect: 'error', signal: AbortSignal.timeout(8_000),
  });
  if (response.status === 429 || response.status >= 500) {
    await response.body?.cancel();
    throw new Error(`wikimedia image http ${response.status}`);
  }
  if (response.status !== 200 || !/^image\/(jpeg|png|webp|gif)(;|$)/i.test(response.headers.get('content-type') || '') ||
      Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) {
    await response.body?.cancel();
    return null;
  }
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_IMAGE_BYTES) return null;
      chunks.push(next.value);
    }
  } finally { await reader.cancel(); }
  const bytes = Buffer.concat(chunks);
  return extension(bytes) ? bytes : null;
}

/**
 * 内容寻址写入，先落存储再返回同源 URL；`.json` sidecar 保留原图出处。
 * 不加容量上限：命中同一 sha256 的内容必然相同，重复缓存只会被 exists 短路；
 * 旧实现按目录总量 256 MiB 上限丢弃新图，线上实际已触顶而无法自愈。
 */
export async function cacheWikiImage(url: string, store: MediaStore = dataStore): Promise<string | null> {
  const bytes = await downloadWikiImage(url);
  if (!bytes) return null;
  const suffix = extension(bytes)!;
  const filename = `${createHash('sha256').update(bytes).digest('hex')}.${suffix}`;
  const key = `${DIRECTORY}/${filename}`;
  if (!await store.exists(key)) {
    await store.put(key, bytes, { contentType: CONTENT_TYPES[suffix], cacheControl: mediaCacheControl(key) });
    await store.put(`${key}.json`, Buffer.from(JSON.stringify({ source: url, provider: 'Wikimedia', cachedAt: new Date().toISOString() })),
      { contentType: 'application/json', cacheControl: 'public, max-age=86400' });
  }
  return `/media/wikimedia/${filename}`;
}
