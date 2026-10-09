"""冻结两城全目录及逐提及解析；两端业务库只读，不发布关系快照。"""
import asyncio
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.dont_write_bytecode = True
sys.stdout.reconfigure(encoding='utf-8')
UPSTREAM = Path('D:/Project/xhs-travel-pipeline')
ROOT = Path(__file__).resolve().parent
WORKSPACE = ROOT.parents[3]
sys.path.insert(0, str(UPSTREAM))
from dotenv import dotenv_values
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from app.aggregate.mention_identity import load_mention_catalog, load_mention_rows
from app.clean.mention_identity import mention_fingerprint, MENTION_FIELDS

CITIES = ['北京', '济南']


async def main():
    upstream = create_async_engine(dotenv_values(UPSTREAM / '.env')['DATABASE_URL'])
    dsn = dotenv_values(WORKSPACE / 'apps/server/.env')['DATABASE_URL']
    downstream = create_async_engine(dsn.replace('postgresql:', 'postgresql+asyncpg:', 1).replace('postgres:', 'postgresql+asyncpg:', 1))
    output = {'readOnly': True, 'capturedAt': datetime.now(timezone.utc).isoformat(), 'cities': []}
    try:
        async with async_sessionmaker(upstream)() as session, downstream.connect() as down:
            await session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            await session.execute(text("SET LOCAL statement_timeout='30s'"))
            await down.execute(text('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            await down.execute(text("SET LOCAL statement_timeout='30s'"))
            for city in CITIES:
                catalog = await load_mention_catalog(session, city)
                rows = await load_mention_rows(session, city)
                mentions, notes = [], {}
                for row in rows:
                    resolution = catalog.resolve(row)
                    mentions.append({**{k: row[k] for k in MENTION_FIELDS}, 'inputHash': mention_fingerprint(row),
                        'resolution': {k: v for k, v in resolution.items() if k != 'entity'},
                        'entityId': (resolution.get('entity') or {}).get('entity_id')})
                    notes[row['raw_note_id']] = {k: v for k, v in row.items() if k.startswith('note_') or k in ['source_url', 'observed_at']}
                sources = (await session.execute(text('SELECT row_to_json(p) AS data FROM canonical_place p WHERE city=:city ORDER BY id'), {'city': city})).scalars().all()
                summaries = (await session.execute(text('SELECT row_to_json(s) FROM place_summary s JOIN canonical_place p ON p.id=s.canonical_place_id WHERE p.city=:city ORDER BY p.id'), {'city': city})).scalars().all()
                reviews = (await session.execute(text('SELECT row_to_json(r) FROM place_entity_review r WHERE city=:city ORDER BY id'), {'city': city})).scalars().all()
                changes = (await session.execute(text('SELECT change_key,city,created_at FROM place_entity_change WHERE city=:city ORDER BY created_at'), {'city': city})).mappings().all()
                stored = (await down.execute(text('SELECT id,city,name,category,source,verified,lat,lng,payload,embedding IS NOT NULL AS has_embedding FROM canonical_places WHERE city=:city ORDER BY id'), {'city': city})).mappings().all()
                output['cities'].append({'city': city, 'entities': list(catalog.catalog.entities.values()),
                    'members': catalog.catalog.members, 'sources': sources, 'summaries': summaries,
                    'scopes': list(catalog.scopes.values()), 'assignments': list(catalog.assignments.values()),
                    'mentions': mentions, 'notes': notes, 'reviews': reviews, 'changes': [dict(r) for r in changes],
                    'downstream': [dict(r) for r in stored]})
            output['tripsDigest'] = dict((await down.execute(text("SELECT count(*) AS count, md5(string_agg(row_to_json(t)::text, '' ORDER BY id)) AS hash FROM trips t"))).mappings().one())
        folder = ROOT / ('snapshot-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
        folder.mkdir()
        content = json.dumps(output, ensure_ascii=False, indent=2, default=str) + '\n'
        (folder / 'input.json').write_text(content, encoding='utf-8', newline='\n')
        manifest = {'file': str(folder / 'input.json'), 'sha256': hashlib.sha256(content.encode()).hexdigest(),
            'cities': [{'city': c['city'], **{k: len(c[k]) for k in ['entities', 'sources', 'mentions', 'notes', 'scopes', 'downstream']}} for c in output['cities']]}
        (folder / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps(manifest, ensure_ascii=False))
    finally:
        await upstream.dispose()
        await downstream.dispose()


if __name__ == '__main__':
    asyncio.run(main())
