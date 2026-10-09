"""专用临时PostgreSQL验证逐提及分店分配、证据变化隔离、并发版本和可逆迁移。"""
from __future__ import annotations

import asyncio
import copy
import os

import pytest
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.aggregate.mention_identity import (apply_scope_decision, load_mention_catalog,
    load_mention_rows, refresh_mention_reviews, scope_snapshot)
from app.aggregate.place_identity import apply_decision, bootstrap, load_catalog, rollback_decision
from app.clean.mention_identity import mention_fingerprint, source_fingerprint
from app.models import (Base, CanonicalPlace, PlaceEntity, PlaceEntityChange, PlaceEntityReview,
    PlaceIdentityScope, PlaceMention, PlaceMentionAssignment, PlaceSummary, RawNote)


def run(callback):
    async def main():
        url = os.environ.get('IDENTITY_TEST_DATABASE_URL', '')
        if '127.0.0.1:18798/place_identity_test_' not in url:
            pytest.skip('只允许本次专用临时库，禁止应用库')
        engine = create_async_engine(url)
        try:
            async with engine.begin() as connection:
                await connection.run_sync(Base.metadata.create_all)
            await callback(async_sessionmaker(engine, expire_on_commit=False, autoflush=False))
        finally:
            await engine.dispose()
    asyncio.run(main())


async def seed(session, city='逐提及测试'):
    places = [CanonicalPlace(city=city, name=name, normalized_name=name)
        for name in ['老周家牛肉烧饼', '老周家牛肉烧饼（普利街店）', '老周家牛肉烧饼（洪楼店）']]
    note = RawNote(city=city, note_id=f'{city}-source', keyword='分店', title='两家门店',
                   desc='普利街店适合早餐，洪楼店适合午饭。', status='EXTRACTED')
    session.add_all([*places, note])
    await session.flush()
    await bootstrap(session, city)
    mentions = [PlaceMention(raw_note_id=note.id, name='老周家牛肉烧饼', normalized_name='老周家牛肉烧饼',
        reason=reason, evidence_text=reason, confidence=.95)
        for reason in ['普利街店早餐有牛肉烧饼', '洪楼店午饭可点烧饼']]
    session.add_all(mentions)
    await session.flush()
    return places, note, mentions


async def request(session, source, targets, *, key='scope-first', extra_mentions=()):
    catalog = await load_mention_catalog(session, source.city)
    rows = [row for row in await load_mention_rows(session, source.city)
            if row['normalized_name'] == source.normalized_name or row['id'] in extra_mentions]
    entity = catalog.catalog.resolve(place_id=source.id)
    affected = {entity['entity_id'], *[eid for eid in targets if eid is not None]}
    affected.update(a['entity_id'] for a in catalog.assignments.values()
                    if a['scope_place_id'] == source.id and a['entity_id'])
    affected.update(catalog.scopes.get(source.id, {}).get('entity_ids', []))
    assert len(rows) == len(targets)
    return dict(key=key, city=source.city, sourcePlaceId=source.id,
        expectedSourceHash=source_fingerprint({k: getattr(source, k) for k in ('id', 'city', 'name', 'normalized_name')}),
        expectedScopeRevision=catalog.scopes.get(source.id, {}).get('revision', 0),
        expectedRevisions={eid: catalog.catalog.entities[eid]['revision'] for eid in affected},
        assignments=[dict(mentionId=row['id'], inputHash=mention_fingerprint(row), entityId=target)
                     for row, target in zip(rows, targets)], evidence=[{'source': '已核实的原文分店与门牌'}])


async def branch_ids(session, places):
    catalog = await load_catalog(session, places[0].city)
    return [catalog.resolve(place_id=p.id)['entity_id'] for p in places[1:]]


def test_同一源的两条提及分配不同门店_保留原文和源成员_重跑幂等():
    async def check(factory):
        async with factory() as session:
            places, _, _ = await seed(session)
            city = places[0].city
            before_rows = await load_mention_rows(session, city)
            before_members = (await load_catalog(session, city)).members
            targets = await branch_ids(session, places)
            decision = await request(session, places[0], targets)
            after = await apply_scope_decision(session, decision)
            assert await apply_scope_decision(session, decision) == after
            current = await load_mention_catalog(session, city)
            assert [current.resolve(row)['entity']['entity_id'] for row in before_rows] == targets
            assert all(current.resolve(row)['reason'] == 'reviewed_assignment' for row in before_rows)
            assert await load_mention_rows(session, city) == before_rows, '治理不能改写原始名字、事实或笔记'
            assert current.catalog.members == before_members, '拆分提及不把整个泛名源交给任一家门店'
            assert set(targets).issubset(current.managed_entity_ids())
            assert await session.scalar(select(func.count()).select_from(PlaceMentionAssignment)
                .where(PlaceMentionAssignment.scope_place_id == places[0].id)) == 2
            with pytest.raises(ValueError, match='key'):
                await apply_scope_decision(session, {**decision, 'evidence': [{'source': '同key变更'}]})
    run(check)


