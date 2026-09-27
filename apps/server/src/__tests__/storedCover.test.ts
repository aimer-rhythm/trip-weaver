// 单测：库内景点封面 key → 展示 URL（09-27）
// env 在模块加载时校验 MASTER_KEY，必须先备好环境再动态 import（同 geoPipeline.test.ts 的做法）。
import assert from 'node:assert/strict';
import { test } from 'node:test';

// 无条件赋值（不用 ??=/||=）：本套件不用真 key，只要能在 env.ts 校验时解析通过
process.env.MASTER_KEY = 'a'.repeat(64);

const { createStoredCoverLookup, mediaUrl } = await import('../generation/storedCover');

test('mediaUrl：相对 key 拼上 base 前缀', () => {
  assert.equal(mediaUrl('xhs/杭州/8f3a/00.webp', '/media'), '/media/xhs/杭州/8f3a/00.webp');
  assert.equal(mediaUrl('xhs/a.webp', 'https://cdn.example.com'), 'https://cdn.example.com/xhs/a.webp');
  assert.equal(
    mediaUrl('xhs/a.webp', 'https://cdn.example.com/'),
    'https://cdn.example.com/xhs/a.webp',
    'base 尾斜杠不产生双斜杠',
  );
  assert.equal(mediaUrl('/xhs/a.webp', ''), '/xhs/a.webp', 'key 前导斜杠剥掉，空 base 退化为同源路径');
  assert.equal(mediaUrl('  xhs/a.webp  ', '/media'), '/media/xhs/a.webp', '空白先 trim');
});

test('mediaUrl：空 key 返回 null，不生成指向目录的 URL', () => {
  assert.equal(mediaUrl('', '/media'), null);
  assert.equal(mediaUrl('   ', '/media'), null);
  assert.equal(mediaUrl('/', '/media'), null);
});

test('createStoredCoverLookup：城市为空直接返回 null，不查库', async () => {
  assert.equal(await createStoredCoverLookup('')('故宫'), null);
  assert.equal(await createStoredCoverLookup('   ')('故宫'), null);
});
