// 有界实测：每个已配置图库仅查一个明确地点，不创建行程、不调用LLM、不输出密钥。
import { config } from 'dotenv';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createUnsplashCoverLookup } from '../src/integrations/unsplash/cover';
import { createPixabayCoverLookup } from '../src/integrations/pixabay/cover';

config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });
await import('../src/lib/proxy');
const { env } = await import('../src/env');
const query = { name: process.argv[2] ?? '故宫博物院', city: process.argv[3] ?? '北京' };
const sources = [
  { source: 'unsplash', configured: !!env.unsplashAccessKey, lookup: createUnsplashCoverLookup(env.unsplashAccessKey, 4) },
  { source: 'pixabay', configured: !!env.pixabayApiKey, lookup: createPixabayCoverLookup(env.pixabayApiKey, 1) },
];
const results = [];
for (const { source, configured, lookup } of sources) {
  const photos = configured ? await lookup.photosFor(query) : [];
  results.push({ source, configured, photos });
}
const directory = new URL('../../../data/photo-pilot/stock-api/', import.meta.url);
await fs.mkdir(directory, { recursive: true });
await fs.writeFile(new URL('latest.json', directory), JSON.stringify({ at: new Date().toISOString(), query, results }, null, 2));
console.log(JSON.stringify({ query, results: results.map(({ source, configured, photos }) => ({ source, configured, selected: photos.length, urls: photos.map(photo => photo.url) })) }));