def test_名称排除须先逐提及确认_有未分配提及时不能整条合并():
    async def check(factory):
        async with factory() as session:
            places, _, _ = await seed(session)
            city = places[0].city
            targets = await branch_ids(session, places)
            source_id = (await load_catalog(session, city)).resolve(place_id=places[0].id)['entity_id']
            async def correction():
                catalog = await load_catalog(session, city)
                return dict(key='unsafe-name-exclusion', city=city, entityId=targets[0], mergeEntityIds=[source_id],
                    excludeNames=[places[0].name], expectedRevisions={eid: catalog.entities[eid]['revision']
                        for eid in [source_id, targets[0]]}, evidence=[{'source': '错误的品牌等于任一分店推断'}])
            with pytest.raises(ValueError, match='原始来源范围'):
                await apply_decision(session, await correction())
            await apply_scope_decision(session, await request(session, places[0], [targets[0], None]))
            with pytest.raises(ValueError, match='未分配'):
                await apply_decision(session, await correction())
            await apply_scope_decision(session, await request(session, places[0], targets, key='assign-both-branches'))
            with pytest.raises(ValueError, match='其他实体'):
                await apply_decision(session, await correction())
            assert (await load_catalog(session, city)).root(source_id)['entity_id'] == source_id
    run(check)


def test_新提及与空目标待审_已有正确门店名称也不能绕过受控来源():
    async def check(factory):
        async with factory() as session:
            places, note, _ = await seed(session)
            city = places[0].city
            targets = await branch_ids(session, places)
            await apply_scope_decision(session, await request(session, places[0], [targets[0], None]))
            session.add(PlaceMention(raw_note_id=note.id, name=places[1].name,
                normalized_name=places[0].normalized_name, reason='新增同名记录，尚未核实地址'))
            await session.flush()
            for _ in range(2):
                await refresh_mention_reviews(session, city)
            current = await load_mention_catalog(session, city)
            results = [current.resolve(row) for row in await load_mention_rows(session, city)]
            assert [r['status'] for r in results] == ['resolved', 'review', 'review']
            assert results[1]['reason'] == 'unassigned_target'
            assert results[2]['reason'] == 'unreviewed_mention'
            reviews = (await session.scalars(select(PlaceEntityReview).where(PlaceEntityReview.city == city))).all()
            assert len(reviews) == 2 and all(r.status == 'PENDING' for r in reviews), '重跑不能重复入队'
            assert all(r.detail['reason'] == 'mention_scope' and 'entityIds' not in r.detail for r in reviews)
    run(check)


@pytest.mark.parametrize('change', ['omit', 'duplicate', 'source_hash', 'input_hash', 'city', 'revision', 'cross_city'])
def test_遗漏重复过期和跨城分配在写库前拒绝(change):
    async def check(factory):
        async with factory() as session:
            places, _, _ = await seed(session)
            targets = await branch_ids(session, places)
            decision = await request(session, places[0], targets)
            if change == 'omit':
                decision['assignments'].pop()
            elif change == 'duplicate':
                decision['assignments'] = [decision['assignments'][0]] * 2
            elif change == 'source_hash':
                decision['expectedSourceHash'] = '0' * 64
            elif change == 'input_hash':
                decision['assignments'][0]['inputHash'] = '0' * 64
            elif change == 'city':
                decision['city'] = '错误城市'
            elif change == 'revision':
                decision['expectedRevisions'][targets[0]] += 1
            else:
                decision['assignments'][0]['entityId'] = 'other-city-entity'
            before = copy.deepcopy((await load_catalog(session, places[0].city)).entities)
            with pytest.raises(ValueError):
                await apply_scope_decision(session, decision)
            assert await session.scalar(select(func.count()).select_from(PlaceIdentityScope)
                .where(PlaceIdentityScope.city == places[0].city)) == 0
            assert (await load_catalog(session, places[0].city)).entities == before
    run(check)


def test_回滚恢复原分配与待审_不删除原始证据_已回滚key不能重放():
    async def check(factory):
        async with factory() as session:
            places, _, _ = await seed(session)
            city = places[0].city
            original = await load_mention_rows(session, city)
            targets = await branch_ids(session, places)
            first = await request(session, places[0], [targets[0], None])
            first_after = await apply_scope_decision(session, first)
            second = await request(session, places[0], targets, key='scope-second')
            await apply_scope_decision(session, second)
            with pytest.raises(ValueError, match='后续'):
                await rollback_decision(session, first['key'])
            await rollback_decision(session, second['key'])
            restored = await scope_snapshot(session, city, places[0].id, first_after['scopes'][0]['name_keys'],
                                            [e['entity_id'] for e in first_after['entities']])
            assert restored == first_after
            await rollback_decision(session, first['key'])
            assert not (await load_mention_catalog(session, city)).scopes
            assert await session.scalar(select(func.count()).select_from(PlaceMentionAssignment)
                .where(PlaceMentionAssignment.scope_place_id == places[0].id)) == 0
            assert await session.scalar(select(func.count()).select_from(PlaceEntityReview)
                .where(PlaceEntityReview.city == city)) == 0
            assert await load_mention_rows(session, city) == original
            with pytest.raises(ValueError, match='key'):
                await apply_scope_decision(session, first)
    run(check)


