"""没有原始主源的分店须随逐提及治理原子创建、导出并可审计回滚。"""
import copy
import json
import sys
from uuid import uuid4

import pytest
from sqlalchemy import select, text

from app.aggregate.mention_identity import apply_scope_decision, load_mention_catalog, load_mention_rows, scope_snapshot, source_input
from app.aggregate.place_identity import bootstrap, load_catalog, register_place, rollback_decision
from app.clean.mention_identity import mention_fingerprint, source_fingerprint
from app.clean.identity import legacy_id
from app.models import CanonicalPlace, PlaceEntity, PlaceEntityChange, PlaceEntityReview, PlaceImageAssignment, PlaceMention, PlaceSummary, RawNote
from test_mention_identity_db import run


async def seed(session):
    city = f'新分店-{uuid4().hex}'
    source = CanonicalPlace(city=city, name='沐咖啡', normalized_name='沐咖啡', geo_status='resolved',
        latitude=30, longitude=120, place_type='food', address='泛名旧匹配', typical_visit_minutes=180,
        content_profile={'profileVersion': 1, 'qualityVersion': 2, 'intro': '不能转给新分店的旧缓存'})
    note = RawNote(city=city, note_id=uuid4().hex, keyword='咖啡', title='两间分店',
        desc='沐咖啡（南街店）适合坐30分钟。沐咖啡（北街店）适合坐60分钟。还听说过沐咖啡，未说明分店。', status='EXTRACTED')
    session.add_all([source, note])
    await session.flush()
    await bootstrap(session, city)
    session.add(PlaceSummary(canonical_place_id=source.id, mention_count_30d=99, recommend_score=999))
    for i, minutes in enumerate([30, 60, None]):
        session.add(PlaceMention(raw_note_id=note.id, name='沐咖啡', normalized_name='沐咖啡', place_type='food',
            mention_type='recommend', reason=f'本条提及{i}', evidence_text='沐咖啡', confidence=.95,
            fact_type='visit_duration' if minutes else None, fact_value={'minutes': minutes} if minutes else None))
    await session.flush()
    rows = await load_mention_rows(session, city)
    old = (await load_catalog(session, city)).resolve(place_id=source.id)
    new_ids = [uuid4().hex, uuid4().hex]
    creations = [dict(entityId=eid, canonicalName=name, aliases=[], overrides={'category': '美食'},
        evidence=[dict(mentionId=row['id'], inputHash=mention_fingerprint(row), quote=name)])
        for eid, name, row in zip(new_ids, ['沐咖啡（南街店）', '沐咖啡（北街店）'], rows)]
    request = dict(key=uuid4().hex, city=city, sourcePlaceId=source.id,
        expectedSourceHash=source_fingerprint(source_input(source)), expectedScopeRevision=0,
        expectedRevisions={old['entity_id']: old['revision'], **{eid: 0 for eid in new_ids}},
        newEntities=creations,
        assignments=[dict(mentionId=row['id'], inputHash=mention_fingerprint(row), entityId=eid)
                     for row, eid in zip(rows, [*new_ids, None])], evidence=[{'kind': '原文逐提及核实分店'}])
    return source, note, rows, old, request


