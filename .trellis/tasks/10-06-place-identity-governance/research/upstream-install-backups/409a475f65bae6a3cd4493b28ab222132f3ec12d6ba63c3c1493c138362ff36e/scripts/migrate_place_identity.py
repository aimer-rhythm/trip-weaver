"""幂等新增身份注册表；默认预览，--apply 才建表，不改原地点和提及。"""
from __future__ import annotations

import argparse
import asyncio
import sys
sys.path.insert(0, '.')

from sqlalchemy import inspect, text
from app.db import engine
from app.models import (Base, PlaceEntity, PlaceEntityMember, PlaceEntityReview, PlaceEntityChange,
                        PlaceIdentityScope, PlaceIdentityScopeSource, PlaceMentionAssignment, PlaceImageAssignment)


async def migrate(connection, apply: bool) -> dict:
    tables = [m.__table__ for m in [PlaceEntity, PlaceEntityMember, PlaceEntityReview, PlaceEntityChange,
                                  PlaceIdentityScope, PlaceIdentityScopeSource, PlaceMentionAssignment, PlaceImageAssignment]]
    before = await connection.run_sync(lambda conn: inspect(conn).get_table_names())
    missing = [t.name for t in tables if t.name not in before]
    columns = await connection.run_sync(lambda conn: [c['name'] for c in inspect(conn).get_columns('place_identity_scope')]) \
        if 'place_identity_scope' in before else []
    missing_columns = ['place_identity_scope.withdrawal_entity_ids'] if 'withdrawal_entity_ids' not in columns else []
    assignment_columns = await connection.run_sync(lambda conn: [c['name'] for c in inspect(conn).get_columns('place_mention_assignment')]) \
        if 'place_mention_assignment' in before else []
    if 'exclusion' not in assignment_columns:
        missing_columns.append('place_mention_assignment.exclusion')
    if apply:
        await connection.run_sync(lambda conn: Base.metadata.create_all(conn, tables=tables))
        await connection.execute(text('ALTER TABLE place_identity_scope ADD COLUMN IF NOT EXISTS withdrawal_entity_ids JSONB'))
        await connection.execute(text('ALTER TABLE place_mention_assignment ADD COLUMN IF NOT EXISTS exclusion JSONB'))
    actual = await connection.run_sync(lambda conn: inspect(conn).get_table_names())
    if apply:
        assert all(t.name in actual for t in tables)
    return {'missing': missing, 'missingColumns': missing_columns, 'apply': apply, 'present': [t.name for t in tables if t.name in actual]}


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    async with engine.begin() as connection:
        print(await migrate(connection, args.apply))
    await engine.dispose()


if __name__ == '__main__':
    asyncio.run(main())
