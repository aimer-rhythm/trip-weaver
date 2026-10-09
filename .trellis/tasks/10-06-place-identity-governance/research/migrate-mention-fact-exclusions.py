"""只新增字段审核可空列，锁定并核对现有治理行及旧审计；默认只读预演。"""
from pathlib import Path
import argparse
import asyncio
import hashlib
import json
import sys
import time
sys.dont_write_bytecode = True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, 'D:/Project/xhs-travel-pipeline')
from sqlalchemy import inspect, text
from app.db import engine
from scripts.migrate_place_identity import migrate

root = Path(__file__).resolve().parent
tables = ['place_entity', 'place_entity_member', 'place_entity_review', 'place_entity_change',
          'place_identity_scope', 'place_identity_scope_source', 'place_mention_assignment', 'place_image_assignment']

async def snapshot(conn):
    result = {}
    for table in tables:
        expression = "to_jsonb(t) - 'fact_exclusions'" if table == 'place_mention_assignment' else 'to_jsonb(t)'
        rows = (await conn.execute(text(f'SELECT ({expression})::text FROM {table} AS t'))).scalars().all()
        result[table] = {'rows': len(rows), 'sha256': hashlib.sha256('\n'.join(sorted(rows)).encode()).hexdigest()}
    return result

async def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--apply', action='store_true'); args = parser.parse_args()
    try:
        async with engine.begin() as conn:
            await conn.execute(text("SET LOCAL lock_timeout='15s'"))
            await conn.execute(text('LOCK TABLE ' + ', '.join(tables) + ' IN ACCESS EXCLUSIVE MODE'))
            before = await snapshot(conn)
            preview = await migrate(conn, False)
            assert not preview['missing']
            columns = await conn.run_sync(lambda c: [v['name'] for v in inspect(c).get_columns('place_mention_assignment')])
            exists = 'fact_exclusions' in columns
            assert preview['missingColumns'] == ([] if exists else ['place_mention_assignment.fact_exclusions'])
            existing = (await conn.execute(text('SELECT id,fact_exclusions FROM place_mention_assignment ORDER BY id'))).all() if exists else None
            applied = await migrate(conn, True) if args.apply else None
            after = await snapshot(conn); assert before == after
            repeated = await migrate(conn, True) if args.apply else None
            if args.apply:
                assert not repeated['missingColumns']
                current = (await conn.execute(text('SELECT id,fact_exclusions FROM place_mention_assignment ORDER BY id'))).all()
                if exists: assert current == existing
                else: assert all(row.fact_exclusions is None for row in current)
        report = {'apply': args.apply, 'preview': preview, 'applied': applied, 'repeated': repeated,
            'before': before, 'after': after, 'dataUnchanged': True}
        output = root / f'mention-fact-exclusions-migration-{time.time_ns()}.json'
        with output.open('x', encoding='utf-8') as handle: json.dump(report, handle, ensure_ascii=False, indent=2)
        print(json.dumps({'file': output.name, 'apply': args.apply, 'missingColumns': preview['missingColumns'], 'dataUnchanged': True}, ensure_ascii=False))
    finally:
        await engine.dispose()

asyncio.run(main())
