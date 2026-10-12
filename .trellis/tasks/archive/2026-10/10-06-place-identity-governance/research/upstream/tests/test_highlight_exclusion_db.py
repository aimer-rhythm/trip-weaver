"""逐条看点排除：真实SQL、来源绑定、保留有效内容和可逆审核。"""
import copy
import json
import sys
from uuid import uuid4

import pytest
from sqlalchemy import select
from app.aggregate.mention_identity import apply_scope_decision, load_mention_catalog, load_mention_rows
from app.aggregate.place_identity import bootstrap, load_catalog, rollback_decision
from app.clean.mention_identity import effective_mention, mention_fingerprint, validate_fact_exclusions
from app.clean.scoped_place_export import scoped_binding, scoped_facts
from app.models import CanonicalPlace, PlaceMention, PlaceMentionAssignment, PlaceSummary, RawNote
from test_mention_identity_db import run, request

NAME = '甲园大院'
WRONG = '大院是清泉本体，水底持续冒泡'
KEPT = '院内有清泉、石桥和古树'
QUOTE = f'{NAME}：{WRONG}。{KEPT}。'


async def seed(session):
    city = '看点排除' + uuid4().hex[:10]
    note = RawNote(city=city, note_id=uuid4().hex, keyword='庭院', title='庭院与泉池',
        desc=QUOTE + f'\n{NAME}建议游玩75分钟。', source_url='https://example.com/highlights', status='EXTRACTED')
    place = CanonicalPlace(city=city, name=NAME, normalized_name=NAME, place_type='attraction',
        geo_status='resolved', is_active=True, latitude=36.6, longitude=117.02, quality_score=20)
    session.add_all([note, place]); await session.flush(); await bootstrap(session, city)
    mention = PlaceMention(raw_note_id=note.id, name=NAME, normalized_name=NAME, place_type='attraction',
        mention_type='recommend', confidence=.95, reason=WRONG, evidence_text=WRONG,
        fact_type='visit_duration', fact_value={'minutes': 75, 'reservation': False,
            'placeContent': {'version': 1, 'highlights': [{'text': WRONG, 'quote': WRONG}, {'text': KEPT, 'quote': KEPT}]}})
    session.add_all([mention, PlaceSummary(canonical_place_id=place.id, mention_count_30d=1, recommend_score=10)])
    await session.flush()
    cat = await load_mention_catalog(session, city); eid = cat.catalog.resolve(place_id=place.id)['entity_id']
    d = await request(session, place, [eid], key=uuid4().hex)
    d['assignments'][0]['factExclusions'] = {field: {'reason': 'subject_mismatch', 'quote': QUOTE}
        for field in ['reason', 'evidence_text', 'place_content']}
    d['assignments'][0]['factExclusions']['place_content']['highlightIndexes'] = [0]
    return place, note, mention, d


def test_看点排除真实导出幂等原字段保留旧缓存失效及逆序回滚(monkeypatch, tmp_path):
    from app.extract import place_profiles
    from scripts import export_to_tripweaver as exporter
    async def check(factory):
        monkeypatch.setattr(exporter, 'SessionFactory', factory)
        monkeypatch.setattr(place_profiles, 'SessionFactory', factory)
        async with factory() as s:
            p, _, _, d = await seed(s); city = p.city
            original = copy.deepcopy(await load_mention_rows(s, city)); before = await load_catalog(s, city)
            cat = await load_mention_catalog(s, city)
            # 旧版本即使带完整同提及绑定，应用升版后也不能复活混合介绍。
            stale = {'version': 1, 'profileVersion': 1, 'qualityVersion': 2, 'intro': WRONG,
                     'identityBinding': scoped_binding(cat.catalog.resolve(place_id=p.id), original)}
            result = await apply_scope_decision(s, d); assert result == await apply_scope_decision(s, d)
            cat = await load_mention_catalog(s, city); resolution = cat.resolve(original[0])
            projected = effective_mention(original[0], resolution)
            assert projected['reason'] is None and projected['evidence_text'] is None
            assert projected['fact_value'] == {**original[0]['fact_value'], 'placeContent': {'version': 1, 'highlights': [{'text': KEPT, 'quote': KEPT}]}}
            payload, evidence = scoped_facts(cat.catalog.resolve(place_id=p.id), original, '', [], profile=stale, mention_catalog=cat)
            assert payload['typicalVisitMinutes'] == 75 and payload['mentionCount'] == 1
            assert payload['content']['intro'] == KEPT + '。' and evidence == [] and payload['topReasons'] == []
            assert payload['mentionSources'][0]['inputHash'] == mention_fingerprint(original[0])
            assert original == await load_mention_rows(s, city)
            projected['fact_value']['placeContent']['highlights'][0]['text'] = '修改消费副本'
            assert original[0]['fact_value']['placeContent']['highlights'][1]['text'] == KEPT
            await s.commit()
        assert await place_profiles.load_sources(city, NAME) == []
        output = tmp_path / 'xhs-places-highlight.json'
        monkeypatch.setattr(sys, 'argv', ['export_to_tripweaver.py', '--city', city, '--out', str(output)])
        await exporter.main()
        places = json.loads(output.read_text(encoding='utf-8'))['places']; assert len(places) == 1
        row = places[0]; assert row['name'] == NAME and row['verified']
        assert row['payload']['typicalVisitMinutes'] == 75 and row['payload']['mentionCount'] == 1
        assert row['payload']['content']['intro'] == KEPT + '。' and WRONG not in json.dumps(row, ensure_ascii=False)
        async with factory() as s:
            await rollback_decision(s, d['key'])
            after = await load_catalog(s, city)
            assert before.entities == after.entities and before.members == after.members
            cat = await load_mention_catalog(s, city); assert not cat.scopes and not cat.assignments
            assert original == await load_mention_rows(s, city)
    run(check)


