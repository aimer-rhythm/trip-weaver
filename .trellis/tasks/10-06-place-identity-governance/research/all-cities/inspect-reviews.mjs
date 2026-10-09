// 只读冻结快照，按源记录原名展示提及，避免大小写 key 串到不同分店。
import fs from 'node:fs';
const snapshot = JSON.parse(fs.readFileSync(new URL('./source-snapshot.json', import.meta.url), 'utf8'));
const wanted = new Set(process.argv.slice(2).flatMap(value => value.split(',')));
const byId = new Map(snapshot.entities.map(entity => [entity.entity_id, entity]));
for (const review of snapshot.reviews.filter(row => wanted.has(row.id) || wanted.has(row.city))) {
  console.log(`\n${review.id} ${review.city}`);
  for (const id of review.detail.entityIds) {
    const entity = byId.get(id);
    const names = new Set(entity.places.map(place => place.name));
    console.log(JSON.stringify({ name: entity.canonical_name, id, revision: entity.revision,
      places: entity.places.map(place => ({id: place.id, name:place.name, address:place.address,
        lat:place.latitude, lng:place.longitude, type:place.place_type, geo:place.geo_status})),
      mentions:entity.mentions.filter(mention=>names.has(mention.name)).slice(0,4).map(mention=>({
        id:mention.id, text:mention.evidence_text || mention.reason, title:mention.title })) }));
  }
}
