"""关系快照单调发布；旧内容恢复、门槛变化和事务回滚都不能误认同一发布。"""
import asyncio
import hashlib
import json
import os
from pathlib import Path
import sys

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.aggregate.place_identity import bootstrap, load_catalog
from app.aggregate.mention_identity import apply_scope_decision, load_mention_rows, source_input
from app.aggregate.relation_snapshot import publish_relation_snapshot, relation_manifest
from app.clean.mention_identity import mention_fingerprint, source_fingerprint
from app.models import Base, CanonicalPlace, PlaceMention, PlaceRelationSnapshot, PlaceSummary, RawNote


def run(callback):
    async def main():
        url = os.environ.get('IDENTITY_TEST_DATABASE_URL', '')
        if '127.0.0.1:18798/place_identity_test_' not in url:
            pytest.skip('只允许专用临时库')
        engine = create_async_engine(url)
        try:
            async with engine.begin() as connection:
                await connection.run_sync(Base.metadata.create_all)
            await callback(async_sessionmaker(engine, expire_on_commit=False))
        finally:
            await engine.dispose()
    asyncio.run(main())


async def publish(session, city, **kwargs):
    await session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ'))
    return await publish_relation_snapshot(session, city, **kwargs)


def test_来源修改和恢复推进快照而非实体版本():
    async def check(factory):
        city = '关系单调发布'
        async with factory() as session:
            session.add_all([CanonicalPlace(city=city, name=n, normalized_name=n) for n in ['甲店', '乙园']])
            note = RawNote(city=city, note_id=city, keyword='测试', title='关系', desc='甲店→乙园', status='EXTRACTED')
            session.add(note)
            await session.flush()
            session.add_all([PlaceMention(raw_note_id=note.id, name=n, normalized_name=n) for n in ['甲店', '乙园']])
            await bootstrap(session, city)
            await session.commit()
            first = await publish(session, city, min_mentions=1)
            assert first['revision'] == 1 and len(first['relations']) == 1
            await session.commit()
            assert await publish(session, city) == first
            await session.commit()
            note.desc = '甲店→乙园，新正文'
            await session.commit()
            second = await publish(session, city)
            assert second['revision'] == 2 and second['sourceHash'] != first['sourceHash']
            assert {e['revision'] for e in (await load_catalog(session, city)).entities.values()} == {1}
            await session.commit()
            note.desc = '甲店→乙园'
            await session.commit()
            third = await publish(session, city)
            assert third['revision'] == 3 and third['sourceHash'] == first['sourceHash']
            assert third['relationHash'] == first['relationHash']
            await session.commit()
            fourth = await publish(session, city, min_mentions=2)
            assert fourth['revision'] == 4 and fourth['relations'] == []
            await session.rollback()
            assert (await session.get(PlaceRelationSnapshot, city)).revision == 3
            await session.rollback()
            fifth = await publish(session, city, min_mentions=2)
            await session.commit()
            assert fifth['revision'] == 4
            manifest = relation_manifest(fifth)
            assert 'relations' not in manifest and 'unresolved' not in manifest
            manifest['sourceState']['mentions'].clear()
            assert fifth['sourceState']['mentions']
    run(check)


def test_删除来源发布空图且同库其他城市不变():
    async def check(factory):
        city = '关系来源下线'
        async with factory() as session:
            note = RawNote(city=city, note_id=city, keyword='测试', desc='甲店→乙园', status='EXTRACTED')
            session.add_all([note, *[CanonicalPlace(city=city, name=n, normalized_name=n) for n in ['甲店', '乙园']]])
            await session.flush()
            session.add_all([PlaceMention(raw_note_id=note.id, name=n, normalized_name=n) for n in ['甲店', '乙园']])
            await bootstrap(session, city)
            await session.commit()
            initial = await publish(session, city, min_mentions=1)
            assert initial['relations']
            await session.commit()
            note.status = 'PRIVATE'
            await session.commit()
            removed = await publish(session, city)
            assert removed['revision'] == 2 and removed['relations'] == []
            assert all(m['entityId'] is None for m in removed['sourceState']['mentions'])
            await session.commit()
            other = await publish(session, '关系空城市')
            await session.commit()
            assert other['revision'] == 1 and other['relations'] == []
            assert (await session.get(PlaceRelationSnapshot, city)).revision == 2
    run(check)


def test_发布拒绝不一致的读隔离级别():
    async def check(factory):
        async with factory() as session:
            with pytest.raises(ValueError, match='REPEATABLE READ'):
                await publish_relation_snapshot(session, '错误隔离级别')
            assert not (await session.scalars(select(PlaceRelationSnapshot).where(
                PlaceRelationSnapshot.city == '错误隔离级别'))).all()
    run(check)


def test_长会话缓存不能覆盖其他会话的新发布():
    async def check(factory):
        city = '关系长会话发布'
        async with factory() as first, factory() as second:
            await publish(first, city)
            await first.commit()
            held = await first.get(PlaceRelationSnapshot, city)
            await first.commit()
            assert (await publish(second, city, min_mentions=3))['revision'] == 2
            await second.commit()
            current = await publish(first, city)
            assert current['revision'] == 2 and current['sourceState']['minMentions'] == 3
            assert held.revision == 2
    run(check)


