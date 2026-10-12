// 只读检查真实独立目录；不载入数据库、不下载图片、不修改选图或审核。
import { writeFile } from 'node:fs/promises';
import { loadIndependentPhotoSources } from '../../../../apps/server/src/services/independentPhotoSources';
const cities = ['北京', '上海', '厦门', '广州', '成都', '杭州', '重庆', '济南', '苏州', '西安', '青岛', '云南'];
const results = [];
for (const city of cities) {
  try {
    const data = await loadIndependentPhotoSources(city, { verifyBytes: false });
    results.push({ city, selectedPlaces: data.selected?.places.length ?? 0, reviewedCatalogs: data.reviewed.length,
      images: data.sources.length, metadataEligible: data.sources.filter(s => s.eligible).length,
      distinctAssets: new Set(data.sources.map(s => s.assetKey)).size, warnings: data.warnings });
  } catch (error) { results.push({ city, error: error instanceof Error ? error.message : 'source_load_failed' }); }
}
const file = `independent-photo-source-audit-${Date.now()}.json`;
await writeFile(new URL(file, import.meta.url), JSON.stringify({ readOnly: true, byteValidation: false, results }, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ file, results }));