@pytest.mark.parametrize('change', ['new_mention', 'reason', 'note_text', 'image_text', 'source_name', 'entity_revision',
                                  'profile', 'duration', 'summary', 'provenance'])
def test_治理后新增证据或修改原文实体时拒绝过期回滚(change):
    async def check(factory):
        async with factory() as session:
            places, note, mentions = await seed(session)
            targets = await branch_ids(session, places)
            decision = await request(session, places[0], targets)
            await apply_scope_decision(session, decision)
            if change == 'new_mention':
                session.add(PlaceMention(raw_note_id=note.id, name=places[0].name,
                    normalized_name=places[0].normalized_name, reason='后来新采集的门店'))
            elif change == 'reason':
                mentions[0].reason = '原提及事实已修订'
            elif change == 'note_text':
                note.desc = '原作者已更改正文中的分店'
            elif change == 'image_text':
                note.img_analysis = [{'image_index': 0, 'text_content': '新的门牌'}]
            elif change == 'source_name':
                places[0].name = '源地点后续更名'
            elif change == 'profile':
                places[1].content_profile = {'intro': '后续编辑的门店介绍'}
            elif change == 'duration':
                places[1].typical_visit_minutes = 45
            elif change == 'summary':
                session.add(PlaceSummary(canonical_place_id=places[1].id, mention_count_30d=1))
            elif change == 'provenance':
                from app.models import CanonicalPlaceSource
                session.add(CanonicalPlaceSource(canonical_place_id=places[1].id, source_type='xhs',
                    source_note_id=note.note_id, evidence_summary='后来新增的已核实来源'))
            else:
                await session.execute(update(PlaceEntity).where(PlaceEntity.entity_id == targets[0])
                    .values(revision=PlaceEntity.revision + 1))
            await session.flush()
            with pytest.raises(ValueError, match='后续'):
                await rollback_decision(session, decision['key'])
            current = await load_mention_catalog(session, places[0].city)
            results = [current.resolve(r) for r in await load_mention_rows(session, places[0].city)]
            if change in ('new_mention', 'reason', 'note_text', 'image_text', 'source_name'):
                assert any(r['status'] == 'review' for r in results), '变化不能继续沿用旧审核当作确定事实'
    run(check)


def test_完整介绍按实体绑定_提纯期间重新分配或原文变化不能写回(monkeypatch):
    from app.extract import place_profiles as profiles
    from app.clean.scoped_place_export import scoped_facts
    async def check(factory):
        city = '分店介绍绑定测试'
        monkeypatch.setattr(profiles, 'SessionFactory', factory)
        async with factory() as session:
            places, note, mentions = await seed(session, city)
            for p in places:
                p.geo_status = 'resolved'
            note.desc = '普利街店早餐有牛肉烧饼。洪楼店午饭可点烧饼。'
            note.source_url = 'https://example.test/two-branches'
            places[1].content_profile = {'profileVersion': 1, 'qualityVersion': 2, 'intro': '过期的品牌介绍。'}
            await session.flush()
            targets = await branch_ids(session, places)
            await apply_scope_decision(session, await request(session, places[0], targets, key='profile-scope'))
            source_id, second_mention_id = places[0].id, mentions[1].id
            await session.commit()
        selected, skipped, total = await profiles.select_places(city, [], 20)
        assert total == 2 and {r['identityBinding']['entityId'] for r in selected} == set(targets)
        assert all(r['id'] != source_id for r in selected), '泛名源不能生成带混合事实的介绍'
        for target in selected:
            sources = await profiles.load_sources(city, target['name'])
            assert len(sources) == 1
            assert ('普利街' in sources[0]['text']) == ('普利街' in target['name'])
        first = next(r for r in selected if r['identityBinding']['entityId'] == targets[0])
        after = {'profileVersion': 1, 'qualityVersion': 2, 'intro': '普利街门店的独立介绍。',
                 'highlights': [], 'identityBinding': first['identityBinding']}
        assert await profiles.save_profile(city, {**first, 'after': after})
        async with factory() as session:
            catalog = await load_mention_catalog(session, city)
            rows = [r for r in await load_mention_rows(session, city)
                    if catalog.resolve(r).get('entity', {}).get('entity_id') == targets[0]]
            facts, _ = scoped_facts(catalog.catalog.root(targets[0]), rows, '2026-10-07', [], after)
            assert facts['content']['intro'] == after['intro']
            source = await session.get(CanonicalPlace, source_id)
            await apply_scope_decision(session, await request(session, source, targets[::-1], key='profile-reassigned'))
            await session.commit()
        assert not await profiles.save_profile(city, {**first, 'before': after, 'after': after})
        selected, _, _ = await profiles.select_places(city, [], 20)
        second = next(r for r in selected if r['identityBinding']['entityId'] == targets[1])
        async with factory() as session:
            (await session.get(PlaceMention, second_mention_id)).reason = '原文提及事实后来修订'
            await session.commit()
        # 笔记/提及变化后只拒绝受影响实体；选中持有该提及的新目标。
        first = next(r for r in selected if r['identityBinding']['entityId'] == targets[0])
        assert not await profiles.save_profile(city, {**first, 'after': {**after, 'identityBinding': first['identityBinding']}})
        assert await profiles.save_profile(city, {**second, 'after': {**after, 'identityBinding': second['identityBinding']}})
    run(check)