def test_原文创建两分店_无主源真实导出_旧ID撤回_不借坐标事实_幂等回滚(tmp_path, monkeypatch):
    async def check(factory):
        async with factory() as session:
            source, _, rows, old, request = await seed(session)
            before = copy.deepcopy((await load_catalog(session, source.city)).entities)
            after = await apply_scope_decision(session, request)
            assert await apply_scope_decision(session, request) == after
            new_ids = [e['entityId'] for e in request['newEntities']]
            catalog = await load_mention_catalog(session, source.city)
            assert catalog.catalog.entities[old['entity_id']]['revision'] == 2
            for eid in new_ids:
                e = catalog.catalog.entities[eid]
                assert e['revision'] == 1 and e['primary_place_id'] is None and e['legacy_ids'] == [eid]
                assert e['overrides']['lat'] is None and e['overrides']['lng'] is None
            assert [catalog.resolve(r)['entity']['entity_id'] for r in rows[:2]] == new_ids
            assert catalog.resolve(rows[2])['status'] == 'review'
            assert all(name in catalog.scopes[source.id]['name_keys'] for name in ['沐咖啡(南街店)', '沐咖啡(北街店)'])
            assert await load_mention_rows(session, source.city) == rows
            await session.commit()
        from scripts import export_to_tripweaver as exporter
        monkeypatch.setattr(exporter, 'SessionFactory', factory)
        file = tmp_path/'xhs-places-created.json'
        monkeypatch.setattr(sys, 'argv', ['export_to_tripweaver.py', '--city', source.city, '--out', str(file)])
        await exporter.main()
        exported = {p['id']: p for p in json.loads(file.read_text(encoding='utf-8'))['places']}
        assert set(exported) == {old['entity_id'], *new_ids}
        assert exported[old['entity_id']]['payload']['identityWithdrawal']['candidateIds'] == sorted(new_ids)
        for eid, minutes in zip(new_ids, [30, 60]):
            p = exported[eid]
            assert p['verified'] and p['lat'] is None and p['lng'] is None
            assert p['payload']['typicalVisitMinutes'] == minutes and p['payload']['mentionCount'] == 1
            assert p['payload']['imageIdentity']['approved'] == []
            assert 'sourceEntityId' not in p and 'sourcePlaceId' not in p
            assert '旧缓存' not in json.dumps(p, ensure_ascii=False)
        async with factory() as session:
            await rollback_decision(session, request['key'])
            assert (await load_catalog(session, source.city)).entities == before
            assert await load_mention_rows(session, source.city) == rows
            assert not (await load_mention_catalog(session, source.city)).scopes
            remaining = (await session.scalars(select(PlaceEntityReview).where(PlaceEntityReview.city == source.city))).all()
            assert not remaining
    run(check)


def test_新实体后来注册真实源仍不借未经治理的地址缓存(monkeypatch, tmp_path):
    from scripts import export_to_tripweaver as exporter
    async def check(factory):
        async with factory() as session:
            source, _, _, _, request = await seed(session)
            await apply_scope_decision(session, request)
            e = request['newEntities'][0]
            p = CanonicalPlace(city=source.city, name=e['canonicalName'], normalized_name=e['canonicalName'],
                address='未核实的远端地址', adcode='999999', latitude=40, longitude=116, geo_status='resolved',
                place_type='hotel', typical_visit_minutes=240,
                content_profile={'profileVersion': 1, 'qualityVersion': 2, 'intro': '未经身份绑定的缓存'})
            session.add(p); await session.flush()
            await register_place(session, source.city, p)
            await session.commit()
        monkeypatch.setattr(exporter, 'SessionFactory', factory)
        file = tmp_path / 'registered-export.json'
        monkeypatch.setattr(sys, 'argv', ['export_to_tripweaver.py', '--city', source.city, '--out', str(file)])
        await exporter.main()
        exported = {p['id']: p for p in json.loads(file.read_text(encoding='utf-8'))['places']}
        p = exported[e['entityId']]
        assert p['verified'] and p['lat'] is None and p['lng'] is None and p['category'] == '美食'
        assert p['payload']['typicalVisitMinutes'] == 30
        assert p['payload']['geoStatus'] == 'unresolved'
        assert not p['payload'].get('address') and not p['payload'].get('adcode')
        assert '未经身份绑定' not in json.dumps(p, ensure_ascii=False)
    run(check)


