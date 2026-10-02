// 预热热门景点与恢复持久队列。与正式服务使用完全相同的后台采集/审图逻辑。
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });
await import('../src/lib/proxy');
const args = process.argv.slice(2);
function arg(key: string) { const i = args.indexOf(key); return i >= 0 ? args[i + 1] : undefined; }
if (args.includes('--help')) {
  console.log('node --import tsx apps/server/scripts/review-place-photos.mts --city 北京 --places 故宫博物院,天坛公园 [--run] [--max-jobs 3]\n不传--run只入队；--status查看状态。请勿与正式worker同时消费同一队列。');
} else {
  const { photoReviewQueue, photoReviewConfigured } = await import('../src/integrations/photoEnrichment');
  const city = arg('--city'), places = arg('--places')?.split(',').map(p => p.trim()).filter(Boolean) ?? [];
  if (places.length && !city) throw new Error('--places requires --city');
  for (const name of places) console.log(JSON.stringify({ city, name, queued: args.includes('--retry') ? await photoReviewQueue.retryNow(city!, name) : await photoReviewQueue.enqueue(city!, name) }));
  if (args.includes('--run')) {
    if (!photoReviewConfigured) throw new Error('PHOTO_REVIEW_BASE_URL/API_KEY/MODEL 尚未配置');
    const limit = Number(arg('--max-jobs') ?? 3);
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error('--max-jobs must be 1..10');
    for (let i = 0; i < limit; i++) await photoReviewQueue.tick();
  }
  console.log(JSON.stringify(await photoReviewQueue.jobs(), null, 2));
  await photoReviewQueue.stop();
  const { pool } = await import('../src/db/client');
  await pool.end();
}
