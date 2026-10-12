// 仅复核指定批次失败的撤回项；沿用生产请求超时，输出禁止覆盖。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { Client } from 'pg';
import { parse } from 'dotenv';
import { createQueryEmbedder } from '../../../../../apps/server/src/integrations/queryEmbedding.ts';
import { createPlaceRetriever } from '../../../../../apps/server/src/generation/placeRetrieval.ts';
const [batch, label, ...ids] = process.argv.slice(2);
assert.match(batch ?? '', /^batch-\d{2}$/); assert.match(label ?? '', /^recheck-\d{2}$/);
assert.ok(ids.length && new Set(ids).size === ids.length && ids.every(id => /^[a-f0-9]{32}$/.test(id)));
const root = new URL(`${batch}/sync-01/`, import.meta.url), read = f => JSON.parse(fs.readFileSync(new URL(f, root), 'utf8'));
const original = read('verification-vectors.json');
assert.ok(ids.every(id => original.failures.some(f => f.kind === 'withdrawal_vector_unused' && f.detail.id === id)));
const out = new URL(`withdrawal-vectors-${label}.json`, root); assert.ok(!fs.existsSync(out));
const settings = { ...parse(fs.readFileSync('apps/server/.env')), ...process.env };
const client = new Client({ connectionString: settings.DATABASE_URL, connectionTimeoutMillis: 10000 });
const report = { readOnly: true, batch, productionTimeoutUnchanged: true, at: new Date().toISOString(), probes: [], requests: [], failures: [] };
const embed = createQueryEmbedder({ baseUrl: settings.EMBEDDING_BASE_URL || settings.SITE_LLM_BASE_URL || '',
  apiKey: settings.EMBEDDING_API_KEY || settings.SITE_LLM_API_KEY || '', model: settings.EMBEDDING_MODEL || 'cf/bge-m3', dims: Number(settings.EMBEDDING_DIMS || 1024) },
  { fetch: async (...args) => { const started = Date.now(); try { const response = await fetch(...args); report.requests.push({ status: response.status, elapsedMs: Date.now() - started }); return response; }
    catch (e) { report.requests.push({ error: e.name, elapsedMs: Date.now() - started }); throw e; } } });
try {
  await client.connect(); await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const retrieve = createPlaceRetriever({ query: (sql, args) => client.query(sql, args), embed });
  for (const id of ids) {
    const row = (await client.query('SELECT id,city,name,verified,payload FROM canonical_places WHERE id=$1', [id])).rows[0];
    assert.ok(row && row.verified === false && row.payload.identityWithdrawal);
    let diagnostics;
    const hits = await retrieve([row.name], { city: row.city, vector: 'force', limit: 48, onDiagnostics: d => { diagnostics = d; } });
    const probe = { id, city: row.city, name: row.name, diagnostics, excluded: !hits.some(p => p.canonicalPlaceId === id) };
    report.probes.push(probe); if (diagnostics?.vector !== 'used' || !probe.excluded) report.failures.push(probe);
  }
} finally { await client.query('ROLLBACK').catch(() => {}); await client.end(); }
fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(report)); if (report.failures.length) process.exitCode = 1;
