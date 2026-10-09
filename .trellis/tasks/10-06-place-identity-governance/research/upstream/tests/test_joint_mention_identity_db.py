"""联合来源必须整体分配、撤回和回滚，不能遗漏大小写旧主体。"""
import copy
import json
import sys

import pytest

from app.aggregate.mention_identity import apply_scope_decision, load_mention_catalog, load_mention_rows, scope_snapshot
from app.aggregate.place_identity import bootstrap, load_catalog, rollback_decision
from app.clean.mention_identity import mention_fingerprint, source_fingerprint
from app.clean.scoped_place_export import withdrawn_place
from app.models import CanonicalPlace, NoteImage, PlaceIdentityScopeSource, PlaceMention, PlaceSummary, RawNote
from test_mention_identity_db import run


async def seed_joint(session, *, city='联合来源测试', second=True):
    names = ['CUIDA', *(['cuida'] if second else []), 'CUIDA（一店）', 'CUIDA（二店）']
    places = [CanonicalPlace(city=city, name=name, normalized_name=name, geo_status='resolved',
        content_profile={'profileVersion': 1, 'qualityVersion': 2, 'intro': '不应导出的混合旧品牌缓存'},
        typical_visit_minutes=180) for name in names]
    note = RawNote(city=city, note_id=f'{city}-note', keyword='饮品', title='明确两店',
        desc='第一条在一店，第二条在二店', source_url='https://example.test/two-shops', status='EXTRACTED')
    session.add_all([*places, note])
    await session.flush()
    await bootstrap(session, city)
    for p in places:
        session.add(PlaceSummary(canonical_place_id=p.id, mention_count_30d=99, recommend_score=999))
    session.add_all([PlaceMention(raw_note_id=note.id, name=name, normalized_name=name,
        reason=f'{branch}适合喝茶休息', evidence_text=f'原文明确{branch}', confidence=.95,
        fact_type='visit_duration', fact_value={'minutes': duration})
        for name, branch, duration in [('CUIDA', '一店', 30), ('cuida' if second else 'CUIDA', '二店', 60)]])
    await session.flush()
    return places[:-2], places[-2:], note


async def request_joint(session, sources, targets, *, key='joint-first', joint=True):
    catalog = await load_mention_catalog(session, sources[0].city, allow_source_conflicts=True)
    rows = await load_mention_rows(session, sources[0].city)
    assert len(rows) == len(targets)
    old = catalog.scopes.get(sources[0].id)
    ids = {catalog.catalog.resolve(place_id=p.id)['entity_id'] for p in sources}
    ids.update(eid for eid in targets if eid)
    ids.update(old['entity_ids'] if old else [])
    fingerprint = lambda p: source_fingerprint({k: getattr(p, k) for k in ('id', 'city', 'name', 'normalized_name')})
    result = dict(key=key, city=sources[0].city, sourcePlaceId=sources[0].id,
        expectedSourceHash=fingerprint(sources[0]), expectedScopeRevision=old['revision'] if old else 0,
        expectedRevisions={eid: catalog.catalog.entities[eid]['revision'] for eid in ids},
        assignments=[dict(mentionId=row['id'], inputHash=mention_fingerprint(row), entityId=target)
                     for row, target in zip(rows, targets)], evidence=[{'source': '合成原文逐条确认两家分店'}])
    if joint:
        result['sources'] = [dict(sourcePlaceId=p.id, sourceHash=fingerprint(p)) for p in sources]
    return result


async def entity_ids(session, places):
    catalog = await load_catalog(session, places[0].city)
    return [catalog.resolve(place_id=p.id)['entity_id'] for p in places]


