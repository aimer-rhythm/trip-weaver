"""显式网页保全的真实SQL事务、导出、陈旧输入及逆序回滚。"""
from __future__ import annotations

import copy
import json
import sys
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.aggregate.mention_identity import apply_scope_decision, load_mention_catalog, load_mention_rows
from app.aggregate.place_identity import bootstrap, load_catalog, rollback_decision
from app.clean.mention_identity import digest
from app.clean.scoped_place_export import scoped_facts
from app.models import CanonicalPlace, PlaceEntityChange, PlaceMention, PlaceSummary, RawNote
from test_mention_identity_db import request, run


PROFILE = {'version': 1, 'profileVersion': 1, 'qualityVersion': 2,
    'intro': '古祠文物区有历史碑刻。', 'method': 'web_research_with_model_knowledge',
    'compiledAt': '2026-10-02T10:02:18Z', 'sourcePolicy': 'web_primary_model_background_xhs_separate',
    'highlights': [{'text': '古祠文物区有历史碑刻。', 'basis': 'web', 'quote': '文物区保存历史碑刻。',
        'sourceUrl': 'https://example.test/museum', 'observedAt': '2026-10-02T10:02:03Z',
        'citations': [{'quote': '文物区保存历史碑刻。', 'sourceUrl': 'https://example.test/museum',
                       'observedAt': '2026-10-02T10:02:03Z'}]}]}


async def seed_profile(session):
    city = '网页保全' + uuid4().hex[:10]
    source = CanonicalPlace(city=city, name='古祠', normalized_name='古祠', place_type='attraction',
        latitude=30.64, longitude=104.04, geo_status='resolved', is_active=True, quality_score=60,
        content_profile=copy.deepcopy(PROFILE))
    note = RawNote(city=city, note_id=uuid4().hex, keyword='古祠', title='古祠参观',
        desc='古祠有红墙；古祠人多体验一般。', source_url='https://example.test/note', status='EXTRACTED')
    session.add_all([source, note])
    await session.flush()
    await bootstrap(session, city)
    eid = (await load_catalog(session, city)).resolve(place_id=source.id)['entity_id']
    mentions = [PlaceMention(raw_note_id=note.id, name='古祠', normalized_name='古祠',
        place_type='attraction', mention_type=kind, reason=text, evidence_text=text, confidence=.95)
        for kind, text in [('recommend', '古祠有红墙'), ('warning', '古祠人多体验一般')]]
    session.add_all([*mentions, PlaceSummary(canonical_place_id=source.id, mention_count_30d=2, recommend_score=20)])
    await session.flush()
    decision = await request(session, source, [eid, eid], key=city + '-scope')
    decision['preserveWebProfiles'] = [{'entityId': eid, 'sourcePlaceId': source.id,
        'profileHash': digest(PROFILE), 'evidence': [{'kind': 'subject_only_preservation',
            'file': 'review.json', 'conclusion': '原网页描述归于同一古祠，保留引用与旧日期，不宣称本轮重抓。'}]}]
    return source, note, mentions, eid, decision


async def current_facts(session, city, eid):
    catalog = await load_mention_catalog(session, city)
    entity = catalog.catalog.entities[eid]
    rows = [row for row in await load_mention_rows(session, city)
            if catalog.resolve(row).get('entity', {}).get('entity_id') == eid]
    source = await session.get(CanonicalPlace, entity['primary_place_id'])
    return scoped_facts(entity, rows, '2026-10-09', [], source.content_profile, mention_catalog=catalog)


