"""在实库只读视图运行暂存关系解析；不发布快照、不迁移、不导入。"""
from pathlib import Path
import argparse
import asyncio
from collections import Counter
from datetime import datetime, timezone
import json
import sys
import time

sys.dont_write_bytecode = True
sys.stdout.reconfigure(encoding='utf-8')
root = Path(__file__).resolve().parent
sys.path.insert(0, 'D:/Project/xhs-travel-pipeline')
import app
app.__path__.insert(0, str(root/'upstream/app'))
for name in ['clean', 'aggregate']:
    package = __import__(f'app.{name}', fromlist=['_'])
    package.__path__.insert(0, str(root/'upstream/app'/name))

from sqlalchemy import select, text, union
from app.db import SessionFactory, engine
from app.models import CanonicalPlace, PlaceEntity, PlaceRelation
from app.aggregate.mention_identity import load_mention_catalog, load_mention_rows
from app.clean.relation_snapshot import build_relation_snapshot


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--city')
    args = parser.parse_args()
    folder = root/f'mention-relations-audit-{time.time_ns()}'
    folder.mkdir()
    report = {'readOnly': True, 'staged': True, 'capturedAt': datetime.now(timezone.utc).isoformat(), 'cities': []}
    try:
        async with SessionFactory() as session:
            await session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            await session.execute(text("SET LOCAL statement_timeout='30s'"))
            cities = [args.city] if args.city else (await session.scalars(union(select(CanonicalPlace.city), select(PlaceEntity.city)))).all()
            for city in sorted(cities):
                started = time.perf_counter()
                catalog = await load_mention_catalog(session, city)
                mentions = await load_mention_rows(session, city)
                names = (await session.execute(select(CanonicalPlace.name, CanonicalPlace.normalized_name).where(CanonicalPlace.city == city))).all()
                snapshot = build_relation_snapshot(catalog, mentions, extra_surfaces=[n for pair in names for n in pair])
                old = (await session.scalars(select(PlaceRelation).where(PlaceRelation.city == city))).all()
                file = folder/f'city-{len(report["cities"]):02}.json'
                with file.open('x', encoding='utf-8') as stream:
                    json.dump(snapshot, stream, ensure_ascii=False, indent=1)
                reasons = Counter(reason for item in snapshot['unresolved'] for reason in item.get('reasons', [item.get('reason')]))
                managed = catalog.managed_entity_ids()
                entry = {'city': city, 'mentions': len(mentions), 'entities': len(catalog.catalog.entities), 'legacyRelations': len(old),
                    'relations': len(snapshot['relations']), 'direct': sum(r['strength'] == 'direct' for r in snapshot['relations']),
                    'managedRelations': sum(bool({r['fromEntityId'], r['toEntityId']} & managed) for r in snapshot['relations']),
                    'unresolvedReasons': dict(reasons), 'seconds': round(time.perf_counter() - started, 3), 'file': file.name}
                report['cities'].append(entry)
                print(json.dumps(entry, ensure_ascii=False), flush=True)
        with (folder/'report.json').open('x', encoding='utf-8') as stream:
            json.dump(report, stream, ensure_ascii=False, indent=2)
        print(json.dumps({'report': str(folder/'report.json'), 'readOnly': True}, ensure_ascii=False))
    finally:
        await engine.dispose()


asyncio.run(main())