def test_联合两旧源整体治理_两旧ID共享候选但不归并_幂等及倒序回滚():
    async def check(factory):
        async with factory() as session:
            sources, branches, _ = await seed_joint(session)
            targets = await entity_ids(session, branches)
            old_ids = await entity_ids(session, sources)
            before = copy.deepcopy((await load_catalog(session, sources[0].city)).entities)
            originals = await load_mention_rows(session, sources[0].city)
            first = await request_joint(session, sources, targets)
            after = await apply_scope_decision(session, first)
            assert after == await apply_scope_decision(session, first)
            current = await load_mention_catalog(session, sources[0].city)
            assert current.managed_entity_ids() == set([*targets, *old_ids])
            assert all(current.scope_for_source(p.id)['place_id'] == sources[0].id for p in sources)
            assert [current.resolve(row)['entity']['entity_id'] for row in originals] == targets
            for eid in old_ids:
                withdrawal = withdrawn_place(current.catalog.entities[eid], current,
                    {target: [row] for target, row in zip(targets, originals)}, {})
                assert withdrawal['payload']['identityWithdrawal']['candidateIds'] == sorted(targets)
                assert not withdrawal['verified']
                assert current.catalog.root(eid)['entity_id'] == eid
            second = await request_joint(session, sources, [None, None], key='joint-empty')
            await apply_scope_decision(session, second)
            current = await load_mention_catalog(session, sources[0].city)
            assert current.managed_entity_ids() == set([*targets, *old_ids]), '旧目标不能脱离治理'
            assert all(current.resolve(row)['status'] == 'review' for row in originals)
            with pytest.raises(ValueError, match='后续'):
                await rollback_decision(session, first['key'])
            await rollback_decision(session, second['key'])
            await rollback_decision(session, first['key'])
            assert (await load_catalog(session, sources[0].city)).entities == before
            assert not (await load_mention_catalog(session, sources[0].city)).scopes
            assert await load_mention_rows(session, sources[0].city) == originals
    run(check)


@pytest.mark.parametrize('change', ['omit_source', 'duplicate_source', 'source_hash', 'missing_anchor',
    'missing_revision', 'omit_mention', 'wrong_city', 'unregistered'])
def test_联合请求遗漏与过期在写库前拒绝(change):
    async def check(factory):
        async with factory() as session:
            sources, branches, _ = await seed_joint(session)
            targets = await entity_ids(session, branches)
            decision = await request_joint(session, sources, targets)
            if change == 'omit_source':
                decision['sources'].pop()
            elif change == 'duplicate_source':
                decision['sources'].append(decision['sources'][0])
            elif change == 'source_hash':
                decision['sources'][1]['sourceHash'] = 'a' * 64
            elif change == 'missing_anchor':
                decision['sources'].pop(0)
            elif change == 'missing_revision':
                decision['expectedRevisions'].pop((await entity_ids(session, sources))[1])
            elif change == 'omit_mention':
                decision['assignments'].pop()
            elif change == 'wrong_city':
                sources[1].city = '其他城市'
                await session.flush()
            else:
                other = CanonicalPlace(city=sources[0].city, name='ＣＵＩＤＡ', normalized_name='ＣＵＩＤＡ')
                session.add(other)
                await session.flush()
                decision['sources'].append({'sourcePlaceId': other.id,
                    'sourceHash': source_fingerprint({k: getattr(other, k) for k in ('id', 'city', 'name', 'normalized_name')})})
            before = copy.deepcopy((await load_catalog(session, sources[0].city)).entities)
            with pytest.raises(ValueError):
                await apply_scope_decision(session, decision)
            assert not (await load_mention_catalog(session, sources[0].city)).scopes
            assert (await load_catalog(session, sources[0].city)).entities == before
    run(check)


