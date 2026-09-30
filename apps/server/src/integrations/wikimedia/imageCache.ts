import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../../../data/media/wikimedia/', import.meta.url));
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_CACHE_BYTES = 256 * 1024 * 1024;
const USER_AGENT = 'Tripweaver/0.1 (https://github.com/aimer-rhythm/trip-weaver)';

function extension(bytes: Uint8Array): string | null {
  const text = Buffer.from(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (text.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (text.toString('ascii', 0, 4) === 'RIFF' && text.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (['GIF87a', 'GIF89a'].includes(text.toString('ascii', 0, 6))) return 'gif';
  return null;
}

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

/** Persist bytes before returning a same-origin URL; sidecar retains original provenance. */
export async function cacheWikiImage(url: string, root = ROOT): Promise<string | null> {
  const bytes = await downloadWikiImage(url);
  if (!bytes) return null;
  const filename = `${createHash('sha256').update(bytes).digest('hex')}.${extension(bytes)}`;
  await mkdir(root, { recursive: true });
  const target = path.join(root, filename);
  try {
    if ((await readFile(target)).equals(bytes)) return `/media/wikimedia/${filename}`;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const sizes = await Promise.all((await readdir(root)).map(async name => (await stat(path.join(root, name))).size));
  if (sizes.reduce((sum, size) => sum + size, 0) + bytes.length > MAX_CACHE_BYTES) return null;
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, bytes, { flag: 'wx' });
  await rename(temporary, target);
  await writeFile(`${target}.json`, JSON.stringify({ source: url, provider: 'Wikimedia', cachedAt: new Date().toISOString() }));
  return `/media/wikimedia/${filename}`;
}