def test_原网页内容在真实导出保全_不自动续绑_幂等逆序恢复(monkeypatch, tmp_path):
    from scripts import export_to_tripweaver as exporter

    async def check(factory):
        monkeypatch.setattr(exporter, 'SessionFactory', factory)
        async with factory() as session:
            source, note, mentions, eid, decision = await seed_profile(session)
            source_id, city = source.id, source.city
            original_mentions = [(m.id, m.name, m.reason, m.evidence_text) for m in mentions]
            original_note = (note.desc, note.created_at, note.publish_time, note.img_analysis)
            first = await apply_scope_decision(session, decision)
            assert await apply_scope_decision(session, decision) == first
            bound = copy.deepcopy(source.content_profile)
            assert bound['identityBinding']['revision'] == 2
            assert {k: v for k, v in bound.items() if k != 'identityBinding'} == PROFILE
            facts, evidence = await current_facts(session, city, eid)
            assert facts['content'] == PROFILE
            assert any(e['kind'] == 'xhs_warning' and e['content'] == '古祠人多体验一般' for e in evidence)
            change = await session.scalar(select(PlaceEntityChange).where(PlaceEntityChange.change_key == decision['key']))
            assert next(p for p in change.before['derivedPlaces'] if p['id'] == source_id)['content_profile'] == PROFILE
            assert next(p for p in change.after['derivedPlaces'] if p['id'] == source_id)['content_profile'] == bound
            assert change.request['preserveWebProfiles'] == decision['preserveWebProfiles']
            await session.commit()
        out = tmp_path / 'export.json'
        monkeypatch.setattr(sys, 'argv', ['export_to_tripweaver.py', '--city', city, '--out', str(out)])
        await exporter.main()
        exported = json.loads(out.read_text(encoding='utf-8'))['places']
        assert len(exported) == 1 and exported[0]['payload']['content'] == PROFILE
        async with factory() as session:
            source = await session.get(CanonicalPlace, source_id)
            # 未显式重新审阅的scope修订使旧绑定自然失效，不凭同一名字保留旧缓存。
            second = await request(session, source, [eid, eid], key=city + '-second')
            await apply_scope_decision(session, second)
            assert source.content_profile == bound
            assert (await current_facts(session, city, eid))[0]['content'] != PROFILE
            with pytest.raises(ValueError, match='后续修改'):
                await rollback_decision(session, decision['key'])
            await rollback_decision(session, second['key'])
            assert (await current_facts(session, city, eid))[0]['content'] == PROFILE
            # 新明确审阅可以为当前完整scope续绑，恢复时仍精确回到上一次绑定。
            third = await request(session, source, [eid, eid], key=city + '-third')
            third['preserveWebProfiles'] = copy.deepcopy(decision['preserveWebProfiles'])
            third['preserveWebProfiles'][0]['profileHash'] = digest(bound)
            await apply_scope_decision(session, third)
            assert source.content_profile['identityBinding']['revision'] == 3
            assert (await current_facts(session, city, eid))[0]['content'] == PROFILE
            await rollback_decision(session, third['key'])
            assert source.content_profile == bound
            await rollback_decision(session, decision['key'])
            assert source.content_profile == PROFILE
            assert not (await load_mention_catalog(session, city)).scopes
            for original in original_mentions:
                current = await session.get(PlaceMention, original[0])
                assert (current.id, current.name, current.reason, current.evidence_text) == original
            current_note = await session.get(RawNote, note.id)
            assert (current_note.desc, current_note.created_at, current_note.publish_time, current_note.img_analysis) == original_note
            await session.commit()
        await exporter.main()
        assert json.loads(out.read_text(encoding='utf-8'))['places'][0]['payload']['content'] == PROFILE
    run(check)


@pytest.mark.parametrize('variant', ['null', 'missing_hash', 'stale_hash', 'duplicate', 'wrong_source',
    'wrong_entity', 'unassigned', 'no_evidence', 'false_current_review', 'community', 'no_quote', 'bad_url', 'missing_date'])
