"""仅专用临时 PostgreSQL 验证注册幂等、增量解析、治理与回滚。"""
from __future__ import annotations

import asyncio
import os
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from app.models import Base, CanonicalPlace, PlaceEntityReview
from app.aggregate.place_identity import (bootstrap, load_catalog, register_place, apply_decision, rollback_decision)


def run(callback):
    async def main():
        url = os.environ.get('IDENTITY_TEST_DATABASE_URL', '')
        if '127.0.0.1:18798/place_identity_test_' not in url:
            pytest.skip('需要专用临时测试库，禁止连接应用库')
        engine = create_async_engine(url)
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        factory = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
        try:
            await callback(factory)
        finally:
            await engine.dispose()
    asyncio.run(main())


def test_注册重跑_改名合并_回滚恢复成员_版本冲突拒绝():
    async def check(factory):
        async with factory() as session:
            session.add_all([CanonicalPlace(city='归一测试', name=n, normalized_name=n) for n in ['大明湖', '大明湖景区']])
            await session.flush()
            assert await bootstrap(session, '归一测试') == 2
            assert await bootstrap(session, '归一测试') == 0
            catalog = await load_catalog(session, '归一测试')
            root, child = catalog.resolve('大明湖'), catalog.resolve('大明湖景区')
            decision = dict(key='test-merge', city='归一测试', entityId=root['entity_id'],
                mergeEntityIds=[child['entity_id']], canonicalName='大明湖公园',
                expectedRevisions={e['entity_id']: e['revision'] for e in [root, child]}, evidence=[{'source': 'test'}])
            result = await apply_decision(session, decision)
            assert await apply_decision(session, decision) == result
            current = await load_catalog(session, '归一测试')
            assert current.resolve('大明湖景区')['entity_id'] == root['entity_id']
            assert current.resolve(place_id=child['primary_place_id'])['entity_id'] == root['entity_id']
            with pytest.raises(ValueError, match='版本'):
                await apply_decision(session, {**decision, 'key': 'outdated', 'mergeEntityIds': []})
            await rollback_decision(session, 'test-merge')
            restored = await load_catalog(session, '归一测试')
            assert restored.resolve('大明湖景区')['entity_id'] == child['entity_id']
            assert restored.resolve('大明湖公园') is None
            await session.rollback()
    run(check)


def test_新增确认别名复用实体_相似变体必须待审():
    async def check(factory):
        async with factory() as session:
            place = CanonicalPlace(city='增量测试', name='大明湖', normalized_name='大明湖')
            session.add(place)
            await session.flush()
            await bootstrap(session, '增量测试')
            root = (await load_catalog(session, '增量测试')).resolve('大明湖')
            await apply_decision(session, dict(key='test-alias', city='增量测试', entityId=root['entity_id'],
                expectedRevisions={root['entity_id']: 1}, aliases=['大明湖景区'], evidence=[{'source': 'test'}]))
            for name, status in [('大明湖景区', 'ACTIVE'), ('大明湖公园', 'REVIEW')]:
                added = CanonicalPlace(city='增量测试', name=name, normalized_name=name)
                session.add(added)
                await session.flush()
                entity = await register_place(session, '增量测试', added)
                assert entity['status'] == status
                assert (entity['entity_id'] == root['entity_id']) == (status == 'ACTIVE')
            assert len((await session.scalars(select(PlaceEntityReview).where(PlaceEntityReview.city == '增量测试'))).all()) == 1
            await session.rollback()
    run(check)


def test_跨城成员拒绝_后续更改阻止过期回滚():
    async def check(factory):
        async with factory() as session:
            for city in ['甲城测试', '乙城测试']:
                session.add(CanonicalPlace(city=city, name='人民公园', normalized_name='人民公园'))
            await session.flush()
            for city in ['甲城测试', '乙城测试']:
                await bootstrap(session, city)
            a = (await load_catalog(session, '甲城测试')).resolve('人民公园')
            b = (await load_catalog(session, '乙城测试')).resolve('人民公园')
            d = dict(key='cross', city='甲城测试', entityId=a['entity_id'], mergeEntityIds=[b['entity_id']],
                     expectedRevisions={a['entity_id']: 1, b['entity_id']: 1}, evidence=[{'source': 'test'}])
            with pytest.raises(ValueError, match='本城'):
                await apply_decision(session, d)
            await apply_decision(session, {**d, 'key': 'first', 'mergeEntityIds': [], 'canonicalName': '甲城人民公园'})
            await apply_decision(session, {**d, 'key': 'second', 'mergeEntityIds': [], 'canonicalName': '公园新名',
                'expectedRevisions': {a['entity_id']: 2}})
            with pytest.raises(ValueError, match='后续'):
                await rollback_decision(session, 'first')
            await session.rollback()
    run(check)
