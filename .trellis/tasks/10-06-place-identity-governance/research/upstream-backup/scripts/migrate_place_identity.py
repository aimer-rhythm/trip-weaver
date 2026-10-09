"""幂等新增身份注册表；默认预览，--apply 才建表，不改原地点和提及。"""
from __future__ import annotations

import argparse
import asyncio
import sys
sys.path.insert(0, '.')

from sqlalchemy import inspect
from app.db import engine
from app.models import Base, PlaceEntity, PlaceEntityMember, PlaceEntityReview, PlaceEntityChange


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    tables = [m.__table__ for m in [PlaceEntity, PlaceEntityMember, PlaceEntityReview, PlaceEntityChange]]
    async with engine.begin() as connection:
        before = await connection.run_sync(lambda conn: inspect(conn).get_table_names())
        missing = [t.name for t in tables if t.name not in before]
        print({'missing': missing, 'apply': args.apply})
        if args.apply:
            await connection.run_sync(lambda conn: Base.metadata.create_all(conn, tables=tables))
            actual = await connection.run_sync(lambda conn: inspect(conn).get_table_names())
            assert all(t.name in actual for t in tables)
            print('实体注册、成员、待审及变更审计表已就绪')
    await engine.dispose()


if __name__ == '__main__':
    asyncio.run(main())
