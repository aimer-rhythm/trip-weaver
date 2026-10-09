// 冻结指定城市当前下游知识数据，用于一次性库导入预演；不读用户行程内容。
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';
import { parse } from 'dotenv';
import { validateRelationManifest, validateBoundRelations } from '../../../../apps/server/src/services/placeRelationIdentity';

const folder = path.resolve(process.argv[2]!);
const statePath = path.join(folder, 'state.json');
const state = JSON.parse(await readFile(statePath, 'utf8'));
assert.equal(state.placesImported, false);
assert.equal(state.relationsImported, false);
const city: string = state.city;
const placesFile = path.join(folder, `xhs-places-${city}.json`), relationsFile = path.join(folder, `xhs-place-relations-${city}.json`);
const placesBytes = await readFile(placesFile), relationBytes = await readFile(relationsFile);
const places = JSON.parse(placesBytes.toString('utf8')), relations = JSON.parse(relationBytes.toString('utf8'));
assert.deepEqual(places.relationIdentity, relations.relationIdentity);
const manifest = validateRelationManifest(places.relationIdentity, city);
const graph = validateBoundRelations(relations.relations, manifest);
const configuration = parse(await readFile('apps/server/.env'));
const client = new Client({ connectionString: configuration.DATABASE_URL, connectionTimeoutMillis: 10000 });
const names = ['canonical_places', 'research_evidence', 'place_relation', 'data_import', 'independent_photo_assignments', 'place_relation_snapshots'];
const tables: Record<string, Record<string, unknown>[]> = {};
try {
  await client.connect();
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await client.query("SET LOCAL statement_timeout='45s'");
  for (const name of names) tables[name] = (await client.query(`SELECT to_jsonb(t) value FROM ${name} t WHERE city=$1 ORDER BY to_jsonb(t)::text`, [city])).rows.map(r => r.value);
  await client.query('ROLLBACK');
} finally { await client.end(); }
const library = JSON.stringify({ readOnly: true, city, capturedAt: new Date().toISOString(), tables });
await writeFile(path.join(folder, 'library-before.json'), library, { flag: 'wx' });
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
Object.assign(state, { phase: 'frozen', sourceRevision: manifest.revision, sourceHash: manifest.sourceHash,
  placesHash: hash(placesBytes), relationsHash: hash(relationBytes), libraryHash: hash(library),
  counts: { places: places.places.length, graph: graph.length, direct: graph.filter(r => r.strength === 'direct').length,
    library: Object.fromEntries(names.map(name => [name, tables[name]!.length])) } });
await writeFile(statePath, JSON.stringify(state, null, 2));
console.log(JSON.stringify({ city, phase: state.phase, sourceRevision: state.sourceRevision, counts: state.counts }));
console.log(JSON.stringify({ directEvidence: graph.filter(r => r.strength === 'direct').map(r => ({ from: r.from, to: r.to,
  notes: r.evidence.map(e => ({ noteId: e.noteId, quote: e.quote })) })) }));
