"""只新增上游派生关系快照表；默认事务预演，保存原表摘要且不导出原文。"""
from pathlib import Path
import argparse
import asyncio
import json
import re
import sys
import time

sys.dont_write_bytecode = True
sys.stdout.reconfigure(encoding='utf-8')
root = Path(__file__).resolve().parent
sys.path.insert(0, 'D:/Project/xhs-travel-pipeline')
import app
app.__path__.insert(0, str(root/'upstream/app'))
from sqlalchemy import text
from sqlalchemy.schema import CreateTable
from app.db import SessionFactory, engine
from app.models import PlaceRelationSnapshot

OLD_TABLES = ['canonical_place', 'canonical_place_source', 'place_summary', 'place_mention', 'raw_note', 'place_relation',
    'place_entity', 'place_entity_member', 'place_entity_review', 'place_entity_change', 'place_identity_scope',
    'place_identity_scope_source', 'place_mention_assignment', 'place_image_assignment']


async def fingerprints(session, tables):
    values = {}
    for table in tables:
        assert re.fullmatch('[a-z_]+', table)
        row = (await session.execute(text(f'''SELECT count(*)::int AS count,
          md5(COALESCE(string_agg(h,'' ORDER BY h),'')) AS digest FROM
          (SELECT md5(to_jsonb(t)::text) h FROM "{table}" t) hashes'''))).mappings().one()
        values[table] = dict(row)
    return values


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    file = root/f'upstream-relation-migration-{"applied" if args.apply else "preview"}-{time.time_ns()}.json'
    try:
        async with SessionFactory() as session:
            await session.execute(text("SET LOCAL lock_timeout='8s'"))
            await session.execute(text("SET LOCAL statement_timeout='45s'"))
            for table in OLD_TABLES:
                await session.execute(text(f'LOCK TABLE "{table}" IN SHARE MODE'))
            before = await fingerprints(session, OLD_TABLES)
            exists = (await session.execute(text("SELECT to_regclass('place_relation_snapshot') IS NOT NULL"))).scalar_one()
            original = await fingerprints(session, ['place_relation_snapshot']) if exists else None
            await session.execute(CreateTable(PlaceRelationSnapshot.__table__, if_not_exists=True))
            first = await fingerprints(session, ['place_relation_snapshot'])
            await session.execute(CreateTable(PlaceRelationSnapshot.__table__, if_not_exists=True))
            second = await fingerprints(session, ['place_relation_snapshot'])
            after = await fingerprints(session, OLD_TABLES)
            assert before == after and first == second
            assert original is None or original == first
            if args.apply:
                await session.commit()
            else:
                await session.rollback()
            report = dict(apply=args.apply, before=before, after=after, original=original,
                first=first, second=second, unchanged=True, idempotent=True)
            with file.open('x', encoding='utf-8') as stream:
                json.dump(report, stream, ensure_ascii=False, indent=2)
            print(json.dumps({'apply': args.apply, 'oldTables': len(OLD_TABLES), 'newTables': second,
                'unchanged': True, 'idempotent': True, 'report': str(file)}, ensure_ascii=False))
    finally:
        await engine.dispose()


asyncio.run(main())