@pytest.mark.parametrize('case', ['empty', 'null', 'string', 'bool', 'float', 'negative', 'outside', 'duplicate', 'unsorted', 'all',
    'unknown_key', 'wrong_field', 'wrong_reason', 'no_quote', 'other_highlight_quote', 'unavailable', 'null_target',
    'missing_highlights', 'empty_highlights', 'wrong_version', 'bool_version', 'malformed_item', 'empty_text', 'empty_quote'])
def test_索引和原引文非法必须原子拒绝(case):
    async def check(factory):
        async with factory() as s:
            p, note, mention, d = await seed(s)
            a = d['assignments'][0]; decision = a['factExclusions']['place_content']
            values = {'empty': [], 'null': None, 'string': ['0'], 'bool': [True], 'float': [0.0],
                      'negative': [-1], 'outside': [2], 'duplicate': [0, 0], 'unsorted': [1, 0], 'all': [0, 1]}
            if case in values: decision['highlightIndexes'] = values[case]
            elif case == 'unknown_key': decision['replace'] = KEPT
            elif case == 'wrong_field': a['factExclusions']['reason']['highlightIndexes'] = [0]
            elif case == 'wrong_reason': decision['reason'] = 'group_duration'
            elif case == 'no_quote': decision['quote'] = NAME
            elif case == 'other_highlight_quote':
                note.desc += f'\n{NAME}：{KEPT}。'; decision['quote'] = f'{NAME}：{KEPT}。'
            elif case == 'unavailable': note.status = 'PRIVATE'
            elif case == 'null_target': a['entityId'] = None
            else:
                facts = copy.deepcopy(mention.fact_value); content = facts['placeContent']
                if case == 'missing_highlights': del content['highlights']
                elif case == 'empty_highlights': content['highlights'] = []
                elif case == 'wrong_version': content['version'] = 2
                elif case == 'bool_version': content['version'] = True
                elif case == 'malformed_item': content['highlights'][0] = 'invalid'
                elif case == 'empty_text': content['highlights'][0]['text'] = ' '
                elif case == 'empty_quote': content['highlights'][0]['quote'] = ''
                mention.fact_value = facts
            await s.flush()
            a['inputHash'] = mention_fingerprint((await load_mention_rows(s, p.city))[0])
            before = (await load_catalog(s, p.city)).entities
            with pytest.raises(ValueError): await apply_scope_decision(s, d)
            assert (await load_catalog(s, p.city)).entities == before
            assert not (await load_mention_catalog(s, p.city)).scopes
    run(check)


def test_已有索引篡改及原看点换序均重新待审():
    async def check(factory):
        async with factory() as s:
            p, _, mention, d = await seed(s); await apply_scope_decision(s, d)
            original = (await load_mention_rows(s, p.city))[0]
            a = await s.scalar(select(PlaceMentionAssignment).where(PlaceMentionAssignment.mention_id == mention.id))
            value = copy.deepcopy(a.fact_exclusions); value['place_content']['highlightIndexes'] = [99]
            a.fact_exclusions = value; await s.flush()
            cat = await load_mention_catalog(s, p.city); result = cat.resolve(original)
            assert result['reason'] == 'invalid_fact_exclusions' and effective_mention(original, result)['fact_value'] == {}
            a.fact_exclusions = d['assignments'][0]['factExclusions']
            facts = copy.deepcopy(mention.fact_value); facts['placeContent']['highlights'].reverse(); mention.fact_value = facts
            await s.flush(); cat = await load_mention_catalog(s, p.city)
            assert cat.resolve((await load_mention_rows(s, p.city))[0])['reason'] == 'changed_input'
    run(check)


def test_重复看点按原索引保序且旧整块排除兼容():
    row = {'name': NAME, 'normalized_name': NAME, 'note_desc': QUOTE,
           'fact_value': {'placeContent': {'version': 1, 'highlights': [
               {'text': WRONG, 'quote': WRONG}, {'text': KEPT, 'quote': KEPT}, {'text': WRONG, 'quote': WRONG}]}}}
    decision = {'place_content': {'reason': 'subject_mismatch', 'quote': QUOTE, 'highlightIndexes': [0, 2]}}
    assert validate_fact_exclusions(decision, row, 'entity') == decision
    projected = effective_mention(row, {'status': 'resolved', 'factExclusions': decision})
    assert projected['fact_value']['placeContent']['highlights'] == [{'text': KEPT, 'quote': KEPT}]
    del decision['place_content']['highlightIndexes']
    assert validate_fact_exclusions(decision, row, 'entity') == decision
    assert effective_mention(row, {'status': 'resolved', 'factExclusions': decision})['fact_value'] == {}


def test_看点索引可共用既有限定标题但非法anchor不可回退():
    from test_qualified_heading_fact_exclusion_db import ANCHOR, NAME as LIGHT_NAME, QUOTE as LIGHT_QUOTE
    row = {'name': LIGHT_NAME, 'normalized_name': LIGHT_NAME, 'note_desc': LIGHT_QUOTE,
           'fact_value': {'placeContent': {'version': 1, 'highlights': [
               {'text': '胡同', 'quote': '夹心胡同'}, {'text': '灯', 'quote': '爱心红绿灯'}]}}}
    decision = {'place_content': {'reason': 'subject_mismatch', 'quote': LIGHT_QUOTE, 'subjectAnchor': ANCHOR, 'highlightIndexes': [0]}}
    assert validate_fact_exclusions(decision, row, 'entity') == decision
    decision['place_content']['subjectAnchor'] = None
    with pytest.raises(ValueError): validate_fact_exclusions(decision, row, 'entity')