def test_候选所有者迁移和后续治理回滚不改旧scope快照():
    from scripts.migrate_place_identity import migrate
    from test_joint_mention_identity_db import seed_joint, request_joint, entity_ids
    async def check(factory):
        async with factory() as session:
            sources, branches, _ = await seed_joint(session, city=f'旧所有者-{uuid4().hex}')
            targets = await entity_ids(session, branches)
            first = await request_joint(session, sources, targets, key=uuid4().hex)
            after = await apply_scope_decision(session, first)
            # 重建安装前没有此列的旧快照和表结构；迁移不得回填旧审计。
            legacy = copy.deepcopy(after)
            legacy['scopes'][0].pop('withdrawal_entity_ids')
            change = await session.scalar(select(PlaceEntityChange).where(PlaceEntityChange.change_key == first['key']))
            change.after = legacy
            await session.flush()
            connection = await session.connection()
            await connection.execute(text('ALTER TABLE place_identity_scope DROP COLUMN withdrawal_entity_ids'))
            assert (await migrate(connection, False))['missingColumns'] == ['place_identity_scope.withdrawal_entity_ids']
            await migrate(connection, True)
            assert (await migrate(connection, True))['missingColumns'] == []
            actual = await scope_snapshot(session, sources[0].city, sources[0].id,
                legacy['scopes'][0]['name_keys'], [e['entity_id'] for e in legacy['entities']])
            assert actual == legacy
            second = await request_joint(session, sources, [None, None], key=uuid4().hex)
            updated = await apply_scope_decision(session, second)
            assert updated['scopes'][0]['withdrawal_entity_ids'] == sorted(await entity_ids(session, sources))
            await rollback_decision(session, second['key'])
            actual = await scope_snapshot(session, sources[0].city, sources[0].id,
                legacy['scopes'][0]['name_keys'], [e['entity_id'] for e in legacy['entities']])
            assert actual == legacy
            await rollback_decision(session, first['key'])
    run(check)


@pytest.mark.parametrize('error', ['no_evidence', 'bad_quote', 'wrong_mention', 'bad_hash', 'missing_assignment',
    'duplicate_id', 'duplicate_name', 'generic_alias', 'name_collision', 'wrong_revision', 'foreign_id', 'legacy_id',
    'bad_coordinates', 'private_note', 'unquoted_alias'])
def test_创建证据冲突在任何实体写入前拒绝(error):
    async def check(factory):
        async with factory() as session:
            source, note, rows, old, request = await seed(session)
            e = request['newEntities'][0]
            if error == 'no_evidence': e['evidence'] = []
            elif error == 'bad_quote': e['evidence'][0]['quote'] = '另一篇不存在的原文'
            elif error == 'wrong_mention': e['evidence'][0]['mentionId'] = rows[1]['id']
            elif error == 'bad_hash': e['evidence'][0]['inputHash'] = 'a' * 64
            elif error == 'missing_assignment': request['assignments'][0]['entityId'] = None
            elif error == 'duplicate_id': request['newEntities'][1]['entityId'] = e['entityId']
            elif error == 'duplicate_name': request['newEntities'][1]['canonicalName'] = e['canonicalName']
            elif error == 'generic_alias': e['aliases'] = ['沐咖啡']
            elif error == 'unquoted_alias': e['aliases'] = ['没有原文的同义词']
            elif error == 'name_collision':
                session.add(CanonicalPlace(city=source.city, name=e['canonicalName'], normalized_name=e['canonicalName']))
                await session.flush()
                await bootstrap(session, source.city)
            elif error == 'wrong_revision': request['expectedRevisions'][e['entityId']] = 1
            elif error == 'bad_coordinates': e['overrides'].update(lat=91, lng=180)
            elif error == 'private_note':
                note.status = 'PRIVATE'; await session.flush()
            elif error in ('foreign_id', 'legacy_id'):
                if error == 'foreign_id':
                    session.add(PlaceEntity(entity_id=e['entityId'], city='另一城', canonical_name='占用主体', aliases=[], legacy_ids=[]))
                else:
                    entity = await session.scalar(select(PlaceEntity).where(PlaceEntity.entity_id == old['entity_id']))
                    entity.legacy_ids = [*entity.legacy_ids, e['entityId']]
                await session.flush()
            before = copy.deepcopy((await load_catalog(session, source.city)).entities)
            with pytest.raises(ValueError): await apply_scope_decision(session, request)
            assert (await load_catalog(session, source.city)).entities == before
            assert not (await load_mention_catalog(session, source.city)).scopes
    run(check)


