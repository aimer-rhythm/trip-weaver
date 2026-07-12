// 用户级高德 Key 回归验证：迁移、加密、隔离、优先级、清除、动态自检缓存。
// 运行：node node_modules/tsx/dist/cli.mjs scripts/verify-amap-settings.mjs
import crypto from 'node:crypto';
import { rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const databasePath = path.resolve(`apps/server/data/verify-amap-settings-${Date.now()}.db`);
const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
const Database = requireFromServer('better-sqlite3');

process.env.MASTER_KEY = crypto.randomBytes(32).toString('hex');
process.env.DATABASE_PATH = databasePath;
process.env.REGISTRATION_MODE = 'open';
process.env.AMAP_KEY = 'site-amap-key-for-test';
process.env.SEARCH_API_KEY = '';

const failures = [];
function check(name, condition, detail = '') {
  console.log(`${condition ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures.push(name);
}

// 模拟只有旧版 LLM BYOK 字段的存量数据库。
const legacyDatabase = new Database(databasePath);
legacyDatabase.exec(`CREATE TABLE user_settings (
  user_id TEXT PRIMARY KEY,
  byok_enabled INTEGER NOT NULL DEFAULT 0,
  base_url TEXT NOT NULL DEFAULT '',
  api_key_ciphertext TEXT NOT NULL DEFAULT '',
  api_key_last4 TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
)`);
legacyDatabase.close();

const requestedAmapKeys = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  const requestUrl = new URL(String(input));
  if (requestUrl.hostname === 'restapi.amap.com') {
    requestedAmapKeys.push(requestUrl.searchParams.get('key') ?? '');
    return new Response(JSON.stringify({ status: '1', pois: [{ name: '测试地点' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  throw new Error(`Unexpected fetch target: ${requestUrl.origin}`);
};

let sqlite;
try {
  const settingsService = await import('../apps/server/src/services/settingsService.ts');
  const poiSourceModule = await import('../apps/server/src/integrations/amap/poiSource.ts');
  const settingsRouteModule = await import('../apps/server/src/routes/settings.ts');
  const databaseModule = await import('../apps/server/src/db/client.ts');
  const migrationModule = await import('../apps/server/src/db/migrate.ts');
  sqlite = databaseModule.sqlite;

  migrationModule.runMigrations(sqlite);
  const migratedColumns = sqlite.pragma('table_info(user_settings)').map((column) => column.name);
  check(
    '存量 user_settings 幂等补齐高德凭据列',
    ['amap_api_key_ciphertext', 'amap_api_key_last4', 'amap_key_revision'].every((column) =>
      migratedColumns.includes(column),
    ),
    migratedColumns.join(','),
  );

  const userA = 'user-a';
  const userB = 'user-b';
  const firstPersonalKey = 'personal-amap-key-a111';
  const secondPersonalKey = 'personal-amap-key-a222';
  const userBPersonalKey = 'personal-amap-key-b333';

  const savedView = await settingsService.upsertSettings(userA, {
    byokEnabled: false,
    amapApiKey: firstPersonalKey,
  });
  const savedViewJson = JSON.stringify(savedView);
  check(
    '设置视图仅暴露存在性、尾号与站点回退信息',
    savedView.hasPersonalAmapKey &&
      savedView.amapApiKeyLast4 === firstPersonalKey.slice(-4) &&
      savedView.hasSiteAmapKey &&
      !savedViewJson.includes(firstPersonalKey) &&
      !savedViewJson.includes('ciphertext'),
  );

  const persistedRow = sqlite
    .prepare('SELECT amap_api_key_ciphertext, amap_api_key_last4 FROM user_settings WHERE user_id = ?')
    .get(userA);
  check(
    '个人高德 Key 使用 AES-256-GCM 密文落库',
    typeof persistedRow?.amap_api_key_ciphertext === 'string' &&
      persistedRow.amap_api_key_ciphertext.includes('.') &&
      !persistedRow.amap_api_key_ciphertext.includes(firstPersonalKey) &&
      persistedRow.amap_api_key_last4 === firstPersonalKey.slice(-4),
  );

  const userACredential = settingsService.resolveAmapCredential(userA);
  const userBCredential = settingsService.resolveAmapCredential(userB);
  check(
    '个人 Key 优先且不同用户回退站点 Key',
    userACredential?.origin === 'personal' &&
      userACredential.apiKey === firstPersonalKey &&
      userBCredential?.origin === 'site',
  );
  check('未配置用户看不到其他用户个人 Key', !settingsService.getSettingsView(userB).hasPersonalAmapKey);

  await settingsRouteModule.probeSourcesForUser(userA);
  await settingsRouteModule.probeSourcesForUser(userA);
  check('同一用户同一 revision 的自检命中 60 秒缓存', requestedAmapKeys.length === 1);

  await settingsService.upsertSettings(userA, {
    byokEnabled: false,
    amapApiKey: secondPersonalKey,
  });
  await settingsRouteModule.probeSourcesForUser(userA);
  check(
    '更新后自检立即使用新个人 Key',
    requestedAmapKeys.length === 2 && requestedAmapKeys.at(-1) === secondPersonalKey,
  );

  await settingsRouteModule.probeSourcesForUser(userB);
  check(
    '自检缓存按用户隔离且另一用户使用站点回退',
    requestedAmapKeys.length === 3 && requestedAmapKeys.at(-1) === process.env.AMAP_KEY,
  );

  await settingsService.upsertSettings(userB, {
    byokEnabled: false,
    amapApiKey: userBPersonalKey,
  });
  const generationSource = poiSourceModule.resolvePoiSourceForUser(userB);
  await generationSource.source.searchPois('attraction', '测试', '北京');
  check(
    '生成运行时共用动态解析器并使用最新个人 Key',
    generationSource.credentialOrigin === 'personal' && requestedAmapKeys.at(-1) === userBPersonalKey,
  );

  await settingsService.upsertSettings(userA, {
    byokEnabled: false,
    amapApiKey: '',
  });
  check(
    '普通空输入保留现有个人 Key',
    settingsService.resolveAmapCredential(userA)?.apiKey === secondPersonalKey,
  );

  await settingsService.upsertSettings(userA, {
    byokEnabled: false,
    clearAmapApiKey: true,
  });
  const clearedView = settingsService.getSettingsView(userA);
  const clearedCredential = settingsService.resolveAmapCredential(userA);
  check(
    '显式清除后恢复站点回退',
    !clearedView.hasPersonalAmapKey && clearedView.amapApiKeyLast4 === '' && clearedCredential?.origin === 'site',
  );
  check('无任何有效 Key 时可构造 Null 源', poiSourceModule.createPoiSource(null).kind === 'null');

  let rejectedAmbiguousMutation = false;
  try {
    await settingsService.upsertSettings(userA, {
      byokEnabled: false,
      amapApiKey: 'replacement-key',
      clearAmapApiKey: true,
    });
  } catch (error) {
    rejectedAmbiguousMutation = error instanceof Error && error.message.includes('不能同时');
  }
  check('同时保存与清除会被明确拒绝', rejectedAmbiguousMutation);

  console.log(failures.length ? `\nFAIL：${failures.length} 项未过` : '\nPASS —— 用户级高德设置回归全过');
} catch (error) {
  console.error('\n[verify-amap-settings] 异常终止：', error);
  failures.push('脚本异常');
} finally {
  globalThis.fetch = originalFetch;
  sqlite?.close();
  for (const suffix of ['', '-shm', '-wal']) {
    rmSync(`${databasePath}${suffix}`, { force: true });
  }
}

process.exit(failures.length ? 1 : 0);
