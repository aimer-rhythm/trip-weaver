"""幂等新增身份注册表；默认预览，--apply 才建表，不改原地点和提及。"""
from __future__ import annotations

import argparse
import asyncio
import sys
sys.path.insert(0, '.')

from sqlalchemy import inspect
from app.db import engine
from app.models import (Base, PlaceEntity, PlaceEntityMember, PlaceEntityReview, PlaceEntityChange,
                        PlaceIdentityScope, PlaceIdentityScopeSource, PlaceMentionAssignment, PlaceImageAssignment)


async def migrate(connection, apply: bool) -> dict:
    tables = [m.__table__ for m in [PlaceEntity, PlaceEntityMember, PlaceEntityReview, PlaceEntityChange,
                                  PlaceIdentityScope, PlaceIdentityScopeSource, PlaceMentionAssignment, PlaceImageAssignment]]
    before = await connection.run_sync(lambda conn: inspect(conn).get_table_names())
    missing = [t.name for t in tables if t.name not in before]
    if apply:
        await connection.run_sync(lambda conn: Base.metadata.create_all(conn, tables=tables))
    actual = await connection.run_sync(lambda conn: inspect(conn).get_table_names())
    if apply:
        assert all(t.name in actual for t in tables)
    return {'missing': missing, 'apply': apply, 'present': [t.name for t in tables if t.name in actual]}


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    async with engine.begin() as connection:
        print(await migrate(connection, args.apply))
    await engine.dispose()


if __name__ == '__main__':
    asyncio.run(main())
