"""名称纠错保持原消费，仅把具体误写从全局别名收窄为逐提及归属。"""
import copy
import json
import sys

import pytest

from app.aggregate.mention_identity import apply_scope_decision, load_mention_catalog, load_mention_rows
from app.aggregate.place_identity import apply_decision, bootstrap, load_catalog, rollback_decision
from app.aggregate.image_identity import load_image_catalog
from app.clean.mention_identity import mention_fingerprint, source_fingerprint
from app.models import CanonicalPlace, PlaceMention, PlaceSummary, RawNote
from test_mention_identity_db import run


async def seed(session):
    city = '名称纠错测试'
    main, typo = [CanonicalPlace(city=city, name=n, normalized_name=n, geo_status='resolved',
        latitude=39.9, longitude=116.4, place_type='attraction', theme_tags=['自然风光'])
        for n in ['甲山公园', '乙甲山公园']]
    main.typical_visit_minutes = 60
    main.content_profile = {'profileVersion': 1, 'qualityVersion': 2, 'intro': '甲山的原有网页简介。',
        'method': 'source_grounded_editor', 'compiledAt': '2026-10-01T00:00:00Z',
        'highlights': [{'text': '可登山观景。', 'quote': '可登山观景',
            'sourceUrl': 'https://example.test/park', 'observedAt': '2026-10-01T00:00:00Z'}]}
    note = RawNote(city=city, note_id='name-correction', keyword='公园', title='一次名称误写',
        desc='乙甲山公园可观景，同篇图中明确是甲山公园。', source_url='https://example.test/note',
        status='EXTRACTED')
    session.add_all([main, typo, note])
    await session.flush()
    await bootstrap(session, city)
    rows = [PlaceMention(raw_note_id=note.id, name=p.name, normalized_name=p.name,
        place_type='attraction', mention_type='recommend', reason='可观景', evidence_text='可观景', confidence=.95)
        for p in [main, typo]]
    session.add_all(rows)
    session.add(PlaceSummary(canonical_place_id=main.id, mention_count_30d=2, recommend_score=9.5))
    await session.flush()
    catalog = await load_catalog(session, city)
    eid, old = [catalog.resolve(place_id=p.id)['entity_id'] for p in [main, typo]]
    await apply_decision(session, dict(key='original-incorrect-merge', city=city, entityId=eid,
        mergeEntityIds=[old], expectedRevisions={eid: 1, old: 1},
        overrides={'recommendationPolicy': 'resolved_attraction_mentions_v1'}, evidence=[{'source': '旧误合并夹具'}]))
    inputs = await load_mention_rows(session, city)
    row = next(r for r in inputs if r['name'] == typo.name)
    scope = dict(key='correct-name-scope', city=city, mode='name_correction', sourcePlaceId=typo.id,
        expectedSourceHash=source_fingerprint({k: getattr(typo, k) for k in ('id', 'city', 'name', 'normalized_name')}),
        expectedScopeRevision=0, expectedRevisions={eid: 2},
        assignments=[dict(mentionId=row['id'], inputHash=mention_fingerprint(row), entityId=eid)],
        evidence=[{'kind': 'mention_name_correction', 'file': 'review.md', 'conclusion': '原图只支持这次误写纠正'}])
    return main, typo, note, eid, old, scope, inputs


def test_仅纠错不改变网页图片事实范围_新错名和变更原文待审_可逆回滚():
    async def check(factory):
        async with factory() as session:
            main, typo, note, eid, old, scope, inputs = await seed(session)
            previous = await load_mention_catalog(session, main.city)
            profile = copy.deepcopy(main.content_profile)
            after = await apply_scope_decision(session, scope)
            assert await apply_scope_decision(session, scope) == after
            catalog = await load_mention_catalog(session, main.city)
            assert catalog.managed_entity_ids() == set()
            assert catalog.withdrawal_owners(typo.id) == set()
            assert catalog.scope_for_source(typo.id)['mode'] == 'name_correction'
            assert await load_mention_rows(session, main.city) == inputs
            assert main.content_profile == profile and main.typical_visit_minutes == 60
            correction = dict(key='exclude-global-wrong-name', city=main.city, entityId=eid,
                expectedRevisions={eid: 3}, excludeNames=[typo.name], evidence=scope['evidence'])
            result = await apply_decision(session, correction)
            assert await apply_decision(session, correction) == result
            catalog = await load_mention_catalog(session, main.city)
            assert catalog.catalog.resolve(typo.name) is None
            assert catalog.catalog.root(old)['entity_id'] == eid
            assert old in catalog.catalog.entities[eid]['legacy_ids']
            original = next(r for r in inputs if r['name'] == typo.name)
            assert catalog.resolve(original)['entity']['entity_id'] == eid
            assert catalog.resolve({**original, 'id': original['id'] + 1000})['reason'] == 'unreviewed_mention'
            assert catalog.resolve({**original, 'note_desc': '原文已经变化'})['reason'] == 'changed_input'
            images = await load_image_catalog(session, main.city, catalog)
            image = dict(image_key='test:1', city=main.city, source_place_id=main.id,
                raw_note_id=note.id, source_sha256='a' * 64)
            assert not images.controlled(image)
            assert images.resolve(image)['entity']['entity_id'] == eid
            assert images.policies([image]) == {}
            await rollback_decision(session, correction['key'])
            await rollback_decision(session, scope['key'])
            restored = await load_mention_catalog(session, main.city)
            assert restored.catalog.entities == previous.catalog.entities
            assert restored.scopes == previous.scopes and restored.assignments == previous.assignments
            assert await load_mention_rows(session, main.city) == inputs
    run(check)