def test_两分店真实原文治理到双导出_同版本来源下线及恢复(tmp_path, monkeypatch):
    async def check(factory):
        from scripts import export_to_tripweaver as places_exporter, mine_place_relations as relation_exporter
        from app.web import api
        city = '关系上下游合成城'
        folder = Path(os.environ['RELATION_FIXTURE_DIR']) if os.environ.get('RELATION_FIXTURE_DIR') else tmp_path
        folder.mkdir(parents=True, exist_ok=True)
        assert not (folder/'report.json').exists(), '不覆盖已冻结的联测证据'
        body = '东门小院这家双门咖啡→北园。西街客厅这家双门咖啡→南馆'
        async with factory() as session:
            places = [CanonicalPlace(city=city, name=n, normalized_name=n, place_type='attraction', quality_score=50,
                geo_status='resolved', latitude=30.1 + i * .002, longitude=120.1 + i * .002)
                for i, n in enumerate(['双门咖啡', '东门小院', '西街客厅', '北园', '南馆'])]
            notes = [RawNote(city=city, note_id=f'{city}-{i}', keyword='同游', title=f'🧭路线{i}', desc=body, status='EXTRACTED') for i in [1, 2]]
            session.add_all([*places, *notes])
            await session.flush()
            for p in places:
                session.add(PlaceSummary(canonical_place_id=p.id, mention_count_30d=2, recommend_score=10))
            for note in notes:
                for name, quote in [('双门咖啡', '东门小院这家双门咖啡'), ('双门咖啡', '西街客厅这家双门咖啡'), ('北园', '北园'), ('南馆', '南馆')]:
                    session.add(PlaceMention(raw_note_id=note.id, name=name, normalized_name=name,
                        evidence_text=quote, reason='同游路线的原文提及', confidence=.95))
            await bootstrap(session, city)
            await session.flush()
            catalog = await load_catalog(session, city)
            entities = {p.name: catalog.resolve(place_id=p.id) for p in places}
            target_ids = [entities[name]['entity_id'] for name in ['东门小院', '西街客厅']]
            source = places[0]
            rows = [r for r in await load_mention_rows(session, city) if r['name'] == source.name]
            affected = [entities[source.name]['entity_id'], *target_ids]
            decision = dict(key='relation-two-branches', city=city, sourcePlaceId=source.id,
                expectedSourceHash=source_fingerprint(source_input(source)), expectedScopeRevision=0,
                expectedRevisions={eid: catalog.entities[eid]['revision'] for eid in affected},
                assignments=[dict(mentionId=r['id'], inputHash=mention_fingerprint(r),
                    entityId=target_ids[0 if r['evidence_text'].startswith('东门') else 1]) for r in rows],
                evidence=[{'kind': '合成测试原文分店定位'}])
            await apply_scope_decision(session, decision)
            versions = {eid: e['revision'] for eid, e in (await load_catalog(session, city)).entities.items()}
            await session.commit()
            note_id = notes[1].id
        monkeypatch.setattr(places_exporter, 'SessionFactory', factory)
        monkeypatch.setattr(relation_exporter, 'SessionFactory', factory)
        monkeypatch.setattr(api, 'SessionFactory', factory)
        report = {'synthetic': True, 'city': city, 'targetIds': target_ids,
            'oldId': entities[source.name]['entity_id'], 'files': {}}
        declarations = []
        for label, status in [('initial', 'EXTRACTED'), ('withdrawn', 'PRIVATE'), ('restored', 'EXTRACTED')]:
            async with factory() as session:
                note = await session.get(RawNote, note_id)
                note.status = status
                await session.commit()
            places_file = folder/f'xhs-places-{label}.json'
            relations_file = folder/f'xhs-place-relations-{label}.json'
            monkeypatch.setattr(sys, 'argv', ['export_to_tripweaver.py', '--city', city, '--out', str(places_file)])
            await places_exporter.main()
            paired_bytes = relations_file.read_bytes()
            monkeypatch.setattr(sys, 'argv', ['mine_place_relations.py', '--city', city, '--out', str(relations_file)])
            await relation_exporter.main()
            assert relations_file.read_bytes() == paired_bytes, '常规导出必须自带与独立挖掘相同的关系文件'
            exported = json.loads(places_file.read_text(encoding='utf-8'))
            relations = json.loads(relations_file.read_text(encoding='utf-8'))
            assert exported['relationIdentity'] == relations['relationIdentity']
            declarations.append(relations['relationIdentity'])
            if label == 'withdrawn':
                assert relations['relations'] == []
            else:
                assert len(relations['relations']) == 2
                assert all(r['strength'] == 'direct' and r['noteCount'] == 2 for r in relations['relations'])
            assert (await api._stats(city))['relations'] == len(relations['relations'])
            report['files'][label] = {kind: {'file': p.name, 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()}
                for kind, p in [('places', places_file), ('relations', relations_file)]}
        assert [d['revision'] for d in declarations] == [1, 2, 3]
        assert declarations[0]['sourceHash'] == declarations[2]['sourceHash']
        async with factory() as session:
            assert {eid: e['revision'] for eid, e in (await load_catalog(session, city)).entities.items()} == versions
        report.update(revisions=[1, 2, 3], restoredSameSourceHash=True, entityRevisionsUnchanged=True)
        (folder/'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    run(check)