def test_逐提及CLI默认预演_正式应用幂等且拒绝跨城(monkeypatch, tmp_path):
    import json
    import sys
    from scripts import govern_place_identity as cli
    async def check(factory):
        city = '提及CLI测试'
        monkeypatch.setattr(cli, 'SessionFactory', factory)
        async with factory() as session:
            places, _, _ = await seed(session, city)
            decision = await request(session, places[0], await branch_ids(session, places), key='cli-scope')
            await session.commit()
        input_path, report_path = tmp_path / 'decisions.json', tmp_path / 'report.json'
        input_path.write_text(json.dumps([decision], ensure_ascii=False), encoding='utf-8')
        args = ['govern_place_identity.py', '--city', city, '--scope-decisions', str(input_path), '--out', str(report_path)]
        monkeypatch.setattr(sys, 'argv', args)
        await cli.main()
        preview = json.loads(report_path.read_text(encoding='utf-8'))
        assert preview['apply'] is False and len(preview['changes']) == 1
        async with factory() as session:
            assert not (await load_mention_catalog(session, city)).scopes
        monkeypatch.setattr(sys, 'argv', [*args, '--apply'])
        await cli.main()
        await cli.main()
        async with factory() as session:
            assert len((await load_mention_catalog(session, city)).assignments) == 2
        decision['city'] = '别的城市'
        input_path.write_text(json.dumps([decision], ensure_ascii=False), encoding='utf-8')
        with pytest.raises(ValueError, match='城市超出'):
            await cli.main()
    run(check)


def test_已分配提及改名后保持待审_重新审核可恢复归属():
    async def check(factory):
        async with factory() as session:
            places, _, mentions = await seed(session)
            city = places[0].city
            targets = await branch_ids(session, places)
            await apply_scope_decision(session, await request(session, places[0], targets))
            mentions[0].name = mentions[0].normalized_name = '原文后来明确另一门店'
            await session.flush()
            current = await load_mention_catalog(session, city)
            rows = await load_mention_rows(session, city)
            assert current.resolve(rows[0])['reason'] == 'changed_input'
            new_decision = await request(session, places[0], [targets[1], targets[1]], key='recheck-new-name',
                                         extra_mentions=[mentions[0].id])
            await apply_scope_decision(session, new_decision)
            refreshed = await load_mention_catalog(session, city)
            assert refreshed.resolve(rows[0])['entity']['entity_id'] == targets[1]
            assert len(refreshed.assignments) == 2, '名称变化不能让旧提及从完整审核集合消失'
    run(check)


def test_来源URL与点赞变化不影响身份审核_隐藏笔记不再供给事实():
    async def check(factory):
        async with factory() as session:
            places, note, _ = await seed(session)
            city = places[0].city
            targets = await branch_ids(session, places)
            await apply_scope_decision(session, await request(session, places[0], targets))
            note.source_url = 'https://example.test/note?access=rotated'
            note.liked_count = 999
            await session.flush()
            catalog = await load_mention_catalog(session, city)
            assert all(catalog.resolve(r)['status'] == 'resolved' for r in await load_mention_rows(session, city))
            note.status = 'PRIVATE'
            await session.flush()
            assert all(catalog.resolve(r)['status'] == 'unresolved' for r in await load_mention_rows(session, city))
    run(check)


def test_新增提及表迁移默认预览_重复迁移保留旧身份():
    from scripts.migrate_place_identity import migrate
    async def check(factory):
        async with factory() as session:
            places, _, _ = await seed(session)
            before = (await load_catalog(session, places[0].city)).entities
            connection = await session.connection()
            await connection.run_sync(lambda conn: PlaceMentionAssignment.__table__.drop(conn))
            await connection.run_sync(lambda conn: PlaceIdentityScope.__table__.drop(conn))
            preview = await migrate(connection, False)
            assert set(preview['missing']) == {'place_identity_scope', 'place_mention_assignment'}
            assert not set(preview['missing']) & set(preview['present'])
            applied = await migrate(connection, True)
            assert set(applied['missing']).issubset(applied['present'])
            assert not (await migrate(connection, True))['missing']
            assert (await load_catalog(session, places[0].city)).entities == before
    run(check)


