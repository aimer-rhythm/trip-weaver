import fs from 'node:fs/promises';
import { reviewedCatalogFile, eligibleReview } from '../../../../../apps/server/src/integrations/reviewedPhotos';
const rows = [];
for (const name of ['圆明园', '故宫博物院', '天坛公园', '北海公园']) {
  const catalog = JSON.parse(await fs.readFile(reviewedCatalogFile('北京', name), 'utf8'));
  rows.push({ name, reviewed: catalog.entries.length, eligible: catalog.entries.filter((e: any) => eligibleReview(e.review)).length,
    sources: [...new Set(catalog.entries.filter((e: any) => eligibleReview(e.review)).map((e: any) => e.photo.attribution?.source ?? e.provider))] });
}
await fs.writeFile('.trellis/tasks/archive/2026-10/10-01-preference-photo-selection/research/inventory.json', JSON.stringify(rows, null, 2));
console.log(JSON.stringify(rows));
