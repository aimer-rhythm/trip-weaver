import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function readPhotoJson(file: string, maxBytes = 4 * 1024 * 1024): Promise<unknown> {
  try {
    if ((await stat(file)).size > maxBytes) return undefined;
    return JSON.parse(await readFile(file, 'utf8')) as unknown;
  } catch { return undefined; }
}
export async function writePhotoJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try { await writeFile(temp, JSON.stringify(value, null, 2), { flag: 'wx' }); await rename(temp, file); }
  finally { await unlink(temp).catch(() => {}); }
}
export async function photoResponseBytes(response: Response, limit: number): Promise<Buffer> {
  if (response.status !== 200 || Number(response.headers.get('content-length')) > limit || !response.body) {
    await response.body?.cancel(); throw new Error('photo response unavailable');
  }
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.length;
      if (size > limit) throw new Error('photo response too large');
      chunks.push(next.value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return Buffer.concat(chunks);
}
export function photoMime(bytes: Buffer): string | null {
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}