def test_增量同步与质量汇总按分配隔离两店_新提及不污染缓存(monkeypatch):
    from app.aggregate import grade, summary
    async def check(factory):
        monkeypatch.setattr(summary, 'SessionFactory', factory)
        monkeypatch.setattr(grade, 'SessionFactory', factory)
        async def no_map(*args):
            raise AssertionError('本例已有坐标，不应请求地图')
        monkeypatch.setattr(summary, 'resolve_coordinates', no_map)
        async with factory() as session:
            places, note, mentions = await seed(session, '分店聚合测试')
            city = places[0].city
            for place in places:
                place.geo_status, place.latitude, place.longitude = 'resolved', 36.6, 117.0
            mentions[0].fact_type, mentions[0].fact_value = 'visit_duration', {'minutes': 30}
            mentions[1].fact_type, mentions[1].fact_value = 'visit_duration', {'minutes': 60}
            await session.flush()
            targets = await branch_ids(session, places)
            await apply_scope_decision(session, await request(session, places[0], targets, key='aggregate-scoped'))
            session.add(PlaceMention(raw_note_id=note.id, name=places[0].name,
                normalized_name=places[0].normalized_name, reason='新店排队三小时不能带给旧分店',
                fact_type='visit_duration', fact_value={'minutes': 180}, confidence=.99))
            source_ids = [p.id for p in places]
            await session.commit()
        assert (await summary.sync_canonical(city))['created'] == 0
        await summary.refresh_summary(city)
        await grade.grade_canonical(city)
        async with factory() as session:
            actual = [(await session.get(CanonicalPlace, pid)) for pid in source_ids]
            assert [p.typical_visit_minutes for p in actual] == [None, 30, 60]
            assert [p.is_active for p in actual] == [False, True, True]
            summaries = {p.canonical_place_id: p for p in (await session.scalars(select(PlaceSummary)
                .where(PlaceSummary.canonical_place_id.in_(source_ids)))).all()}
            assert [summaries[pid].mention_count_30d for pid in source_ids] == [0, 1, 1]
            assert summaries[source_ids[1]].top_reasons[0]['reason'] == '普利街店早餐有牛肉烧饼'
            assert summaries[source_ids[2]].top_reasons[0]['reason'] == '洪楼店午饭可点烧饼'
            assert actual[1].quality_score == actual[2].quality_score == 14.5
            assert len((await session.scalars(select(PlaceEntityReview).where(
                PlaceEntityReview.city == city, PlaceEntityReview.status == 'PENDING'))).all()) == 1
        # 再刷新不把待审提及变成新源，不改变已分开的分店时长/热度。
        assert (await summary.sync_canonical(city))['created'] == 0
        await summary.refresh_summary(city)
        await grade.grade_canonical(city)
        async with factory() as session:
            assert await session.scalar(select(func.count()).select_from(CanonicalPlace).where(CanonicalPlace.city == city)) == 3
            assert [(await session.get(CanonicalPlace, pid)).typical_visit_minutes for pid in source_ids] == [None, 30, 60]
    run(check)


