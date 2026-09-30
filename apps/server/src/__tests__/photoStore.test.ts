import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { saveRemotePhoto, readPhotoSelection, writePhotoSelection } from '../integrations/photoStore';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=', 'base64');
async function fixture(run: (root: string) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tripweaver-photo-store-'));
  try { await run(root); }
  finally { assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)); await fs.rm(root, { recursive: true, force: true }); }
}

test('并发入选合并下载、URL索引复用、按城市隔离且不按TTL重新搜索', async () => fixture(async root => {
  const previous = globalThis.fetch; let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls++;
    assert.equal(init?.redirect, 'error');
    return new Response(PNG, { headers: { 'Content-Type': 'image/png' } });
  };
  try {
    const input = { url: 'https://images.pexels.com/photos/1/one.jpeg' };
    const [one, two] = await Promise.all([saveRemotePhoto(input, root), saveRemotePhoto(input, root)]);
    assert.ok(one); assert.deepEqual(one, two); assert.equal(calls, 1);
    assert.deepEqual(await saveRemotePhoto(input, root), one); assert.equal(calls, 1);
    await writePhotoSelection('杭州', '西湖', [one], root);
    assert.deepEqual(await readPhotoSelection(' 杭州 ', '西湖', root), [one]);
    assert.equal(await readPhotoSelection('福州', '西湖', root), null);
    // 文件丢失时不把“曾入选”当成“没搜索过”；读取不触发下载或重新检索。
    const filename = one.url.split('/').at(-1)!;
    await fs.unlink(path.join(root, 'media/remote-photos', filename));
    assert.deepEqual(await readPhotoSelection('杭州', '西湖', root), []);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = previous; }
}));

test('拒绝任意域名、凭据、重定向、部分响应和超限图片；失败不落有效索引', async () => fixture(async root => {
  const previous = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(PNG, { headers: { 'Content-Type': 'image/png' } }); };
  try {
    for (const url of ['http://images.pexels.com/a.jpg', 'https://images.pexels.com.evil.test/a.jpg', 'https://user:pass@images.pexels.com/a.jpg', 'https://127.0.0.1/a.jpg']) {
      assert.equal(await saveRemotePhoto({ url }, root), null);
    }
    assert.equal(calls, 0);
    for (const response of [
      new Response(PNG, { status: 206, headers: { 'Content-Type': 'image/png' } }),
      new Response('redirect', { status: 302, headers: { Location: 'https://localhost/' } }),
      new Response(PNG, { headers: { 'Content-Type': 'image/png', 'Content-Length': String(9 * 1024 * 1024) } }),
      new Response('<html/>', { headers: { 'Content-Type': 'image/jpeg' } }),
      new Response(new Uint8Array(8 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'image/png' } }),
    ]) {
      globalThis.fetch = async () => response;
      assert.equal(await saveRemotePhoto({ url: 'https://images.pexels.com/photos/2/two.jpeg' }, root), null);
    }
    assert.equal(await readPhotoSelection('杭州', '西湖', root), null);
  } finally { globalThis.fetch = previous; }
}));
