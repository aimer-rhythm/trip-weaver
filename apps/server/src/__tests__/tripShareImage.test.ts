import assert from 'node:assert/strict';
import { test, mock, afterEach } from 'node:test';
import { makeSampleTrip, type TripShareImageResponse } from '@tripweaver/shared';
import { buildTripSharePrompt } from '../lib/tripSharePrompt';
import { encodeShareImage, generateShareImage } from '../integrations/imageGeneration';
import { createTripShareImageService } from '../services/tripShareImageService';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7hQAAAAASUVORK5CYII=';
const image: TripShareImageResponse = { mimeType: 'image/png', dataUrl: `data:image/png;base64,${png}` };
const config = { baseUrl: 'https://8.8.8.8/v1', apiKey: 'secret-fixture', model: 'gpt-image2.5' };
afterEach(() => mock.restoreAll());

test('prompt preserves itinerary order while excluding private fields and lodging', () => {
  const trip = makeSampleTrip();
  trip.extraNotes = 'PRIVATE_NOTES'; trip.startDate = 'PRIVATE_DATE';
  trip.lodging = { name: 'PRIVATE_HOTEL' };
  trip.days[0]!.activities[0]!.description = 'PRIVATE_DESCRIPTION';
  const prompt = buildTripSharePrompt(trip);
  assert.ok(prompt.includes(trip.destination));
  assert.ok(prompt.includes('AI 创作 · 织程'));
  assert.equal(prompt.includes('PRIVATE_'), false);
  const data = JSON.parse(prompt.slice(prompt.indexOf('{')));
  assert.equal(data.days.length, trip.days.length);
  assert.deepEqual(data.days[0].places, trip.days[0]!.activities.filter(a => a.category !== '住宿').slice(0, 6).map(a => a.name.slice(0, 60)));
});

test('specified model and default Images API protocol produce validated base64 image', async () => {
  const fetch = mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(url), 'https://8.8.8.8/v1/images/generations');
    assert.equal(init?.redirect, 'error');
    assert.deepEqual(JSON.parse(String(init?.body)), { model: 'gpt-image2.5', prompt: 'trip prompt', n: 1, size: '1024x1536' });
    return Response.json({ data: [{ b64_json: png }] });
  });
  assert.deepEqual(await generateShareImage(config, 'trip prompt'), image);
  assert.equal(fetch.mock.callCount(), 1);
});

test('URL response downloads image without leaking authorization', async () => {
  let count = 0;
  mock.method(globalThis, 'fetch', async (_url: string | URL | Request, init?: RequestInit) => {
    if (++count === 1) return Response.json({ data: [{ url: 'https://8.8.4.4/image.png' }] });
    assert.equal(init?.headers, undefined);
    assert.equal(init?.redirect, 'error');
    return new Response(Buffer.from(png, 'base64'));
  });
  assert.deepEqual(await generateShareImage(config, 'trip'), image);
  assert.equal(count, 2);
});

test('missing credential, unsafe returned URL, upstream error, oversized or malformed image fail safely', async () => {
  const fetch = mock.method(globalThis, 'fetch', async () => Response.json({ data: [{ url: 'https://127.0.0.1/secret' }] }));
  await assert.rejects(generateShareImage({ ...config, apiKey: '' }, 'trip'), /IMAGE_API_KEY/);
  assert.equal(fetch.mock.callCount(), 0);
  await assert.rejects(generateShareImage(config, 'trip'));
  assert.equal(fetch.mock.callCount(), 1);
  fetch.mock.mockImplementation(async () => new Response('secret-fixture', { status: 401 }));
  await assert.rejects(generateShareImage(config, 'trip'), error => error instanceof Error && /鉴权失败/.test(error.message) && !error.message.includes('secret-fixture'));
  fetch.mock.mockImplementation(async () => new Response('{}', { headers: { 'content-length': '20000000' } }));
  await assert.rejects(generateShareImage(config, 'trip'), /过大/);
  fetch.mock.mockImplementation(async () => Response.json({ data: [{ b64_json: Buffer.from('<svg/>').toString('base64') }] }));
  await assert.rejects(generateShareImage(config, 'trip'), /有效/);
  assert.throws(() => encodeShareImage(Buffer.alloc(11 * 1024 * 1024)), /大小异常/);
});

test('identical pending requests coalesce and cached results do not regenerate', async () => {
  let count = 0;
  let resolve!: (value: TripShareImageResponse) => void;
  const service = createTripShareImageService(async () => { count++; return new Promise(r => { resolve = r; }); });
  const trip = makeSampleTrip();
  const first = service('user', trip);
  const second = service('user', trip);
  await Promise.resolve();
  assert.equal(count, 1);
  await assert.rejects(service('user', { ...trip, title: 'changed' }), /正在生成/);
  resolve(image);
  assert.deepEqual(await Promise.all([first, second]), [image, image]);
  assert.deepEqual(await service('user', trip), image);
  assert.equal(count, 1);
});

test('timeout returns safe error and never automatically retries', async () => {
  mock.method(AbortSignal, 'timeout', () => AbortSignal.abort());
  const fetch = mock.method(globalThis, 'fetch', async () => { throw new Error('secret-fixture'); });
  await assert.rejects(generateShareImage(config, 'trip'), /超时/);
  assert.equal(fetch.mock.callCount(), 1);
});

test('failed generations release locks, and different users/drafts have isolated caches', async () => {
  let count = 0;
  const service = createTripShareImageService(async () => { if (++count === 1) throw new Error('failure'); return image; });
  const trip = makeSampleTrip();
  await assert.rejects(service('a', trip));
  await service('a', trip);
  await service('b', trip);
  await service('a', { ...trip, title: 'new title' });
  assert.equal(count, 4);
});
