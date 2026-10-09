import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {pool} from '../../../../apps/server/src/db/client';
import {verifyWithdrawal} from './verify-withdrawals.mjs';

after(()=>pool.end());
test('实城冻结联合撤回：真实导入、裸名/旧ID不复活、历史保存不变',async()=>{
  const folder=new URL('./all-cities/batch-25/joint-preview-1791339205261456800/',import.meta.url);
  const report=JSON.parse(await readFile(new URL('report.json',folder),'utf8'));
  assert.equal(report.isolated,true);assert.equal(report.synthetic,false);assert.equal(report.reverseRollback,true);
  for(const file of report.files) {
    const bytes=await readFile(new URL(file.file,folder));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256);
    await promisify(execFile)(process.execPath,['--import','tsx',fileURLToPath(new URL('../../../../apps/server/scripts/seed-xhs-places.ts',import.meta.url)),
      fileURLToPath(new URL(file.file,folder))],{env:process.env,windowsHide:true,timeout:30000});
    for(const row of JSON.parse(bytes.toString('utf8')).places) await verifyWithdrawal(file.city,row.id);
  }
});
