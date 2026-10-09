"""仅补非地点排除列；锁住八张治理表并证明旧行、旧审计未改变。"""
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
        expression = "to_jsonb(t) - 'exclusion'" if table == 'place_mention_assignment' else 'to_jsonb(t)'
        rows = (await conn.execute(text(f'SELECT ({expression})::text FROM {table} AS t'))).scalars().all()
        result[table] = {'rows': len(rows), 'sha256': hashlib.sha256('\n'.join(sorted(rows)).encode()).hexdigest()}
    return result


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    try:
        async with engine.begin() as conn:
            await conn.execute(text("SET LOCAL lock_timeout='15s'"))
            await conn.execute(text('LOCK TABLE ' + ', '.join(tables) + ' IN ACCESS EXCLUSIVE MODE'))
            before = await snapshot(conn)
            preview = await migrate(conn, False)
            assert not preview['missing'], '只允许补列，不创建缺失治理表'
            columns = await conn.run_sync(lambda c: [v['name'] for v in inspect(c).get_columns('place_mention_assignment')])
            expected = [] if 'exclusion' in columns else ['place_mention_assignment.exclusion']
            assert preview['missingColumns'] == expected, '须先安装匹配的新迁移代码，且不允许混入其他迁移'
            applied = await migrate(conn, True) if args.apply else None
            after = await snapshot(conn)
            assert before == after, '旧治理行或旧审计发生变化'
            repeated = await migrate(conn, True) if args.apply else None
            if args.apply:
                assert not repeated['missingColumns']
                assert (await conn.execute(text('SELECT count(*) FROM place_mention_assignment WHERE exclusion IS NOT NULL'))).scalar_one() == 0
        report = {'apply': args.apply, 'preview': preview, 'applied': applied, 'repeated': repeated,
            'before': before, 'after': after, 'dataUnchanged': True}
        path = root / f'non-place-exclusion-migration-{time.time_ns()}.json'
        with path.open('x', encoding='utf-8') as output:
            json.dump(report, output, ensure_ascii=False, indent=2)
        print(json.dumps({'file': path.name, **report}, ensure_ascii=False))
    finally:
        await engine.dispose()


asyncio.run(main())
