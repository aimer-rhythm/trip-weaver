// 单测：导出文件扫描与版本选择（09-27）——识别两类产物、忽略无关文件、每城取最新
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IMPORT_DIR, latestExports, scanExports } from '../../scripts/lib/exportFiles';

test('scanExports：识别两类导出，忽略 backup.dump 等无关文件', () => {
  const files = scanExports(IMPORT_DIR);
  assert.ok(files.length > 0, `import/ 下应有可识别的导出，实际 ${IMPORT_DIR}`);
  assert.ok(
    files.every((item) => item.source === 'xhs_places' || item.source === 'xhs_relations'),
    '只应识别 xhs-places*.json 与 xhs-place-relations-*.json',
  );
  assert.ok(!files.some((item) => item.filePath.endsWith('.dump')));
  for (const item of files) {
    assert.ok(item.city.length > 0, `${item.filePath} 应有 city`);
    assert.match(item.contentHash, /^[0-9a-f]{32}$/);
    assert.match(item.generatedAt, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test('latestExports：每个 (source, city) 只留 generatedAt 最新的一份', () => {
  const files = scanExports(IMPORT_DIR);
  const latest = latestExports(files);
  const keys = latest.map((item) => `${item.source}|${item.city}`);
  assert.equal(new Set(keys).size, keys.length, '不应出现重复的 (source, city)');
  for (const item of latest) {
    const sameKey = files.filter((f) => f.source === item.source && f.city === item.city);
    const newest = sameKey.reduce((max, f) => (f.generatedAt > max ? f.generatedAt : max), '');
    assert.equal(item.generatedAt, newest, `${item.source}/${item.city} 应取最新的一版`);
  }
});

test('latestExports：同城多份导出时只留一份（北京实测曾有三份：09-22 / 09-23 / 09-25）', () => {
  const beijing = scanExports(IMPORT_DIR).filter((f) => f.source === 'xhs_places' && f.city === '北京');
  if (beijing.length < 2) {
    console.warn('import/ 下北京只有一份导出，跳过多版本断言');
    return;
  }
  const latest = latestExports(beijing);
  assert.equal(latest.length, 1, `多份北京导出应只留一份，实际留了 ${latest.length} 份`);
  const newest = beijing.reduce((max, f) => (f.generatedAt > max ? f.generatedAt : max), '');
  assert.equal(latest[0]!.generatedAt, newest);
});

test('latestExports：空输入返回空数组', () => {
  assert.deepEqual(latestExports([]), []);
});
