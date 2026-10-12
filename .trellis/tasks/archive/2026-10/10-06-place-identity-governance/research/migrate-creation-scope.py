"""仅新增候选所有者列；保留全部身份行与旧审计，输出可复核摘要。"""
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
from sqlalchemy import text
from app.db import engine
from scripts.migrate_place_identity import migrate

root = Path(__file__).resolve().parent
tables = ['place_entity', 'place_entity_member', 'place_entity_review', 'place_entity_change',
          'place_identity_scope', 'place_identity_scope_source', 'place_mention_assignment', 'place_image_assignment']


async def snapshot(conn):
    result = {}
    for table in tables:
        rows = (await conn.execute(text(f"SELECT (to_jsonb(t) - 'withdrawal_entity_ids')::text FROM {table} AS t"))).scalars().all()
        result[table] = {'rows': len(rows), 'sha256': hashlib.sha256('\n'.join(sorted(rows)).encode()).hexdigest()}
    return result


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--apply', action='store_true')
    args = ap.parse_args()
    try:
        async with engine.begin() as conn:
            await conn.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ'))
            before = await snapshot(conn)
            preview = await migrate(conn, False)
            assert not preview['missing'], '此续作迁移只允许补列，不创建缺失的治理表'
            applied = await migrate(conn, True) if args.apply else None
            after = await snapshot(conn)
            assert before == after, '迁移不能修改现有治理行或审计'
            repeated = await migrate(conn, True) if args.apply else None
            if args.apply:
                assert not repeated['missingColumns']
                assert (await conn.execute(text('SELECT count(*) FROM place_identity_scope WHERE withdrawal_entity_ids IS NOT NULL'))).scalar_one() == 0
        report = {'apply': args.apply, 'preview': preview, 'applied': applied, 'repeated': repeated,
                  'before': before, 'after': after, 'dataUnchanged': True}
        file = root / f'creation-scope-migration-{time.time_ns()}.json'
        with file.open('x', encoding='utf-8') as output:
            json.dump(report, output, ensure_ascii=False, indent=2)
        print(json.dumps({'file': file.name, **report}, ensure_ascii=False))
    finally:
        await engine.dispose()


asyncio.run(main())
