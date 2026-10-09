// 实库事务预演：限定冻结导出，记录解除的旧组合，最终回滚全部地点修改。
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {Client} from 'pg';
import {parse} from 'dotenv';
import assert from 'node:assert/strict';
import {prepareImportedPlaces,reconcileImportedPlaces} from '../../../../../apps/server/src/services/placeImportIdentity';
const here=new URL('./',import.meta.url);
const output=new URL('component-release-preview.json',here);
assert.ok(!fs.existsSync(output),'预演证据不能覆盖');
const settings=parse(fs.readFileSync(new URL('../../../../../apps/server/.env',here)));
const client=new Client({connectionString:settings.DATABASE_URL,connectionTimeoutMillis:10000});
await client.connect();
const report=[];
try {
  for(const [batch,city] of [['batch-06','北京'],['batch-08','成都']]) {
    const bytes=fs.readFileSync(new URL(`${batch}/sync-02/xhs-places-${city}.json`,here));
    const file=JSON.parse(bytes.toString());assert.equal(file.city,city);
    await client.query('BEGIN');
    try {
      const before=(await client.query('SELECT id,name,payload FROM canonical_places WHERE city=$1 ORDER BY id',[city])).rows;
      const prepared=await prepareImportedPlaces(client,city!,file.places);
      assert.equal(prepared.length,file.places.length,'本次权威导出不得静默跳过实体');
      const released=before.filter(r=>r.payload?.canonicalRedirectTo&&prepared.some(p=>p.id===r.id));
      const count=await reconcileImportedPlaces(client,city!,prepared);
      assert.equal(await reconcileImportedPlaces(client,city!,prepared),0);
      for(const row of released) {
        const after=(await client.query('SELECT payload FROM canonical_places WHERE id=$1',[row.id])).rows[0];
        assert.ok(!after.payload.canonicalRedirectTo);
        assert.equal(after.payload.identity.entityId,row.id);
        assert.deepEqual(after.payload.coverImage,row.payload.coverImage);
      }
      await client.query('ROLLBACK');
      assert.deepEqual((await client.query('SELECT id,name,payload FROM canonical_places WHERE city=$1 ORDER BY id',[city])).rows,before);
      report.push({city,exportHash:createHash('sha256').update(bytes).digest('hex'),accepted:prepared.length,
        released:released.map(r=>({id:r.id,name:r.name,previousTarget:r.payload.canonicalRedirectTo})),
        reconciled:count,idempotent:true,rolledBack:true});
    } catch(error) {await client.query('ROLLBACK');throw error;}
  }
  fs.writeFileSync(output,JSON.stringify({at:new Date().toISOString(),cities:report},null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
} finally {await client.end();}