def test_错抽取合并保留旧ID但不保留错误同义词_导出隔离新提及和旧缓存(monkeypatch, tmp_path):
    import json
    import sys
    from scripts import export_to_tripweaver as exporter
    from app.aggregate import summary
    async def check(factory):
        city = '公交机位纠错测试'
        monkeypatch.setattr(exporter, 'SessionFactory', factory)
        monkeypatch.setattr(summary, 'SessionFactory', factory)
        async with factory() as session:
            stop = CanonicalPlace(city=city, name='呼归石公交站', normalized_name='呼归石公交站', geo_status='resolved')
            spot = CanonicalPlace(city=city, name='呼归石公交站对面', normalized_name='呼归石公交站对面', geo_status='resolved',
                typical_visit_minutes=180, typical_visit_source='xhs_median', content_profile={
                    'profileVersion': 1, 'qualityVersion': 2, 'intro': '错误缓存介绍公交运营情况。',
                    'highlights': [{'text': '不应沿用的旧介绍', 'sourceUrl': 'https://example.test/old'}]})
            note = RawNote(city=city, note_id='bus-viewpoint', keyword='机位', title='南滨路拍照',
                desc='呼归石公交站对面可拍江景，沿江栏杆有宽阔视野。', source_url='https://example.test/spot')
            session.add_all([stop, spot, note])
            await session.flush()
            await bootstrap(session, city)
            mentions = [PlaceMention(raw_note_id=note.id, name=name, normalized_name=name,
                reason='沿江栏杆可拍开阔的南滨路江景', evidence_text=note.desc, confidence=.95)
                for name in [stop.name, stop.name, spot.name]]
            session.add_all(mentions)
            session.add(PlaceSummary(canonical_place_id=spot.id, mention_count_30d=99,
                recommend_score=500, top_reasons=[{'reason': '旧缓存里公交站运营时间全天'}]))
            await session.flush()
            catalog = await load_catalog(session, city)
            old_id, target_id = [catalog.resolve(place_id=p.id)['entity_id'] for p in [stop, spot]]
            scope = await request(session, stop, [target_id, target_id], key='scope-bus-viewpoint')
            await apply_scope_decision(session, scope)
            catalog = await load_catalog(session, city)
            correction = dict(key='correct-bus-viewpoint', city=city, entityId=target_id, mergeEntityIds=[old_id],
                excludeNames=[stop.name], expectedRevisions={eid: catalog.entities[eid]['revision'] for eid in [old_id, target_id]},
                overrides={'lat': None, 'lng': None, 'geoStatus': 'unresolvable'}, evidence=[{'source': '同篇原文都指站对面机位'}])
            await apply_decision(session, correction)
            # 后来的真实公交站笔记、全城图片时刻表均不能继承机位归属。
            later = RawNote(city=city, note_id='bus-later', keyword='交通', title='公交乘车',
                desc='呼归石公交站每天06:00-22:00运营，去市区可乘公交。', source_url='https://example.test/bus',
                img_analysis=[{'has_text': True, 'text_content': '呼归石公交站每天06:00-22:00',
                               'key_info': {'hours': '呼归石公交站每天06:00-22:00', 'price': '呼归石公交站票价2元'}}])
            session.add(later)
            await session.flush()
            session.add(PlaceMention(raw_note_id=later.id, name=stop.name, normalized_name=stop.normalized_name,
                reason=later.desc, evidence_text=later.desc, confidence=.99))
            await session.flush()
            await refresh_mention_reviews(session, city)
            current = await load_catalog(session, city)
            assert current.resolve(stop.name) is None
            assert current.resolve(spot.name)['entity_id'] == target_id
            assert current.root(old_id)['entity_id'] == target_id
            assert old_id in current.root(target_id)['legacy_ids']
            # 普通字段修订和再次添加旧别名都不能把已排除名称悄悄恢复。
            await apply_decision(session, dict(key='bus-viewpoint-field-update', city=city, entityId=target_id,
                expectedRevisions={target_id: current.root(target_id)['revision']}, aliases=[stop.name],
                overrides={'category': '文化'}, evidence=[{'source': '保持摄影机位类别'}]))
            assert (await load_catalog(session, city)).resolve(stop.name) is None
            await session.commit()
        out = tmp_path / 'scoped-bus-export.json'
        monkeypatch.setattr(sys, 'argv', ['export_to_tripweaver.py', '--city', city, '--out', str(out)])
        await exporter.main()
        data = json.loads(out.read_text(encoding='utf-8'))
        assert len(data['places']) == 1
        place = data['places'][0]
        assert place['id'] == target_id and place['name'] == '呼归石公交站对面'
        payload = place['payload']
        assert '呼归石公交站' not in payload['identity']['memberNames'] and '呼归石公交站' not in payload['aliases']
        assert old_id in payload['identity']['memberIds']
        assert payload['mentionCount'] == 3 and len(payload['mentionSources']) == 3
        assert 'typicalVisitMinutes' not in payload and 'price' not in payload
        assert payload['openHours']['status'] == 'unknown'
        assert 'identityExcludedNames' not in payload
        exported = json.dumps(place, ensure_ascii=False)
        assert '错误缓存' not in exported and '公交运营' not in exported and '06:00' not in exported
        assert place['lat'] is None and place['lng'] is None
    run(check)


