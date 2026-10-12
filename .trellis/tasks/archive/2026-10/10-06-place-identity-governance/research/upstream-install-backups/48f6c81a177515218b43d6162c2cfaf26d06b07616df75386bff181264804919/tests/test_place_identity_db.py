"""仅专用临时 PostgreSQL 验证注册幂等、增量解析、治理与回滚。"""
from __future__ import annotations

import asyncio
import os
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from app.models import Base, CanonicalPlace, PlaceEntityReview
from app.models import RawNote, PlaceMention
from app.aggregate.place_identity import (bootstrap, load_catalog, register_place, apply_decision, rollback_decision,
    apply_review_decision, audit_catalog, enqueue_review)


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


def test_增量同步复用确认别名_并发同步不产生重复源记录(monkeypatch):
    from app.aggregate import summary
    async def check(factory):
        monkeypatch.setattr(summary, 'SessionFactory', factory)
        async def coordinates(*args):
            return {'longitude':117.03,'latitude':36.67}
        monkeypatch.setattr(summary, 'resolve_coordinates', coordinates)
        async with factory() as session:
            source = CanonicalPlace(city='同步并发测试',name='大明湖',normalized_name='大明湖',geo_status='resolved')
            session.add(source)
            await session.flush()
            await bootstrap(session,'同步并发测试')
            entity = (await load_catalog(session,'同步并发测试')).resolve('大明湖')
            await apply_decision(session,dict(key='sync-alias',city='同步并发测试',entityId=entity['entity_id'],
                aliases=['大明湖景区'],expectedRevisions={entity['entity_id']:1},evidence=[{'source':'test'}]))
            note = RawNote(city='同步并发测试',note_id='identity-sync-note',keyword='地点')
            session.add(note)
            await session.flush()
            session.add_all([PlaceMention(raw_note_id=note.id,name=n,normalized_name=n) for n in ['大明湖景区','五龙潭']])
            await session.commit()
        results = await asyncio.gather(summary.sync_canonical('同步并发测试'),summary.sync_canonical('同步并发测试'))
        assert sum(result['created'] for result in results) == 1
        async with factory() as session:
            places = (await session.scalars(select(CanonicalPlace).where(CanonicalPlace.city=='同步并发测试'))).all()
            assert {p.name for p in places} == {'大明湖','五龙潭'}
            catalog = await load_catalog(session,'同步并发测试')
            assert catalog.resolve('大明湖景区')['entity_id'] == entity['entity_id']
    run(check)


def test_独立主体审核阻止误并_审计不反复入队_回滚恢复待审():
    async def check(factory):
        async with factory() as session:
            city = '独立审核测试'
            session.add_all([CanonicalPlace(city=city,name=n,normalized_name=n) for n in ['国家博物馆','国家自然博物馆']])
            await session.flush()
            await bootstrap(session, city)
            catalog = await load_catalog(session, city)
            ids = list(catalog.entities)
            await enqueue_review(session,city,{'entityIds':ids,'reason':'similar_name'})
            review = await session.scalar(select(PlaceEntityReview).where(PlaceEntityReview.city==city))
            decision = dict(key='distinct-review-test',city=city,reviewFingerprint=review.fingerprint,
                expectedRevisions={eid:1 for eid in ids},verdict='distinct',explanation='不同机构、不同地址',
                evidence=[{'source':'两个机构的独立官网'}])
            after = await apply_review_decision(session,decision)
            assert after == await apply_review_decision(session,decision)
            assert review.status == 'REJECTED'
            current = await load_catalog(session,city)
            assert frozenset(ids) in current.distinct_pairs
            assert audit_catalog(current) == []
            with pytest.raises(ValueError,match='独立或组成'):
                await apply_decision(session,dict(key='bad-merge',city=city,entityId=ids[0],mergeEntityIds=[ids[1]],
                    expectedRevisions={eid:1 for eid in ids},evidence=[{'source':'错误的名称相似推断'}]))
            await rollback_decision(session,decision['key'])
            assert (await load_catalog(session,city)).distinct_pairs == set()
            assert review.status == 'PENDING'
            await session.rollback()
    run(check)