@pytest.mark.parametrize('later', ['new_mention', 'new_source', 'new_review', 'new_image'])
def test_新增分店的后续提及成员审核图片阻止回滚(later):
    async def check(factory):
        async with factory() as session:
            source, note, _, _, request = await seed(session)
            await apply_scope_decision(session, request)
            e = request['newEntities'][0]
            if later == 'new_mention':
                session.add(PlaceMention(raw_note_id=note.id, name=e['canonicalName'], normalized_name=e['canonicalName']))
            elif later == 'new_source':
                p = CanonicalPlace(city=source.city, name=e['canonicalName'], normalized_name=e['canonicalName'])
                session.add(p); await session.flush()
                await register_place(session, source.city, p)
            elif later == 'new_review':
                session.add(PlaceEntityReview(city=source.city, fingerprint=uuid4().hex,
                    detail={'reason': 'similar_name', 'entityIds': [e['entityId'], 'later']}))
            else:
                session.add(PlaceImageAssignment(city=source.city, image_key='note_image:999', entity_id=e['entityId'],
                    input_hash='a' * 64, revision=1, change_key='later', evidence=[]))
            await session.flush()
            with pytest.raises(ValueError, match='后续'): await rollback_decision(session, request['key'])
            assert (await load_catalog(session, source.city)).entities[e['entityId']]['status'] == 'ACTIVE'
    run(check)


def test_已回滚创建ID不许换key重新占用():
    async def check(factory):
        async with factory() as session:
            source, _, _, _, request = await seed(session)
            await apply_scope_decision(session, request)
            await rollback_decision(session, request['key'])
            request['key'] = uuid4().hex
            with pytest.raises(ValueError, match='历史身份占用'): await apply_scope_decision(session, request)
            assert len((await load_catalog(session, source.city)).entities) == 1
    run(check)


@pytest.mark.parametrize('entry', ['register', 'bootstrap'])
def test_普通增量注册同样不能认领已回滚的新实体ID(entry):
    async def check(factory):
        async with factory() as session:
            source, _, _, _, request = await seed(session)
            e = request['newEntities'][0]
            prior = e['entityId']
            reserved = legacy_id(source.city, e['canonicalName'])
            e['entityId'] = reserved
            request['expectedRevisions'][reserved] = request['expectedRevisions'].pop(prior)
            request['assignments'][0]['entityId'] = reserved
            await apply_scope_decision(session, request)
            await rollback_decision(session, request['key'])
            p = CanonicalPlace(city=source.city, name=e['canonicalName'], normalized_name=e['canonicalName'])
            session.add(p); await session.flush()
            if entry == 'register': await register_place(session, source.city, p)
            else: await bootstrap(session, source.city)
            entity = (await load_catalog(session, source.city)).resolve(place_id=p.id)
            assert entity['entity_id'] != reserved and reserved not in entity['legacy_ids']
    run(check)


@pytest.mark.parametrize('error', [None, 'wrong_format', 'wrong_qualifier', 'separate_shop', 'wrong_address',
                                  'generic_alias', 'unquoted_alias', 'stale_note'])
