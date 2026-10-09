// 在实际库中仅验证导入前置条件；事务最终回滚，不写业务数据。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { pool } from '../../../../apps/server/src/db/client';
import { prepareImportedPlaces } from '../../../../apps/server/src/services/placeImportIdentity';
import { rollbackIdentityImport } from '../../../../apps/server/src/services/placeIdentityAudit';

const client = await pool.connect();
try {
  await client.query('BEGIN');
  const file = JSON.parse(fs.readFileSync(new URL('./xhs-places-济南.json', import.meta.url), 'utf8'));
  const current = await prepareImportedPlaces(client, '济南', file.places);
  assert.equal(current.length, 237);
  const old = await prepareImportedPlaces(client, '济南', [
    { id: '4dd3530aa4bb1a615b12f5b19efef8e8', name: '经三路老商埠' },
    { id: '46bf462d545dc6435d6de296ba099d0f', name: '老商埠' },
  ]);
  assert.deepEqual(old, []);
  const rollback = await rollbackIdentityImport(client, '8a16d1e2-b251-4de8-b8e1-08987dc75ab7');
  assert.equal(rollback.restored, false);
  const report = { verifiedAt: new Date().toISOString(), currentImportAccepted: current.length,
    oldExportSkipped: 2, rollbackPreview: rollback, businessWrites: false };
  fs.writeFileSync(new URL('./import-guards.json', import.meta.url), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await client.query('ROLLBACK'); client.release(); await pool.end(); }
