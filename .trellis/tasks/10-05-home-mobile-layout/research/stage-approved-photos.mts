// 只读取现有审核目录；不搜索、不下载、不入队。字节与审核摘要必须一致。
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { eligibleReview, reviewedCatalogFile, verifiedPhotoBytes, validReviewedAttribution,
  type ReviewedCatalog } from '../../../../apps/server/src/integrations/reviewedPhotos';
import { createSelectedPhotoLibrary } from '../../../../apps/server/src/integrations/selectedPhotos';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const target = join(root, 'apps/web/src/assets/destinations');
const choices = [
  { city: '北京', place: '天坛公园', url: '/media/photography/pexels-7759763.webp' },
  { city: '杭州', place: '雷峰塔', url: '/media/photography/pexels-17787255.webp' },
  { city: '厦门', place: '鼓浪屿', url: '/media/remote-photos/9c0c49b6739b24e84b2f38309b77e578c41fb0c92b95ab09672af81224868ff4.webp' },
];
const sources = [];
for (const choice of choices) {
  const file = reviewedCatalogFile(choice.city, choice.place, join(root, 'data'));
  const catalog = JSON.parse(await readFile(file, 'utf8')) as ReviewedCatalog;
  if (catalog.city !== choice.city || catalog.name !== choice.place || catalog.version !== 'place-preference-v1') throw new Error('审核目录不匹配');
  const entry = catalog.entries.find(row => row.photo.url === choice.url);
  if (!entry || !eligibleReview(entry.review) || !validReviewedAttribution(entry) ||
    entry.photo.attribution?.source !== 'pexels' || !createSelectedPhotoLibrary(choice.city).acceptSupplement(choice.place, entry)) {
    throw new Error(`${choice.city}图片未通过既有采用门槛`);
  }
  const bytes = await verifiedPhotoBytes(entry, join(root, 'data'));
  if (!bytes) throw new Error(`${choice.city}审核图片缺失或摘要不符`);
  await mkdir(target, { recursive: true });
  await writeFile(join(target, `${choice.city}.webp`), bytes);
  sources.push({ city: choice.city, place: choice.place, file: `${choice.city}.webp`,
    catalog: file.slice(root.length).replaceAll('\\', '/'), reviewVersion: catalog.version, ...entry });
}
await writeFile(join(target, 'sources.json'), JSON.stringify(sources, null, 2) + '\n');
console.log(`已复用 ${sources.length} 张审核图片，全部保持原始文件 SHA-256。`);
