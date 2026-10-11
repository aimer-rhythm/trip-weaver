// 默认只预演；来源清单不改写，显式--apply才提交逐图分配和审计。
import { parseArgs } from 'node:util';
import { open, readFile, type FileHandle } from 'node:fs/promises';
import type { PoolClient } from 'pg';
import { pool } from '../src/db/client';
import { loadIndependentPhotoSources, photoIdentityDigest } from '../src/services/independentPhotoSources';
import { applyIndependentPhotoDecision, loadIndependentPhotoAssignments, rollbackIndependentPhotoDecision } from '../src/services/independentPhotoIdentity';

let output: FileHandle | undefined;
let client: PoolClient | undefined;
try {
  const { values } = parseArgs({ options: {
    city: { type: 'string' }, decisions: { type: 'string' }, rollback: { type: 'string' }, out: { type: 'string' },
    snapshot: { type: 'boolean' }, apply: { type: 'boolean' }, 'data-root': { type: 'string' }, library: { type: 'string' },
  } });
  if (!values.out || [values.snapshot, values.decisions, values.rollback].filter(Boolean).length !== 1
    || values.snapshot && (!values.city || values.apply) || values.city && !values.snapshot) throw new Error('须指定--out及--snapshot --city、--decisions或--rollback；快照不可--apply');
  output = await open(values.out, 'wx');
  const library = values.library ? JSON.parse(await readFile(values.library, 'utf8')) as unknown : undefined;
  const load = (city: string) => loadIndependentPhotoSources(city, { dataRoot: values['data-root'], library });
  client = await pool.connect();
  await client.query('BEGIN');
  let report: unknown;
  if (values.snapshot) {
    const inputs = await load(values.city!);
    const assignments = await loadIndependentPhotoAssignments(client, values.city!);
    const entities = (await client.query(`SELECT id,name,verified,payload->'identity' AS identity,
      payload->'identityWithdrawal' AS withdrawal FROM canonical_places WHERE city=$1 ORDER BY id`, [values.city])).rows;
    report = { readOnly: true, city: values.city, entities, assignments, warnings: inputs.warnings,
      missingInputs: assignments.filter(row => !inputs.sources.some(source => source.imageKey === row.image_key)).map(row => ({
        imageKey: row.image_key, inputHash: photoIdentityDigest(['missing_photo', row.image_key]), assetKey: row.asset_key, eligible: false,
      })),
      images: inputs.sources.map(({ imageKey, inputHash, assetKey, kind, city, catalogName, aliases, eligible }) =>
        ({ imageKey, inputHash, assetKey, kind, city, catalogName, aliases, eligible })) };
  } else if (values.decisions) {
    const decisions: unknown = JSON.parse(await readFile(values.decisions, 'utf8'));
    if (!Array.isArray(decisions) || !decisions.length) throw new Error('decisions须为非空数组');
    const changes = [];
    for (const decision of decisions) changes.push(await applyIndependentPhotoDecision(client, decision, load));
    report = { apply: !!values.apply, changes };
  } else report = { apply: !!values.apply, restored: await rollbackIndependentPhotoDecision(client, values.rollback!, load) };
  await client.query(values.apply ? 'COMMIT' : 'ROLLBACK');
  await output.writeFile(JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: true, apply: !!values.apply, out: values.out }));
} catch (error) {
  await client?.query('ROLLBACK');
  await output?.writeFile(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : '图片治理失败' }));
  throw error;
} finally { await output?.close(); client?.release(); await pool.end(); }
