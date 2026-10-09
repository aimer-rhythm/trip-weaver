import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { Client } from 'pg';
import { parse } from 'dotenv';
import { createPlaceIdentityIndex } from '../../../../../apps/server/src/lib/placeIdentity';
const client = new Client({ connectionString: parse(await readFile('apps/server/.env')).DATABASE_URL });
try {
  await client.connect();
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const rows = (await client.query('SELECT id,city,name,payload FROM canonical_places WHERE city=$1', ['济南'])).rows;
  const index = createPlaceIdentityIndex(rows);
  const resolve = (name: string) => {
    const found = index.resolve('济南', name);
    assert.equal(found.status, 'resolved', name);
    if (found.status !== 'resolved') throw new Error(name);
    return found.canonicalPlaceId;
  };
  const pairs = [['超然楼','大明湖'], ['超然楼','尚泉尚水茶馆'], ['宽厚里','芙蓉街'],
    ['宽厚里','黑虎泉'], ['宽厚里','解放阁']].map(([a,b]) => {
    const first = resolve(a!), second = resolve(b!);
    assert.notEqual(first, second, `${a}/${b}不得同义归并`);
    return { names:[a,b], ids:[first,second], independent:true };
  });
  assert.equal(resolve('大明湖超然楼'), resolve('超然楼'));
  assert.equal(resolve('宽厚里美食街'), resolve('宽厚里'));
  const report = { readOnly:true, city:'济南', batch:'batch-32', sameEntityPairs:2, independentPairs:pairs, failures:[] };
  await writeFile(new URL('batch-32/sync-01/boundary-check.json', import.meta.url), JSON.stringify(report,null,2)+'\n', {flag:'wx'});
  console.log(JSON.stringify(report));
} finally { await client.query('ROLLBACK').catch(()=>{}); await client.end(); }
