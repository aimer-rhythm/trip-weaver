import assert from 'node:assert/strict';
import fs from 'node:fs';
import pg from 'pg';
import { chromium } from 'playwright';

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const report = [];
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5173');
  for (const city of ['杭州', '北京', '成都', '广州', '厦门', '上海', '重庆']) {
    const manifest = JSON.parse(fs.readFileSync(`import/xhs-place-images-${city}.json`, 'utf8'));
    const rows = (await client.query('SELECT id,payload FROM canonical_places WHERE city=$1', [city])).rows;
    for (const entry of manifest.images) {
      assert.equal(rows.find(row => row.id === entry.placeId)?.payload.coverImage, entry.key);
      assert.ok(fs.existsSync(`data/media/${entry.key}`));
    }
    const checks = await page.evaluate(async entries => Promise.all(entries.map(async entry => {
      const url = '/media/' + entry.key;
      const r = await fetch(url);
      const img = new Image();
      img.src = url;
      let decoded = false;
      try { await img.decode(); decoded = img.naturalWidth > 0; } catch {}
      return { name: entry.placeName, status: r.status, type: r.headers.get('content-type'), decoded };
    })), manifest.images);
    const failed = checks.filter(x => x.status !== 200 || !x.type?.startsWith('image/') || !x.decoded);
    report.push({ city, places: rows.length, covers: rows.filter(r => r.payload.coverImage).length, manifest: manifest.images.length, failed, checks });
    assert.equal(failed.length, 0, city);
    console.log(JSON.stringify({ city, covers: manifest.images.length, failed: failed.length }));
  }
} finally {
  fs.writeFileSync('.trellis/tasks/09-29-hangzhou-image-diagnosis/research/city-sync-verification.json', JSON.stringify(report, null, 2));
  await browser.close();
  await client.end();
}
