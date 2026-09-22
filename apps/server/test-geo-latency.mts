// 地理编码链路延迟探针：定位 geocodeAll 每次 ~20s 的等待来自哪一级
// 用法（apps/server 目录）：npx tsx test-geo-latency.mts
import 'dotenv/config';
import { geocodeActivity } from './src/integrations/amap/geocoder';
import { geocode as nominatim } from './src/integrations/geocode';
import { amapBudgetRemaining } from './src/services/quotaService';
import { env } from './src/env';

const NAMES = ['天安门广场', '景山公园', '慕田峪长城', '南锣鼓巷', '牛街'];

const time = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
  const start = performance.now();
  let out: unknown;
  let err = '';
  try {
    out = await fn();
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }
  const ms = performance.now() - start;
  console.log(`${label.padEnd(30)} ${ms.toFixed(0).padStart(6)}ms  ${err ? `ERR ${err}` : JSON.stringify(out)}`);
  return out as T;
};

console.log(`AMAP_DAILY_BUDGET=${env.amapDailyBudget} 今日剩余=${await amapBudgetRemaining()}`);
console.log(
  `闸门需要剩余 >= ${40 + 20}（GEOCODE_MAX_PER_TASK + ROUTE_MAX_PER_TASK）→ ` +
    `${(await amapBudgetRemaining()) >= 60 ? '高德可用' : '高德被闸门关闭，全链路走 Nominatim'}\n`,
);

console.log('--- 原始 Nominatim（geocode.ts，串行队列 1100ms 间隔，单次 2.5s 超时 + 连续失败熔断）---');
for (const n of NAMES.slice(0, 2)) {
  await time(`nominatim「北京 ${n}」`, () => nominatim(`北京 ${n}`));
  await time(`nominatim「${n}」`, () => nominatim(n));
}

console.log('\n--- Amap 串行队列间隔（amapQueue）---');
console.log('geocoder.ts: amapQueue = createSerialQueue(350)');

console.log('\n--- 完整解析链 geocodeActivity（apiKey 传 null = 模拟闸门关闭）---');
const startedAll = performance.now();
for (const n of NAMES.slice(2)) {
  await time(`geocodeActivity(null, ${n})`, () => geocodeActivity(null, n, '北京'));
}
console.log(`\n${NAMES.slice(2).length} 个地点串行合计 ${((performance.now() - startedAll) / 1000).toFixed(1)}s`);
