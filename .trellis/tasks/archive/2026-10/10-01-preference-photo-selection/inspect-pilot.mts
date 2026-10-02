import fs from 'node:fs/promises';
import path from 'node:path';
import { createReviewedCoverLookup, reviewedCatalogFile, validReviewedAttribution, eligibleReview } from '../../../../../apps/server/src/integrations/reviewedPhotos';
const city = '北京', name = '圆明园';
const raw = JSON.parse(await fs.readFile(reviewedCatalogFile(city, name), 'utf8'));
const lookup = createReviewedCoverLookup(city);
const cover = await lookup(name);
const rows = raw.entries.map((e: any) => ({ source: e.photo.attribution?.source ?? e.provider, url: e.photo.url, sourceUrl: e.photo.attribution?.sourceUrl,
  identity: e.review.identity, representative: e.review.representative, composition: e.review.composition,
  eligible: eligibleReview(e.review), validSource: validReviewedAttribution(e), reason: e.review.reason }));
const images = await Promise.all((cover?.photos ?? []).map(async p => {
  const response = await fetch(`http://127.0.0.1:8787${p.url}`);
  return { url: p.url, status: response.status, mime: response.headers.get('content-type'), bytes: (await response.arrayBuffer()).byteLength };
}));
const result = { city, name, cover, images, rows };
const target = '.trellis/tasks/archive/2026-10/10-01-preference-photo-selection/research';
await fs.mkdir(target, { recursive: true });
await fs.writeFile(path.join(target, 'pilot-result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