@pytest.mark.parametrize('change', ['mode', 'null', 'missing', 'stale', 'facts', 'warning', 'guard', 'evidence', 'primary'])
def test_拒绝借名称纠错绕过完整范围与证据(change):
    async def check(factory):
        async with factory() as session:
            main, typo, _, eid, _, scope, _ = await seed(session)
            if change == 'mode': scope['mode'] = 'unknown'
            elif change == 'null': scope['assignments'][0]['entityId'] = None
            elif change == 'missing': scope['assignments'] = []
            elif change == 'stale': scope['assignments'][0]['inputHash'] = '0' * 64
            elif change == 'facts': scope['assignments'][0]['factExclusions'] = None
            elif change == 'warning': scope['textWarnings'] = []
            elif change == 'guard': scope['guardedNames'] = [main.name]
            elif change == 'evidence': scope['evidence'] = [{'source': '没有逐提及证据'}]
            elif change == 'primary':
                scope['sourcePlaceId'] = main.id
                scope['expectedSourceHash'] = source_fingerprint({k: getattr(main, k) for k in ('id', 'city', 'name', 'normalized_name')})
                row = next(r for r in await load_mention_rows(session, main.city) if r['name'] == main.name)
                scope['assignments'] = [dict(mentionId=row['id'], inputHash=mention_fingerprint(row), entityId=eid)]
            with pytest.raises(ValueError):
                await apply_scope_decision(session, scope)
            assert (await load_mention_catalog(session, main.city)).scopes == {}
    run(check)


def test_旧完整范围不降级_仅纠错升级须显式声明():
    async def check(factory):
        async with factory() as session:
            main, typo, _, eid, _, scope, _ = await seed(session)
            await apply_scope_decision(session, scope)
            later = {**scope, 'key': 'upgrade', 'expectedScopeRevision': 1, 'expectedRevisions': {eid: 3}}
            later.pop('mode')
            with pytest.raises(ValueError, match='显式声明'):
                await apply_scope_decision(session, later)
            later['mode'] = 'facts'
            await apply_scope_decision(session, later)
            assert (await load_mention_catalog(session, main.city)).managed_entity_ids() == {eid}
            with pytest.raises(ValueError, match='不能降级'):
                await apply_scope_decision(session, {**later, 'key': 'downgrade', 'mode': 'name_correction',
                    'expectedScopeRevision': 2, 'expectedRevisions': {eid: 4}})
            await rollback_decision(session, later['key'])
            assert (await load_mention_catalog(session, main.city)).scope_for_source(typo.id)['mode'] == 'name_correction'
    run(check)


def test_真实导出保留原网页与事实且不生成媒体治理合同(monkeypatch, tmp_path):
    from scripts import export_to_tripweaver as exporter
    async def check(factory):
        monkeypatch.setattr(exporter, 'SessionFactory', factory)
        async with factory() as session:
            main, typo, _, eid, _, scope, _ = await seed(session)
            city, wrong = main.city, typo.name
            await session.commit()
        async def export(name):
            out = tmp_path / name
            monkeypatch.setattr(sys, 'argv', ['export', '--city', city, '--out', str(out)])
            await exporter.main()
            return next(p for p in json.loads(out.read_bytes())['places'] if p['id'] == eid)
        before = await export('before.json')
        async with factory() as session:
            await apply_scope_decision(session, scope)
            await apply_decision(session, dict(key='exclude-name-export', city=city, entityId=eid,
                expectedRevisions={eid: 3}, excludeNames=[wrong], evidence=scope['evidence']))
            await session.commit()
        after = await export('after.json')
        assert after['payload']['content'] == before['payload']['content']
        assert 'mentionSources' not in after['payload'] and 'imageIdentity' not in after['payload']
        assert wrong not in after['payload']['aliases'] and wrong not in after['payload']['identity']['memberNames']
        for field in before['payload'].keys() | after['payload'].keys():
            if field not in {'identity', 'aliases', 'recommendationIdentity'}:
                assert before['payload'].get(field) == after['payload'].get(field), field
        assert after['payload']['recommendationIdentity']['inputHash'] == before['payload']['recommendationIdentity']['inputHash']
    run(check)
