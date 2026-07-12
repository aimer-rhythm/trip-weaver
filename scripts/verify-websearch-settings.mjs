// 用户级 Web 搜索配置回归：迁移、加密、SSRF、隔离、优先级、清除与动态生效。
// 运行：node node_modules/tsx/dist/cli.mjs scripts/verify-websearch-settings.mjs
import crypto from 'node:crypto';
import { rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const databasePath = path.resolve(`apps/server/data/verify-websearch-settings-${Date.now()}.db`);
const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
const Database = requireFromServer('better-sqlite3');

process.env.MASTER_KEY = crypto.randomBytes(32).toString('hex');
process.env.DATABASE_PATH = databasePath;
process.env.REGISTRATION_MODE = 'open';
process.env.AMAP_KEY = 'site-amap-key-for-test';
process.env.SEARCH_API_KEY = 'site-search-key-for-test';
process.env.SEARCH_API_BASE_URL = 'https://site-search.test';
process.env.SSRF_ALLOWLIST = 'api.langsearch.com,personal-a.test,personal-b.test';

const failures = [];
function check(name, condition, detail = '') {
  console.log(`${condition ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures.push(name);
}

const legacyDatabase = new Database(databasePath);
legacyDatabase.exec(`CREATE TABLE user_settings (
  user_id TEXT PRIMARY KEY,
  byok_enabled INTEGER NOT NULL DEFAULT 0,
  base_url TEXT NOT NULL DEFAULT '',
  api_key_ciphertext TEXT NOT NULL DEFAULT '',
  api_key_last4 TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  amap_api_key_ciphertext TEXT NOT NULL DEFAULT '',
  amap_api_key_last4 TEXT NOT NULL DEFAULT '',
  amap_key_revision INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
)`);
legacyDatabase.prepare(`INSERT INTO user_settings (
  user_id, byok_enabled, base_url, api_key_ciphertext, api_key_last4, model,
  amap_api_key_ciphertext, amap_api_key_last4, amap_key_revision, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
  'legacy-user',
  0,
  'https://legacy-llm.test/v1',
  'legacy-llm-ciphertext',
  'llm4',
  'legacy-model',
  'legacy-amap-ciphertext',
  'map4',
  7,
  1234,
);
legacyDatabase.close();

const searchRequests = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const requestUrl = new URL(String(input));
  if (requestUrl.hostname === 'restapi.amap.com') {
    return new Response(JSON.stringify({ status: '1', pois: [{ name: '测试地点' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  if (requestUrl.pathname.endsWith('/v1/web-search')) {
    searchRequests.push({
      origin: requestUrl.origin,
      authorization: new Headers(init?.headers).get('authorization') ?? '',
    });
    return new Response(
      JSON.stringify({
        data: {
          webPages: {
            value: [{ name: '测试攻略', url: 'https://example.com/guide', summary: '测试摘要' }],
          },
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  throw new Error(`Unexpected fetch target: ${requestUrl.origin}`);
};

let sqlite;
try {
  const settingsService = await import('../apps/server/src/services/settingsService.ts');
  const searchSourceModule = await import('../apps/server/src/integrations/websearch/searchSource.ts');
  const settingsRouteModule = await import('../apps/server/src/routes/settings.ts');
  const databaseModule = await import('../apps/server/src/db/client.ts');
  const migrationModule = await import('../apps/server/src/db/migrate.ts');
  const { SsrfError } = await import('../apps/server/src/integrations/ssrfGuard.ts');
  const { env } = await import('../apps/server/src/env.ts');
  sqlite = databaseModule.sqlite;

  migrationModule.runMigrations(sqlite);
  migrationModule.runMigrations(sqlite);
  const migratedColumns = sqlite.pragma('table_info(user_settings)').map((column) => column.name);
  check(
    '存量 user_settings 幂等补齐搜索配置列',
    [
      'search_api_key_ciphertext',
      'search_api_key_last4',
      'search_api_base_url',
      'search_credential_revision',
    ].every((column) => migratedColumns.includes(column)),
    migratedColumns.join(','),
  );
  const preservedLegacyRow = sqlite.prepare('SELECT * FROM user_settings WHERE user_id = ?').get('legacy-user');
  check(
    '迁移保留已有 LLM 与高德设置',
    preservedLegacyRow.base_url === 'https://legacy-llm.test/v1' &&
      preservedLegacyRow.model === 'legacy-model' &&
      preservedLegacyRow.amap_api_key_last4 === 'map4' &&
      preservedLegacyRow.amap_key_revision === 7,
  );

  const userA = 'user-a';
  const userB = 'user-b';
  const firstPersonalKey = 'personal-search-key-a111';
  const secondPersonalKey = 'personal-search-key-a222';
  const userBPersonalKey = 'personal-search-key-b333';

  const defaultedView = await settingsService.upsertSettings(userA, {
    byokEnabled: false,
    searchApiKey: firstPersonalKey,
    searchApiBaseUrl: '',
  });
  const defaultedViewJson = JSON.stringify(defaultedView);
  check(
    '新个人配置空 Base URL 使用 LangSearch 默认值且仅回显尾号',
    defaultedView.hasPersonalSearchKey &&
      defaultedView.searchApiBaseUrl === 'https://api.langsearch.com' &&
      defaultedView.searchApiKeyLast4 === 'a111' &&
      defaultedView.hasSiteSearchKey &&
      !defaultedViewJson.includes(firstPersonalKey) &&
      !defaultedViewJson.includes('ciphertext'),
  );

  const persistedRow = sqlite
    .prepare('SELECT search_api_key_ciphertext, search_api_key_last4, search_api_base_url FROM user_settings WHERE user_id = ?')
    .get(userA);
  check(
    '个人搜索 Key 使用 AES-256-GCM 密文落库',
    typeof persistedRow?.search_api_key_ciphertext === 'string' &&
      persistedRow.search_api_key_ciphertext.includes('.') &&
      !persistedRow.search_api_key_ciphertext.includes(firstPersonalKey) &&
      persistedRow.search_api_key_last4 === 'a111',
  );

  await settingsService.upsertSettings(userA, { byokEnabled: false, searchApiKey: '' });
  check('空白 Key 保留已有个人配置', settingsService.resolveSearchCredential(userA)?.apiKey === firstPersonalKey);

  await settingsService.upsertSettings(userA, {
    byokEnabled: false,
    searchApiBaseUrl: 'https://personal-a.test',
  });
  check(
    '已有个人 Key 时允许仅更新 Base URL',
    settingsService.resolveSearchCredential(userA)?.baseUrl === 'https://personal-a.test',
  );

  const userACredential = settingsService.resolveSearchCredential(userA);
  const userBCredential = settingsService.resolveSearchCredential(userB);
  check(
    '个人配置优先且不同用户回退站点配置',
    userACredential?.origin === 'personal' &&
      userACredential.apiKey === firstPersonalKey &&
      userBCredential?.origin === 'site' &&
      userBCredential.apiKey === process.env.SEARCH_API_KEY,
  );
  check('未配置用户看不到其他用户个人搜索配置', !settingsService.getSettingsView(userB).hasPersonalSearchKey);

  await settingsRouteModule.probeSourcesForUser(userA);
  await settingsRouteModule.probeSourcesForUser(userA);
  check('同一用户同一 Amap/搜索 revision 的自检命中缓存', searchRequests.length === 1);

  await settingsService.upsertSettings(userA, {
    byokEnabled: false,
    searchApiKey: secondPersonalKey,
    searchApiBaseUrl: 'https://personal-a.test',
  });
  await settingsRouteModule.probeSourcesForUser(userA);
  check(
    '更新搜索凭据后自检立即使用新 Key',
    searchRequests.length === 2 && searchRequests.at(-1)?.authorization === `Bearer ${secondPersonalKey}`,
  );

  await settingsRouteModule.probeSourcesForUser(userB);
  check(
    '自检缓存按用户隔离且另一用户使用站点回退',
    searchRequests.length === 3 &&
      searchRequests.at(-1)?.origin === 'https://site-search.test' &&
      searchRequests.at(-1)?.authorization === `Bearer ${process.env.SEARCH_API_KEY}`,
  );

  await settingsService.upsertSettings(userB, {
    byokEnabled: false,
    searchApiKey: userBPersonalKey,
    searchApiBaseUrl: 'https://personal-b.test',
  });
  const generationSource = await searchSourceModule.resolveSearchSourceForUser(userB);
  await generationSource.source.search('北京攻略');
  check(
    '新生成任务动态解析并使用最新个人搜索配置',
    generationSource.credentialOrigin === 'personal' &&
      searchRequests.at(-1)?.origin === 'https://personal-b.test' &&
      searchRequests.at(-1)?.authorization === `Bearer ${userBPersonalKey}`,
  );

  let rejectedBaseOnlyCreate = false;
  try {
    await settingsService.upsertSettings('user-c', {
      byokEnabled: false,
      searchApiBaseUrl: 'https://personal-a.test',
    });
  } catch (error) {
    rejectedBaseOnlyCreate = error instanceof Error && error.message === '设置个人搜索 Base URL 需要同时提供 API Key';
  }
  check('无个人 Key 时拒绝仅保存 Base URL', rejectedBaseOnlyCreate);

  let rejectedConflictingMutation = false;
  try {
    await settingsService.upsertSettings(userA, {
      byokEnabled: false,
      searchApiKey: 'conflicting-key',
      clearSearchConfig: true,
    });
  } catch (error) {
    rejectedConflictingMutation = error instanceof Error && error.message === '不能同时保存并清除个人搜索配置';
  }
  check('同时保存与清除个人搜索配置会被稳定拒绝', rejectedConflictingMutation);

  let rejectedUnsafeSave = false;
  try {
    await settingsService.upsertSettings(userA, {
      byokEnabled: false,
      searchApiBaseUrl: 'http://127.0.0.1:9999',
    });
  } catch (error) {
    rejectedUnsafeSave = error instanceof SsrfError;
  }
  check('保存时拒绝不安全的个人搜索 Base URL', rejectedUnsafeSave);

  const sourceBeforeRebinding = await searchSourceModule.resolveSearchSourceForUser(userA);
  const searchRequestCountBeforeRebinding = searchRequests.length;
  const personalAAllowlistIndex = env.ssrfAllowlist.indexOf('personal-a.test');
  env.ssrfAllowlist.splice(personalAAllowlistIndex, 1);
  const rebindingResults = await sourceBeforeRebinding.source.search('DNS 重绑定复查');
  check(
    '每次真实请求前再次校验个人 Base URL',
    rebindingResults.length === 0 && searchRequests.length === searchRequestCountBeforeRebinding,
  );
  const invalidAtUseSource = await searchSourceModule.resolveSearchSourceForUser(userA);
  check(
    '构造/使用前再次校验个人 Base URL，失败时 Null 降级',
    invalidAtUseSource.credentialOrigin === 'personal' && invalidAtUseSource.source.kind === 'null',
  );
  env.ssrfAllowlist.push('personal-a.test');

  await settingsService.upsertSettings(userA, { byokEnabled: false, clearSearchConfig: true });
  const clearedView = settingsService.getSettingsView(userA);
  const clearedCredential = settingsService.resolveSearchCredential(userA);
  check(
    '显式清除同时删除个人 Key 与 Base URL并恢复站点回退',
    !clearedView.hasPersonalSearchKey &&
      clearedView.searchApiKeyLast4 === '' &&
      clearedView.searchApiBaseUrl === '' &&
      clearedCredential?.origin === 'site',
  );
  check('无任何有效搜索配置时可构造 Null 源', searchSourceModule.createSearchSource(null, null).kind === 'null');

  console.log(failures.length ? `\nFAIL：${failures.length} 项未过` : '\nPASS —— 用户级 Web 搜索设置回归全过');
} catch (error) {
  console.error('\n[verify-websearch-settings] 异常终止：', error);
  failures.push('脚本异常');
} finally {
  globalThis.fetch = originalFetch;
  sqlite?.close();
  for (const suffix of ['', '-shm', '-wal']) {
    rmSync(`${databasePath}${suffix}`, { force: true });
  }
}

process.exit(failures.length ? 1 : 0);
