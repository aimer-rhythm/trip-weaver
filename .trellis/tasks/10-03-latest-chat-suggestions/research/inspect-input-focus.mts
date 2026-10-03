import { chromium } from 'playwright';
import { makeSampleTrip } from '@tripweaver/shared';
import { mkdir, writeFile } from 'node:fs/promises';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { resolve } from 'node:path';

const output = 'data/chat-input-focus';
await mkdir(output, { recursive: true });
const trip = makeSampleTrip();
const app = Fastify();
await app.register(fastifyStatic, { root: resolve('apps/web/dist') });
app.setNotFoundHandler((_request, reply) => reply.sendFile('index.html'));
const base = await app.listen({ host: '127.0.0.1', port: 0 });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.route('**/api/**', async (route) => {
  const pathname = new URL(route.request().url()).pathname;
  const fixtures: Record<string, unknown> = {
    '/api/auth/me': { id: 'fixture', email: 'fixture@example.test' },
    '/api/usage': { remaining: 3, dailyLimit: 4 },
    '/api/settings/config': { amapJsKey: '', amapJsSecurityCode: '' },
    [`/api/trips/${trip.id}`]: trip,
    [`/api/trips/${trip.id}/versions`]: { rootId: trip.id, versions: [{ id: trip.id, version: 1, createdAt: trip.createdAt, title: trip.title }], latestTripId: trip.id },
    [`/api/trips/${trip.id}/conversation`]: { conversationId: 'focus-fixture' },
    '/api/conversations/focus-fixture': { messages: [] },
  };
  await route.fulfill({ json: fixtures[pathname] ?? {} });
});
try {
  await page.goto(`${base}/trips/${trip.id}`);
  const input = page.getByLabel('输入你的行程想法');
  await input.waitFor({ timeout: 10000 }).catch(async (error) => {
    console.log(JSON.stringify({ url: page.url(), body: await page.locator('body').innerText(), errors }));
    throw error;
  });
  const prefix = process.argv.includes('--after') ? 'after' : 'before';
  const samples: unknown[] = [];
  for (const state of ['blur', 'focus', 'text', 'keyboard-button', 'keyboard-input', 'multiline', 'mobile']) {
    if (state === 'focus') await input.click();
    if (state === 'text') await input.fill('想了解第 1 天怎么安排');
    if (state === 'keyboard-button') await page.keyboard.press('Tab');
    if (state === 'keyboard-input') await page.keyboard.press('Shift+Tab');
    if (state === 'multiline') await input.fill('第一天想轻松一些\n上午去公园\n下午安排休息');
    if (state === 'mobile') {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.getByRole('button', { name: '对话', exact: true }).click();
      await input.click();
    }
    samples.push({ state, data: await page.locator('.chat-input').evaluate((node) => [node, ...node.querySelectorAll('textarea,button')].map((element) => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return { tag: element.tagName, className: element.className, focused: document.activeElement === element, outline: style.outline, shadow: style.boxShadow, border: style.border, borderRadius: style.borderRadius, height: box.height, width: box.width };
    })) });
    await page.screenshot({ path: `${output}/${prefix}-${state}.png` });
  }
  await writeFile(`${output}/${prefix}.json`, JSON.stringify({ samples, errors }, null, 2));
  console.log(JSON.stringify({ output, prefix, states: samples.length, errors }));
} finally { await browser.close(); await app.close(); }
