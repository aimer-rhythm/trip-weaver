import pg from 'pg';
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const { rows } = await client.query('SELECT data FROM trips WHERE id=$1', ['0552c0b3-6446-48b9-bf4b-9a11699ce669']);
  const data = rows[0].data;
  console.log(JSON.stringify({ keys: Object.keys(data), form: data.form, sourceForm: data.sourceForm, startDate: data.startDate, endDate: data.endDate, days: data.days.length, preferences: data.preferences }, null, 2));
} finally { await client.end(); }