def test_地址限定展示名须由紧随原名的地址行支持(error):
    async def check(factory):
        async with factory() as session:
            source, note, _, old, request = await seed(session)
            quote = '沐咖啡\n地址：端履门城市之心1层6号'
            note.desc = quote + '\n另一店\n地址：北街1号'
            await session.flush()
            rows = await load_mention_rows(session, source.city)
            e = request['newEntities'][0]
            e.update(canonicalName='沐咖啡（端履门城市之心）',
                     nameBasis={'baseName': '沐咖啡', 'locationQualifier': '端履门城市之心'},
                     overrides={'category': '美食', 'address': '端履门城市之心1层6号'},
                     evidence=[dict(mentionId=rows[0]['id'], inputHash=mention_fingerprint(rows[0]), quote=quote)])
            request['newEntities'] = [e]
            request['expectedRevisions'] = {old['entity_id']: old['revision'], e['entityId']: 0}
            request['assignments'] = [dict(mentionId=row['id'], inputHash=mention_fingerprint(row),
                entityId=e['entityId'] if index == 0 else None) for index, row in enumerate(rows)]
            if error == 'wrong_format': e['canonicalName'] = '沐咖啡端履门店'
            elif error == 'wrong_qualifier':
                e['nameBasis']['locationQualifier'] = '南街'; e['canonicalName'] = '沐咖啡（南街）'
            elif error == 'separate_shop':
                e['nameBasis']['locationQualifier'] = '北街'; e['canonicalName'] = '沐咖啡（北街）'
                e['evidence'][0]['quote'] = note.desc
            elif error == 'wrong_address': e['overrides']['address'] = '北街1号'
            elif error == 'generic_alias': e['aliases'] = ['沐咖啡']
            elif error == 'unquoted_alias': e['aliases'] = ['沐咖啡（钟楼店）']
            elif error == 'stale_note':
                note.desc = '原文已修改'; await session.flush()
            before = copy.deepcopy((await load_catalog(session, source.city)).entities)
            if error:
                with pytest.raises(ValueError): await apply_scope_decision(session, request)
                assert (await load_catalog(session, source.city)).entities == before
                assert not (await load_mention_catalog(session, source.city)).scopes
            else:
                await apply_scope_decision(session, request)
                entity = (await load_catalog(session, source.city)).entities[e['entityId']]
                assert entity['canonical_name'] == e['canonicalName']
                assert entity['evidence'][0]['nameBasis'] == e['nameBasis']
                assert entity['overrides']['address'] == '端履门城市之心1层6号'
                assert entity['overrides']['lat'] is None
                await rollback_decision(session, request['key'])
                assert (await load_catalog(session, source.city)).entities == before
    run(check)


@pytest.mark.parametrize('later_source', [False, True])
def test_新建后移空分店再倒序回滚保留原创建快照(later_source):
    from app.clean.scoped_place_export import withdrawn_place

    async def check(factory):
        async with factory() as session:
            source, _, rows, old, request = await seed(session)
            before = copy.deepcopy((await load_catalog(session, source.city)).entities)
            created = await apply_scope_decision(session, request)
            new_source = None
            if later_source:
                name = request['newEntities'][0]['canonicalName']
                new_source = CanonicalPlace(city=source.city, name=name, normalized_name=name)
                session.add(new_source); await session.flush()
                await register_place(session, source.city, new_source)
            next_request = copy.deepcopy(request)
            next_request.pop('newEntities')
            next_request.update(key=uuid4().hex, expectedScopeRevision=1,
                expectedRevisions={eid: e['revision'] for eid, e in (await load_catalog(session, source.city)).entities.items()})
            if later_source:
                next_request['sources'] = [dict(sourcePlaceId=p.id, sourceHash=source_fingerprint(source_input(p)))
                                           for p in [source, new_source]]
            next_request['assignments'][0]['entityId'] = None
            moved = await apply_scope_decision(session, next_request)
            assert 'createdEntityIds' not in moved and 'createdEntityReviews' not in moved
            catalog = await load_mention_catalog(session, source.city)
            ids = [e['entityId'] for e in request['newEntities']]
            entity_mentions = {ids[1]: [rows[1]]}
            withdrawn = withdrawn_place(catalog.catalog.entities[ids[0]], catalog, entity_mentions, {})
            assert withdrawn['payload']['identityWithdrawal']['candidateIds'] == []
            old_withdrawn = withdrawn_place(catalog.catalog.entities[old['entity_id']], catalog, entity_mentions, {})
            assert old_withdrawn['payload']['identityWithdrawal']['candidateIds'] == [ids[1]]
            with pytest.raises(ValueError, match='后续'): await rollback_decision(session, request['key'])
            await rollback_decision(session, next_request['key'])
            if later_source:
                # 注册真实来源本身是后续变更，回滚扩展scope也不能撤销该注册。
                with pytest.raises(ValueError, match='后续'): await rollback_decision(session, request['key'])
                return
            await rollback_decision(session, request['key'])
            assert (await load_catalog(session, source.city)).entities == before
            assert not (await load_mention_catalog(session, source.city)).scopes
    run(check)
