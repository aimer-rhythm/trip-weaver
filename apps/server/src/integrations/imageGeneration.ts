import type { TripShareImageResponse } from '@tripweaver/shared';
import { assertSafeBaseUrl } from './ssrfGuard';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_JSON_BYTES = 15 * 1024 * 1024;
export interface ImageGenerationConfig { baseUrl: string; apiKey: string; model: string }

export function imageError(message: string, statusCode = 502) {
  return Object.assign(new Error(message), { statusCode });
}

async function readLimited(response: Response, limit: number): Promise<Buffer> {
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    throw imageError('生成图片过大，请重试');
  }
  if (!response.body) throw imageError('生图服务返回空内容');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) throw imageError('生成图片过大，请重试');
      chunks.push(chunk.value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return Buffer.concat(chunks);
}

export function encodeShareImage(bytes: Buffer): TripShareImageResponse {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw imageError('生成图片大小异常');
  let mimeType: TripShareImageResponse['mimeType'];
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) mimeType = 'image/png';
  else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) mimeType = 'image/jpeg';
  else if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') mimeType = 'image/webp';
  else throw imageError('生图服务未返回有效的 PNG、JPEG 或 WebP 图片');
  return { dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}`, mimeType };
}

export async function generateShareImage(config: ImageGenerationConfig, prompt: string): Promise<TripShareImageResponse> {
  if (!config.apiKey) throw imageError('AI 生图尚未配置，请管理员设置 IMAGE_API_KEY', 503);
  const signal = AbortSignal.timeout(180_000);
  try {
    await assertSafeBaseUrl(config.baseUrl);
    const base = new URL(config.baseUrl);
    if (base.username || base.password || base.search || base.hash) throw imageError('生图接口地址配置不正确', 503);
    const response = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/images/generations`, {
      method: 'POST', signal, redirect: 'error',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, prompt, n: 1, size: '1024x1536' }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw imageError(response.status === 401 || response.status === 403 ? '生图服务鉴权失败，请管理员检查配置' : response.status === 429 ? '生图服务繁忙或额度不足，请稍后重试' : `生图服务暂不可用（HTTP ${response.status}）`);
    }
    let body: unknown;
    try { body = JSON.parse((await readLimited(response, MAX_JSON_BYTES)).toString('utf8')); }
    catch (error) { if (error instanceof Error && 'statusCode' in error) throw error; throw imageError('生图服务响应格式异常'); }
    const first = body && typeof body === 'object' && 'data' in body && Array.isArray(body.data) ? body.data[0] as unknown : undefined;
    if (!first || typeof first !== 'object') throw imageError('生图服务没有返回图片');
    if ('b64_json' in first && typeof first.b64_json === 'string' && first.b64_json) {
      if (first.b64_json.length > MAX_JSON_BYTES || !/^[A-Za-z0-9+/]+={0,2}$/.test(first.b64_json)) throw imageError('生图服务图片编码异常');
      return encodeShareImage(Buffer.from(first.b64_json, 'base64'));
    }
    if ('url' in first && typeof first.url === 'string') {
      const url = new URL(first.url);
      if (url.protocol !== 'https:' || url.username || url.password) throw imageError('生图服务返回不安全的图片地址');
      await assertSafeBaseUrl(url.href);
      // Never forward provider authorization to a returned CDN URL or follow redirects.
      const image = await fetch(url, { signal, redirect: 'error' });
      if (!image.ok) { await image.body?.cancel(); throw imageError('生成图片下载失败，请重试'); }
      return encodeShareImage(await readLimited(image, MAX_IMAGE_BYTES));
    }
    throw imageError('生图服务没有返回图片');
  } catch (error) {
    if (error instanceof Error && 'statusCode' in error) throw error;
    throw imageError(signal.aborted ? '图片生成超时，请稍后重试' : '无法连接生图服务，请稍后重试');
  }
}