def test_过期或未审阅网页不能顺带绑定(variant):
    async def check(factory):
        async with factory() as session:
            source, _, _, eid, decision = await seed_profile(session)
            values = decision['preserveWebProfiles']
            if variant == 'null': decision['preserveWebProfiles'] = None
            elif variant == 'missing_hash': values[0].pop('profileHash')
            elif variant == 'stale_hash': values[0]['profileHash'] = '0' * 64
            elif variant == 'duplicate': values.append(copy.deepcopy(values[0]))
            elif variant == 'wrong_source': values[0]['sourcePlaceId'] += 1000000
            elif variant == 'wrong_entity': values[0]['entityId'] = '0' * 32
            elif variant == 'unassigned':
                for a in decision['assignments']: a['entityId'] = None
            elif variant == 'no_evidence': values[0]['evidence'] = []
            elif variant == 'false_current_review': values[0]['evidence'][0]['kind'] = 'current_facts_verified'
            else:
                profile = copy.deepcopy(PROFILE)
                if variant == 'community': profile['highlights'][0]['basis'] = 'xhs'
                elif variant == 'no_quote': profile['highlights'][0]['quote'] = ''
                elif variant == 'bad_url': profile['highlights'][0]['sourceUrl'] = 'file:///secret'
                elif variant == 'missing_date': profile['highlights'][0]['citations'][0]['observedAt'] = ''
                source.content_profile = profile
                await session.flush()
                values[0]['profileHash'] = digest(profile)
            before = copy.deepcopy(source.content_profile)
            with pytest.raises(ValueError): await apply_scope_decision(session, decision)
            assert source.content_profile == before
            catalog = await load_mention_catalog(session, source.city)
            assert not catalog.scopes and not catalog.assignments and catalog.catalog.entities[eid]['revision'] == 1
    run(check)


@pytest.mark.parametrize('variant', ['profile', 'mention', 'note'])
def test_应用后并发变化拒绝旧回滚(variant):
    async def check(factory):
        async with factory() as session:
            source, note, mentions, _, decision = await seed_profile(session)
            await apply_scope_decision(session, decision)
            bound = copy.deepcopy(source.content_profile)
            if variant == 'profile': source.content_profile = {**bound, 'intro': '后续人工编辑。'}
            elif variant == 'mention': mentions[0].reason = '后续原提及修订'
            else: note.desc += '原作者补充文字。'
            await session.flush()
            with pytest.raises(ValueError, match='后续修改'):
                await rollback_decision(session, decision['key'])
            assert (await load_mention_catalog(session, source.city)).scopes
            if variant == 'profile': assert source.content_profile['intro'] == '后续人工编辑。'
            else: assert source.content_profile == bound
    run(check)


def test_CLI默认预演同时回滚范围和网页_应用审计可回放(monkeypatch, tmp_path):
    from scripts import govern_place_identity as cli

    async def check(factory):
        monkeypatch.setattr(cli, 'SessionFactory', factory)
        async with factory() as session:
            source, _, _, _, decision = await seed_profile(session)
            sid, city = source.id, source.city
            await session.commit()
        input_file, out = tmp_path / 'scope.json', tmp_path / 'report.json'
        input_file.write_text(json.dumps([decision], ensure_ascii=False), encoding='utf-8')
        args = ['govern_place_identity.py', '--city', city, '--scope-decisions', str(input_file), '--out', str(out)]
        monkeypatch.setattr(sys, 'argv', args)
        await cli.main()
        async with factory() as session:
            assert (await session.get(CanonicalPlace, sid)).content_profile == PROFILE
            assert not (await load_mention_catalog(session, city)).scopes
        monkeypatch.setattr(sys, 'argv', [*args, '--apply'])
        await cli.main()
        first = json.loads(out.read_text(encoding='utf-8'))
        await cli.main()
        assert json.loads(out.read_text(encoding='utf-8')) == first
        monkeypatch.setattr(sys, 'argv', ['govern_place_identity.py', '--city', city, '--rollback', decision['key'], '--apply', '--out', str(out)])
        await cli.main()
        async with factory() as session:
            assert (await session.get(CanonicalPlace, sid)).content_profile == PROFILE
            assert not (await load_mention_catalog(session, city)).scopes
    run(check)