def test_成员变化整组待审_新同名来源阻止消费和回滚_完整扩展可修复():
    async def check(factory):
        async with factory() as session:
            sources, branches, _ = await seed_joint(session)
            targets = await entity_ids(session, branches)
            first = await request_joint(session, sources, targets)
            await apply_scope_decision(session, first)
            sources[1].name = '后来修改的源名'
            await session.flush()
            current = await load_mention_catalog(session, sources[0].city)
            assert all(current.resolve(row)['reason'] == 'changed_source' for row in await load_mention_rows(session, sources[0].city))
            with pytest.raises(ValueError, match='后续'):
                await rollback_decision(session, first['key'])
            sources[1].name = 'cuida'
            new_source = CanonicalPlace(city=sources[0].city, name='ＣＵＩＤＡ', normalized_name='ＣＵＩＤＡ')
            session.add(new_source)
            await session.flush()
            with pytest.raises(ValueError, match='来源集合已变化'):
                await load_mention_catalog(session, sources[0].city)
            with pytest.raises(ValueError, match='后续'):
                await rollback_decision(session, first['key'])
            # 此合成新源显式注册独立主体；不把新增源悄悄加入既有成员。
            from app.aggregate.place_identity import register_place
            registered = await register_place(session, sources[0].city, new_source)
            assert registered['status'] == 'REVIEW'
            expanded = await request_joint(session, [*sources, new_source], targets, key='joint-expanded')
            await apply_scope_decision(session, expanded)
            current = await load_mention_catalog(session, sources[0].city)
            assert current.scope_for_source(new_source.id)
            assert current.catalog.entities[registered['entity_id']]['status'] == 'REVIEW', '收纳旧源不等于确认分店身份'
            invalid = await request_joint(session, [*sources, new_source], [registered['entity_id'], targets[1]], key='assign-review-target')
            with pytest.raises(ValueError, match='有效现行实体'):
                await apply_scope_decision(session, invalid)
            with pytest.raises(ValueError, match='完整列出'):
                await apply_scope_decision(session, await request_joint(session, [*sources, new_source], targets, key='joint-downgrade', joint=False))
            with pytest.raises(ValueError, match='历史成员'):
                await apply_scope_decision(session, await request_joint(session, sources, targets, key='joint-shrink'))
    run(check)


def test_单源升级联合范围_回滚后旧单源审计保持兼容():
    async def check(factory):
        async with factory() as session:
            sources, branches, _ = await seed_joint(session, second=False)
            targets = await entity_ids(session, branches)
            first = await request_joint(session, sources, targets, joint=False)
            original_after = await apply_scope_decision(session, first)
            assert 'scopeSources' not in original_after
            second = await request_joint(session, sources, targets, key='upgrade-one-source')
            await apply_scope_decision(session, second)
            with pytest.raises(ValueError, match='后续'):
                await rollback_decision(session, first['key'])
            await rollback_decision(session, second['key'])
            await rollback_decision(session, first['key'])
            assert not (await load_mention_catalog(session, sources[0].city)).scopes
    run(check)


def test_联合范围成员不能另建scope或被另一范围抢占():
    async def check(factory):
        async with factory() as session:
            sources, branches, _ = await seed_joint(session)
            targets = await entity_ids(session, branches)
            await apply_scope_decision(session, await request_joint(session, sources, targets))
            decision = await request_joint(session, list(reversed(sources)), targets, key='steal-anchor')
            with pytest.raises(ValueError, match='锚点|抢占'):
                await apply_scope_decision(session, decision)
            # 目标实体可以另外拥有自己的独立来源范围；原组不得把该来源抢为成员。
            other = await request_joint(session, branches[:1], [None, None], key='other-scope', joint=False)
            other['assignments'] = []
            await apply_scope_decision(session, other)
            steal = await request_joint(session, [*sources, branches[0]], targets, key='steal-other-scope')
            with pytest.raises(ValueError, match='占用'):
                await apply_scope_decision(session, steal)
    run(check)


def test_新成员表迁移不回填或改写旧单源审计():
    from scripts.migrate_place_identity import migrate
    async def check(factory):
        async with factory() as session:
            sources, branches, _ = await seed_joint(session, second=False)
            targets = await entity_ids(session, branches)
            decision = await request_joint(session, sources, targets, joint=False)
            before = await apply_scope_decision(session, decision)
            connection = await session.connection()
            await connection.run_sync(lambda conn: PlaceIdentityScopeSource.__table__.drop(conn))
            assert (await migrate(connection, False))['missing'] == ['place_identity_scope_source']
            await migrate(connection, True)
            assert (await migrate(connection, True))['missing'] == []
            actual = await scope_snapshot(session, sources[0].city, sources[0].id,
                before['scopes'][0]['name_keys'], [e['entity_id'] for e in before['entities']])
            assert actual == before and 'scopeSources' not in actual
            await rollback_decision(session, decision['key'])
    run(check)


