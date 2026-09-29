// Dedicated disposable PG instance on port 18797 only. No real external provider calls.
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { makeSampleTrip } from '@tripweaver/shared';
import { Client } from 'pg';

const databaseName = `route_options_verify_${Date.now()}`;
const admin = new Client({ connectionString: 'postgres://postgres@127.0.0.1:18797/postgres' });
await admin.connect();
await admin.query(`CREATE DATABASE "${databaseName}"`);
process.env.DATABASE_URL = `postgres://postgres@127.0.0.1:18797/${databaseName}`;
process.env.MASTER_KEY = 'a'.repeat(64);
process.env.AMAP_KEY = 'route-test-fixture';
process.env.AMAP_DAILY_BUDGET = '40';
process.env.TIANDITU_KEY = '';
process.env.GITHUB_CLIENT_ID = '';
process.env.GITHUB_CLIENT_SECRET = '';
process.env.REGISTRATION_MODE = 'open';
const { db, pool } = await import('../apps/server/src/db/client');
const { runMigrations } = await import('../apps/server/src/db/migrate');
const { users, editorGeoUsage } = await import('../apps/server/src/db/schema');
const { createSession } = await import('../apps/server/src/auth/session');
const { createTrip } = await import('../apps/server/src/services/tripService');
const { tripRoutes } = await import('../apps/server/src/routes/trips');
const { reserveEditorGeoBudget, amapBudgetRemaining } = await import('../apps/server/src/services/quotaService');
const app = Fastify();
const originalFetch = globalThis.fetch;
let externalCalls = 0;
globalThis.fetch = async (url) => {
  externalCalls++;
  const path = new URL(String(url)).pathname;
  assert.equal(new URL(String(url)).hostname, 'restapi.amap.com');
  const body = path.includes('/geocode/')
    ? { status: '1', geocodes: [{ location: '116.39,39.91', adcode: '110000' }] }
    : { status: '1', route: { paths: [{ distance: '1000', cost: { duration: '600' }, steps: [{ polyline: '116.39,39.91;116.40,39.92' }] }], transits: [{ distance: '2000', cost: { duration: '900' } }] } };
  return new Response(JSON.stringify(body));
};
try {
  await runMigrations(pool); // second run must preserve new table/data
  await db.insert(users).values(['owner', 'other'].map((id) => ({ id, email: `${id}@route.test`, passwordHash: '', createdAt: new Date() })));
  const ownerCookie = `tw_session=${(await createSession('owner')).token}`;
  const otherCookie = `tw_session=${(await createSession('other')).token}`;
  const trip = await createTrip('owner', makeSampleTrip());
  const body = { from: trip.days[0]!.activities[0]!, to: trip.days[0]!.activities[1]!, destination: trip.destination };
  await app.register(cookie);
  await app.register(tripRoutes, { prefix: '/api/trips' });
  const request = (cookieValue?: string, payload: unknown = body, id = trip.id) => app.inject({ method: 'POST', url: `/api/trips/${id}/route-options`, headers: cookieValue ? { cookie: cookieValue } : {}, payload });
  assert.equal((await request()).statusCode, 401);
  assert.equal((await request(otherCookie)).statusCode, 404);
  assert.equal((await request(ownerCookie, body, 'missing')).statusCode, 404);
  assert.equal((await request(ownerCookie, { ...body, from: { ...body.from, lat: 999 } })).statusCode, 400);
  assert.equal(externalCalls, 0);
  const response = await request(ownerCookie);
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().options.filter((o: { status: string }) => o.status === 'available').length, 4);
  assert.equal(response.body.includes('route-test-fixture'), false);
  assert.equal(await amapBudgetRemaining(), 34, '6 accepted attempts counted, unused reservation refunded');
  const selected = response.json().options[0].leg;
  trip.days[0]!.legs = [selected];
  assert.equal((await app.inject({ method: 'PUT', url: `/api/trips/${trip.id}`, headers: { cookie: ownerCookie }, payload: trip })).statusCode, 200);
  assert.deepEqual((await app.inject({ method: 'GET', url: `/api/trips/${trip.id}`, headers: { cookie: ownerCookie } })).json().days[0].legs[0], selected);
  const leases = await Promise.all(Array.from({ length: 10 }, () => reserveEditorGeoBudget('amap', 8)));
  assert.equal(leases.filter(Boolean).length, 4, 'atomic reservations cannot overspend 34 remaining');
  const callsBefore = externalCalls;
  assert.equal((await request(ownerCookie)).statusCode, 429);
  assert.equal(externalCalls, callsBefore);
  for (const finish of leases) if (finish) await finish(0);
  assert.equal(await amapBudgetRemaining(), 34);
  await runMigrations(pool);
  assert.equal((await db.select().from(editorGeoUsage))[0]!.calls, 6);
  console.log('PASS route API: migrations, 401/404/400, real adapter mocked upstream, source/secrets, save reload, atomic quota/refund/429');
} finally {
  globalThis.fetch = originalFetch;
  await app.close();
  await pool.end();
  if (!/^route_options_verify_\d+$/.test(databaseName)) throw new Error('Invalid disposable database name');
  await admin.query(`DROP DATABASE "${databaseName}"`);
  await admin.end();
}