def test_组成审核释放独立新实体_证据不足仍隔离_过期审核拒绝():
    async def check(factory):
        async with factory() as session:
            city = '新增审核测试'
            root = CanonicalPlace(city=city,name='测试公园',normalized_name='测试公园')
            session.add(root)
            await session.flush()
            await bootstrap(session,city)
            child = CanonicalPlace(city=city,name='测试公园南门',normalized_name='测试公园南门')
            session.add(child)
            await session.flush()
            entity = await register_place(session,city,child)
            assert entity['status']=='REVIEW'
            review = await session.scalar(select(PlaceEntityReview).where(PlaceEntityReview.city==city))
            catalog = await load_catalog(session,city)
            base = dict(city=city,reviewFingerprint=review.fingerprint,expectedRevisions={eid:1 for eid in catalog.entities},
                explanation='核实独立入口和母景区的范围',evidence=[{'source':'景区导览图'}])
            await apply_review_decision(session,dict(**base,key='uncertain-review',verdict='uncertain'))
            assert (await load_catalog(session,city)).resolve(place_id=child.id)['status']=='REVIEW'
            with pytest.raises(ValueError,match='过期'):
                await apply_review_decision(session,{**base,'key':'stale-review','verdict':'distinct','expectedRevisions':{}})
            decision = dict(**base,key='part-of-review',verdict='part_of',childEntityId=entity['entity_id'])
            await apply_review_decision(session,decision)
            current = await load_catalog(session,city)
            assert current.resolve(place_id=child.id)['status']=='ACTIVE'
            assert current.resolve(place_id=child.id)['revision']==2
            assert current.resolve(place_id=child.id)['entity_id']!=current.resolve(place_id=root.id)['entity_id']
            await rollback_decision(session,decision['key'])
            assert (await load_catalog(session,city)).resolve(place_id=child.id)['status']=='REVIEW'
            assert review.status=='PENDING'
            await session.rollback()
    run(check)


def test_新增地点匹配多个主体_逐对审核全部通过才释放():
    async def check(factory):
        async with factory() as session:
            city = '多候选审核测试'
            session.add_all([CanonicalPlace(city=city, name=n, normalized_name=n)
                for n in ['测试公园南门', '测试公园北门']])
            await session.flush()
            await bootstrap(session, city)
            added = CanonicalPlace(city=city, name='测试公园东门', normalized_name='测试公园东门')
            session.add(added)
            await session.flush()
            entity = await register_place(session, city, added)
            reviews = (await session.scalars(select(PlaceEntityReview).where(PlaceEntityReview.city == city)
                .order_by(PlaceEntityReview.id))).all()
            assert len(reviews) == 2
            assert all(len(r.detail['entityIds']) == 2 for r in reviews)
            # 增量候选与日常审计必须同一 fingerprint，不重复制造待审项。
            for detail in audit_catalog(await load_catalog(session, city)):
                if entity['entity_id'] in detail['entityIds']:
                    await enqueue_review(session, city, detail)
            assert len((await session.scalars(select(PlaceEntityReview).where(PlaceEntityReview.city == city))).all()) == 2
            decisions = []
            for index, review in enumerate(reviews):
                catalog = await load_catalog(session, city)
                decision = dict(key=f'multiple-review-{index}', city=city, reviewFingerprint=review.fingerprint,
                    expectedRevisions={eid: catalog.entities[eid]['revision'] for eid in review.detail['entityIds']},
                    verdict='distinct', explanation='三个方向是各自独立的入口', evidence=[{'source': '测试导览图'}])
                decisions.append(decision)
                await apply_review_decision(session, decision)
                current = (await load_catalog(session, city)).resolve(place_id=added.id)
                assert current['status'] == ('REVIEW' if index == 0 else 'ACTIVE')
            await rollback_decision(session, decisions[-1]['key'])
            assert (await load_catalog(session, city)).resolve(place_id=added.id)['status'] == 'REVIEW'
            await session.rollback()
    run(check)


def test_合并后的剩余候选按现行主体版本继续审核():
    async def check(factory):
        async with factory() as session:
            city = '重定向审核测试'
            session.add_all([CanonicalPlace(city=city, name=n, normalized_name=n)
                for n in ['测试公园', '测试公园景区', '测试公园南门']])
            await session.flush()
            await bootstrap(session, city)
            catalog = await load_catalog(session, city)
            root, alias, gate = [catalog.resolve(n) for n in ['测试公园', '测试公园景区', '测试公园南门']]
            await enqueue_review(session, city, {'reason': 'similar_name',
                'entityIds': [alias['entity_id'], gate['entity_id']]})
            review = await session.scalar(select(PlaceEntityReview).where(PlaceEntityReview.city == city))
            await enqueue_review(session, city, {'reason': 'similar_name',
                'entityIds': [root['entity_id'], gate['entity_id']]})
            await apply_decision(session, dict(key='redirect-review-merge', city=city, entityId=root['entity_id'],
                mergeEntityIds=[alias['entity_id']], expectedRevisions={root['entity_id']: 1, alias['entity_id']: 1},
                evidence=[{'source': '测试同义证据'}]))
            decision = dict(key='redirect-review-part', city=city, reviewFingerprint=review.fingerprint,
                expectedRevisions={root['entity_id']: 2, gate['entity_id']: 1}, verdict='part_of',
                childEntityId=gate['entity_id'], explanation='南门是独立入口', evidence=[{'source': '测试导览图'}])
            await apply_review_decision(session, decision)
            assert frozenset([root['entity_id'], gate['entity_id']]) in (await load_catalog(session, city)).distinct_pairs
            assert len((await session.scalars(select(PlaceEntityReview).where(
                PlaceEntityReview.city==city, PlaceEntityReview.status=='REJECTED'))).all())==2
            await rollback_decision(session, decision['key'])
            assert review.status == 'PENDING'
            assert len((await session.scalars(select(PlaceEntityReview).where(
                PlaceEntityReview.city==city, PlaceEntityReview.status=='PENDING'))).all())==2
            await session.rollback()
    run(check)