def test_两店实际导出时段时长隔离_移空旧目标后不能恢复缓存(monkeypatch, tmp_path):
    import json
    import sys
    from scripts import export_to_tripweaver as exporter
    async def check(factory):
        city = '分店导出隔离测试'
        monkeypatch.setattr(exporter, 'SessionFactory', factory)
        async with factory() as session:
            places, _, mentions = await seed(session, city)
            for p in places:
                p.geo_status = 'resolved'
                p.theme_tags = ['自然风光']
                p.typical_visit_minutes = 180
                p.content_profile = {'profileVersion': 1, 'qualityVersion': 2, 'intro': '不属于任何具体分店的旧品牌介绍'}
                session.add(PlaceSummary(canonical_place_id=p.id, mention_count_30d=99, recommend_score=500))
            for p, mention, hour, minutes in zip(places[1:], mentions, ['08:00-17:00', '11:00-22:00'], [30, 60]):
                mention.reason = mention.evidence_text = f'{p.name}开放时间{hour}，有牛肉烧饼。'
                mention.fact_type, mention.fact_value = 'visit_duration', {'minutes': minutes}
            await session.flush()
            targets = await branch_ids(session, places)
            await apply_scope_decision(session, await request(session, places[0], targets, key='split-export-first'))
            source_id = places[0].id
            await session.commit()
        output = tmp_path / 'split.json'
        monkeypatch.setattr(sys, 'argv', ['export_to_tripweaver.py', '--city', city, '--out', str(output)])
        await exporter.main()
        exported = json.loads(output.read_text(encoding='utf-8'))['places']
        active = [p for p in exported if p['verified']]
        withdrawn = [p for p in exported if not p['verified']]
        assert {p['id'] for p in active} == set(targets)
        assert len(withdrawn) == 1 and set(withdrawn[0]['payload']['identityWithdrawal']['candidateIds']) == set(targets)
        assert withdrawn[0]['payload']['imageIdentity']['approved'] == []
        by_id = {p['id']: p['payload'] for p in exported}
        for target, hour, minutes in zip(targets, ['08:00', '11:00'], [30, 60]):
            payload = by_id[target]
            assert payload['typicalVisitMinutes'] == minutes
            assert payload['openHours']['openTime'] == hour
            assert payload['mentionCount'] == 1 and len(payload['mentionSources']) == 1
            assert payload['themes'] == [] and '旧品牌介绍' not in json.dumps(payload, ensure_ascii=False)
        async with factory() as session:
            source = await session.get(CanonicalPlace, source_id)
            await apply_scope_decision(session, await request(session, source, [targets[1], targets[1]], key='split-export-moved'))
            assert targets[0] in (await load_mention_catalog(session, city)).managed_entity_ids()
            # 再次分配也必须包含已移空旧目标的版本；不能让治理范围随后丢失它。
            await apply_scope_decision(session, await request(session, source, [targets[1], targets[1]], key='split-export-again'))
            assert targets[0] in (await load_mention_catalog(session, city)).managed_entity_ids()
            await session.commit()
        await exporter.main()
        exported = json.loads(output.read_text(encoding='utf-8'))['places']
        assert [p['id'] for p in exported if p['verified']] == [targets[1]]
        assert len([p for p in exported if not p['verified']]) == 2
        by_id = {p['id']: p for p in exported}
        assert by_id[targets[0]]['payload']['identityWithdrawal']['candidateIds'] == [], '移空分店没有自有scope，不能成为另一家别名'
        source_entity = next(p for p in exported if p['id'] not in targets)
        assert source_entity['payload']['identityWithdrawal']['candidateIds'] == [targets[1]]
        async with factory() as session:
            note = (await session.execute(select(RawNote).where(RawNote.city == city))).scalar_one()
            note.status = 'PRIVATE'
            await session.commit()
        await exporter.main()
        hidden = json.loads(output.read_text(encoding='utf-8'))
        assert hidden['activeCount'] == 0 and len(hidden['places']) == 3
        for place in hidden['places']:
            assert not place['verified'] and place['evidence'] == []
            assert place['payload']['identityWithdrawal']['candidateIds'] == []
            assert place['payload']['identityWithdrawal']['reason'] == 'unavailable_source'
            assert place['payload']['imageIdentity']['approved'] == []
        async with factory() as session:
            note = (await session.execute(select(RawNote).where(RawNote.city == city))).scalar_one()
            note.status = 'EXTRACTED'
            for mention in (await session.execute(select(PlaceMention).where(PlaceMention.raw_note_id == note.id))).scalars():
                mention.evidence_text = '原证据已修改，必须重新审核'
            await session.commit()
        await exporter.main()
        assert json.loads(output.read_text(encoding='utf-8'))['activeCount'] == 0
    run(check)


def test_旧增强脚本不污染受控实体_同城外的同名保持独立(monkeypatch):
    import sys
    from scripts import build_visit_duration as duration, build_tag_topics as tags, apply_aliases, repair_place_aliases
    async def check(factory):
        city = '增强范围测试'
        for module in [duration, tags, apply_aliases, repair_place_aliases]:
            monkeypatch.setattr(module, 'SessionFactory', factory)
        async with factory() as session:
            places, note, _ = await seed(session, city)
            note.desc = '老周家牛肉烧饼建议游玩3小时。'
            note.raw_json = {'tag_list': [{'name': '自然森林'}]}
            targets = await branch_ids(session, places)
            await session.flush()
            await apply_scope_decision(session, await request(session, places[0], targets, key='enhance-scope'))
            ids = [p.id for p in places]
            other = CanonicalPlace(city='增强其他城', name=places[0].name, normalized_name=places[0].name,
                typical_visit_minutes=45, theme_tags=['历史人文'])
            session.add(other)
            await session.commit()
            other_id = other.id
        await duration.build_city(city)
        await tags.build_city(city)
        async with factory() as session:
            actual = [(await session.get(CanonicalPlace, pid)) for pid in ids]
            assert all(p.typical_visit_minutes is None and not p.theme_tags for p in actual)
            other = await session.get(CanonicalPlace, other_id)
            assert other.typical_visit_minutes == 45 and other.theme_tags == ['历史人文']
        monkeypatch.setitem(apply_aliases._ALIAS_MAP, city, {'老周家牛肉烧饼': '错误合并目标'})
        monkeypatch.setattr(sys, 'argv', ['apply_aliases.py', '--city', city])
        with pytest.raises(ValueError, match='稳定身份'):
            await apply_aliases.main()
        monkeypatch.setattr(sys, 'argv', ['repair_place_aliases.py', '--city', city, '--apply', '--out', 'unused.json'])
        with pytest.raises(ValueError, match='稳定身份'):
            await repair_place_aliases.main()
    run(check)


