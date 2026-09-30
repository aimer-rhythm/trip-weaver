import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import pg from 'pg';
import { Value } from '@sinclair/typebox/value';
import { TripSchema } from '@tripweaver/shared';
import { createCuratedCoverLookup } from '../../../../apps/server/src/integrations/curatedPhotos.ts';

const id = '32c3abae-eb1e-4587-8832-5531b2169385';
const out = 'data/photo-pilot/beijing';
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const row = (await client.query('SELECT t.user_id,t.data FROM trips t JOIN trips owned ON owned.user_id=t.user_id AND owned.id=$2 WHERE t.id=$1', [id,'5dee10b5-b395-48cd-8fb9-470d4b9e4280'])).rows[0];
  assert.ok(row && Value.Check(TripSchema, row.data));
  assert.equal(row.data.destination, '北京');
  const before = row.data, next = structuredClone(before), changes = [];
  const lookup = createCuratedCoverLookup('北京');
  for (const poi of next.overview ?? []) {
    const selected = await lookup(poi.name);
    if (!selected) continue;
    const old = { coverUrl:poi.coverUrl, coverAttribution:poi.coverAttribution, photos:poi.photos };
    if (JSON.stringify(old) === JSON.stringify(selected)) continue;
    Object.assign(poi, selected);
    changes.push({name:poi.name,before:old,after:selected});
  }
  assert.ok(Value.Check(TripSchema,next));
  assert.deepEqual(next.days,before.days);
  const report = {tripId:id,changes,applied:false};
  await fs.writeFile(`${out}/gallery-plan.json`,JSON.stringify(report,null,2));
  await fs.writeFile(`${out}/preview-trip.json`,JSON.stringify(next,null,2));
  if (process.argv.includes('--apply') && changes.length) {
    const stamp=Date.now();
    await fs.writeFile(`${out}/before-gallery-${stamp}.json`,JSON.stringify(before,null,2),{flag:'wx'});
    next.updatedAt=stamp;
    const result=await client.query('UPDATE trips SET data=$1,updated_at=$2 WHERE id=$3 AND user_id=$4 AND data=$5::jsonb RETURNING id',[next,new Date(stamp),id,row.user_id,before]);
    assert.equal(result.rowCount,1,'行程同时发生修改，停止覆盖');
    report.applied=true;
    await fs.writeFile(`${out}/gallery-result.json`,JSON.stringify(report,null,2));
  }
  console.log(JSON.stringify({tripId:id,applied:report.applied,places:changes.length,photos:changes.reduce((sum,c)=>sum+c.after.photos.length,0)}));
} finally {await client.end();}