def test_联合来源两侧旧相册均待审_逐图分配和范围回滚互相保护(tmp_path):
    from PIL import Image
    from app.aggregate.image_identity import apply_image_decision, load_image_catalog, load_image_rows
    from test_image_identity_db import image_request
    async def check(factory):
        async with factory() as session:
            sources, branches, note = await seed_joint(session)
            targets = await entity_ids(session, branches)
            photos = []
            for index, source in enumerate(sources):
                filename = f'joint-{index}.jpg'
                Image.new('RGB', (60, 40), ['red', 'blue'][index]).save(tmp_path / filename)
                photo = NoteImage(raw_note_id=note.id, city=note.city, img_index=index, file_path=filename,
                    canonical_place_id=source.id, img_type='scenery', assignment={'original': source.name})
                photos.append(photo)
                session.add(photo)
            await session.flush()
            original_reviews = [copy.deepcopy(photo.assignment) for photo in photos]
            first = await request_joint(session, sources, targets)
            await apply_scope_decision(session, first)
            roots = {'source_root': tmp_path, 'photography_root': tmp_path / 'photos'}
            rows = await load_image_rows(session, note.city, **roots)
            catalog = await load_image_catalog(session, note.city)
            assert len(rows) == 2 and all(catalog.resolve(row)['status'] == 'review' for row in rows)
            image_decision = await image_request(session, note.city, tmp_path, targets)
            await apply_image_decision(session, image_decision, **roots)
            catalog = await load_image_catalog(session, note.city)
            assert [catalog.resolve(row)['entity']['entity_id'] for row in rows] == targets
            assert all(len(catalog.policies(rows)[eid]['approved']) == 1 for eid in targets)
            with pytest.raises(ValueError, match='后续'):
                await rollback_decision(session, first['key'])
            sources[1].name = '第二来源后来改名'
            await session.flush()
            with pytest.raises(ValueError, match='后续'):
                await rollback_decision(session, image_decision['key'], image_roots=roots)
            sources[1].name = 'cuida'
            await session.flush()
            await rollback_decision(session, image_decision['key'], image_roots=roots)
            await rollback_decision(session, first['key'])
            assert [photo.assignment for photo in photos] == original_reviews
    run(check)


def test_联合真实导出清空两个旧源缓存_两分店保留自己的事实(monkeypatch, tmp_path):
    from scripts import export_to_tripweaver as exporter
    async def check(factory):
        city = '联合导出测试'
        monkeypatch.setattr(exporter, 'SessionFactory', factory)
        async with factory() as session:
            sources, branches, _ = await seed_joint(session, city=city)
            targets = await entity_ids(session, branches)
            old_ids = await entity_ids(session, sources)
            await apply_scope_decision(session, await request_joint(session, sources, targets))
            await session.commit()
        out = tmp_path / 'joint-export.json'
        monkeypatch.setattr(sys, 'argv', ['export_to_tripweaver.py', '--city', city, '--out', str(out)])
        await exporter.main()
        data = json.loads(out.read_text(encoding='utf-8'))
        by_id = {p['id']: p for p in data['places']}
        assert set(by_id) == set([*old_ids, *targets])
        for eid in old_ids:
            old = by_id[eid]
            assert not old['verified'] and old['payload']['mentionSources'] == []
            assert old['payload']['identityWithdrawal']['candidateIds'] == sorted(targets)
            assert old['payload']['imageIdentity']['approved'] == []
        assert [by_id[eid]['payload']['typicalVisitMinutes'] for eid in targets] == [30, 60]
        assert all(by_id[eid]['payload']['mentionCount'] == 1 for eid in targets)
        assert '混合旧品牌缓存' not in json.dumps(data, ensure_ascii=False)
    run(check)