def test_旧格式审核在改名及成员合并后保留指纹与原证据_不重复入队():
    async def check(factory):
        async with factory() as session:
            city = '稳定审核指纹测试'
            session.add_all([CanonicalPlace(city=city, name=n, normalized_name=n)
                for n in ['测试公园', '测试公园景区', '测试公园南门']])
            await session.flush()
            await bootstrap(session, city)
            catalog = await load_catalog(session, city)
            root, alias, gate = [catalog.resolve(n) for n in ['测试公园', '测试公园景区', '测试公园南门']]
            original = {'reason': 'similar_name', 'entityIds': [alias['entity_id'], gate['entity_id']],
                'names': ['测试公园景区', '测试公园南门']}
            # 模拟已应用批次仍引用的旧格式指纹，不能通过重算指纹破坏历史。
            session.add(PlaceEntityReview(city=city, fingerprint='historical-fingerprint', detail=original))
            await session.flush()
            await apply_decision(session, dict(key='review-rename', city=city, entityId=alias['entity_id'],
                canonicalName='测试公园风景区', expectedRevisions={alias['entity_id']:1}, evidence=[{'source':'test'}]))
            await enqueue_review(session, city, {**original, 'names': ['测试公园风景区', '测试公园南门']})
            await apply_decision(session, dict(key='review-redirect', city=city, entityId=root['entity_id'],
                mergeEntityIds=[alias['entity_id']], expectedRevisions={root['entity_id']:1,alias['entity_id']:2},
                evidence=[{'source':'test'}]))
            for _ in range(2):
                await enqueue_review(session, city, {'reason':'similar_name',
                    'entityIds':[gate['entity_id'],root['entity_id']], 'names':['测试公园南门','测试公园']})
            reviews = (await session.scalars(select(PlaceEntityReview).where(PlaceEntityReview.city==city))).all()
            assert len(reviews)==1
            assert reviews[0].fingerprint=='historical-fingerprint' and reviews[0].detail==original
            await rollback_decision(session, 'review-redirect')
            await rollback_decision(session, 'review-rename')
            await enqueue_review(session, city, original)
            assert len((await session.scalars(select(PlaceEntityReview).where(PlaceEntityReview.city==city))).all())==1
            await session.rollback()
    run(check)


def test_已治理实体缺坐标和聚合仍可导出_未治理和待审不放行(monkeypatch, tmp_path):
    import json
    import sys
    from scripts import export_to_tripweaver as exporter
    async def check(factory):
        city = '缺坐标导出测试'
        async with factory() as session:
            rows = [CanonicalPlace(city=city, name=n, normalized_name=n, place_type='attraction')
                for n in ['讲武堂', '讲武堂旧址', '无证据旧记录', '已停用记录']]
            rows[-1].is_active = False
            rows[0].is_active = rows[1].is_active = False  # 历史评分把缺坐标记录自动停用。
            session.add_all(rows)
            await session.flush()
            await bootstrap(session, city)
            catalog = await load_catalog(session, city)
            a, b, inactive = [catalog.resolve(n) for n in ['讲武堂', '讲武堂旧址', '已停用记录']]
            await apply_decision(session, dict(key='export-unknown-geometry', city=city,
                entityId=a['entity_id'], mergeEntityIds=[b['entity_id']],
                expectedRevisions={a['entity_id']:1,b['entity_id']:1},
                overrides={'lat':None,'lng':None,'geoStatus':'unresolvable','exportApproved':True},
                evidence=[{'source':'馆史核实并明确批准缺坐标实体导出'}]))
            await apply_decision(session, dict(key='export-inactive', city=city, entityId=inactive['entity_id'],
                expectedRevisions={inactive['entity_id']:1}, evidence=[{'source':'保留停用状态'}]))
            pending = CanonicalPlace(city=city, name='讲武堂公园', normalized_name='讲武堂公园')
            session.add(pending)
            await session.flush()
            assert (await register_place(session,city,pending))['status'] == 'REVIEW'
            await session.commit()
        out = tmp_path / 'xhs-places-test.json'
        monkeypatch.setattr(exporter, 'SessionFactory', factory)
        monkeypatch.setattr(sys, 'argv', ['export_to_tripweaver.py','--city',city,'--out',str(out)])
        await exporter.main()
        places = json.loads(out.read_text(encoding='utf-8'))['places']
        assert len(places) == 1, '缺坐标不能丢失确认身份，也不能放行未治理、待审或停用记录'
        assert places[0]['id'] == a['entity_id']
        assert places[0]['lat'] is None and places[0]['lng'] is None
        assert places[0]['payload']['geoStatus'] == 'unresolvable'
        assert 'exportApproved' not in places[0]['payload']
        assert set(places[0]['payload']['identity']['memberIds']) == {a['entity_id'], b['entity_id']}
    run(check)
