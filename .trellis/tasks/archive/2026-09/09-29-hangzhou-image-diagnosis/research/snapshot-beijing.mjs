import fs from 'node:fs/promises';
import pg from 'pg';
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const { rows } = await client.query(`SELECT t.id,t.data FROM trips t
    JOIN trips owned ON owned.id=$1 AND owned.user_id=t.user_id
    WHERE t.data->>'destination' LIKE $2 ORDER BY t.updated_at DESC LIMIT 3`,
    ['5dee10b5-b395-48cd-8fb9-470d4b9e4280', '%北京%']);
  await fs.mkdir('data/photo-pilot/beijing', { recursive: true });
  await fs.writeFile('data/photo-pilot/beijing/existing-trips.json', JSON.stringify(rows, null, 2));
  console.log(JSON.stringify(rows.map(({ id, data }) => ({ id, title: data.title, days: data.days?.length,
    places: data.overview?.filter(p => p.category === 'attraction').map(p => ({ name: p.name, cover: p.coverUrl, photos: p.photos?.length })) })), null, 2));
} finally { await client.end(); }