def test_离线介绍报告不能绕过身份绑定或恢复混合缓存(monkeypatch, tmp_path):
    import json
    import sys
    from scripts import refine_place_content as report_cli
    from app.extract import place_profiles as profiles
    async def check(factory):
        city = '离线介绍报告测试'
        monkeypatch.setattr(report_cli, 'SessionFactory', factory)
        monkeypatch.setattr(profiles, 'SessionFactory', factory)
        async with factory() as session:
            places, _, _ = await seed(session, city)
            for p in places:
                p.geo_status = 'resolved'
            targets = await branch_ids(session, places)
            await apply_scope_decision(session, await request(session, places[0], targets, key='report-scope'))
            await session.commit()
        selected, _, _ = await profiles.select_places(city, [], 2)
        item = selected[0]
        after = {'profileVersion': 1, 'qualityVersion': 2, 'intro': '这家门店经营牛肉烧饼，店面临近当地街道。',
                 'highlights': [], 'identityBinding': item['identityBinding']}
        source = tmp_path / 'input.json'
        source.write_text(json.dumps({'city': city, 'updates': [{**item, 'after': after}]}), encoding='utf-8')
        output = tmp_path / 'applied.json'
        monkeypatch.setattr(sys, 'argv', ['refine_place_content.py', '--city', city,
            '--apply-report', str(source), '--out', str(output)])
        await report_cli.main()
        assert json.loads(output.read_text(encoding='utf-8'))['updates'][0]['identityBinding'] == item['identityBinding']
        # 恢复当前绑定内的空值允许；旧混合profile即使before/after匹配也不允许。
        old_report = {'city': city, 'updates': [{**item, 'before': {'intro': '混合品牌旧缓存'}, 'after': after}]}
        source.write_text(json.dumps(old_report), encoding='utf-8')
        monkeypatch.setattr(sys, 'argv', ['refine_place_content.py', '--city', city,
            '--restore-report', str(source), '--out', str(tmp_path / 'rejected.json')])
        with pytest.raises(RuntimeError, match='证据绑定'):
            await report_cli.main()
        old_report['updates'][0]['before'] = None
        source.write_text(json.dumps(old_report), encoding='utf-8')
        await report_cli.main()
        async with factory() as session:
            assert (await session.get(CanonicalPlace, item['id'])).content_profile is None
    run(check)


def test_问答与同游挖掘不借旧泛名事实_旧关系清理阻止过期回滚(monkeypatch):
    import sys
    from app.qa import ask
    from scripts import mine_place_relations as relations
    from app.models import PlaceRelation
    async def check(factory):
        city = '问答关系范围测试'
        monkeypatch.setattr(ask, 'SessionFactory', factory)
        monkeypatch.setattr(relations, 'SessionFactory', factory)
        async with factory() as session:
            places, note, _ = await seed(session, city)
            note.desc = '老周家牛肉烧饼 → 泉城广场'
            note.img_analysis = [{'has_text': True, 'key_info': {'price': '老周家牛肉烧饼（普利街店）200元'}}]
            note.source_url = 'https://example.test/branch'
            for p in places:
                p.geo_status = 'resolved'
                session.add(PlaceSummary(canonical_place_id=p.id, mention_count_30d=99,
                    recommend_score=999, top_reasons=[{'reason': '错误的品牌缓存理由'}]))
            session.add(PlaceRelation(city=city, from_name=places[0].name, to_name='泉城广场',
                rel_type='combo', strength='direct', note_count=9, evidence='旧泛名推断的同游'))
            await session.flush()
            targets = await branch_ids(session, places)
            decision = await request(session, places[0], targets, key='qa-relations-scope')
            await apply_scope_decision(session, decision)
            await session.commit()
        candidates = await ask.retrieve(city, {})
        assert len(candidates) == 2
        for candidate in candidates:
            assert candidate.mention_count == 1 and not candidate.image_info
            assert candidate.source_url == 'https://example.test/branch'
            assert '错误的品牌缓存' not in str(candidate.reasons)
            assert ('早餐' in str(candidate.reasons)) == ('普利街' in candidate.name)
        monkeypatch.setattr(sys, 'argv', ['mine_place_relations.py', '--city', city])
        await relations.main()
        async with factory() as session:
            assert await session.scalar(select(func.count()).select_from(PlaceRelation).where(PlaceRelation.city == city)) == 0
            with pytest.raises(ValueError, match='后续'):
                await rollback_decision(session, decision['key'])
    run(check)
