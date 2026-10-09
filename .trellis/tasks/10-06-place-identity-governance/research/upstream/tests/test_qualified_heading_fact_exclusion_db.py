"""限定标题引用的真实SQL与拒绝边界；不改变名称、原文或消费身份。"""
import copy
import json
import sys
from uuid import uuid4

import pytest
from sqlalchemy import select
from app.aggregate.mention_identity import apply_scope_decision, load_mention_catalog, load_mention_rows
from app.aggregate.place_identity import bootstrap, load_catalog, rollback_decision
from app.clean.mention_identity import effective_mention, mention_fingerprint, validate_fact_exclusions
from app.models import CanonicalPlace, PlaceMention, PlaceMentionAssignment, PlaceSummary, RawNote
from test_mention_identity_db import run, request

NAME = '经三路爱心红绿灯'
QUOTE = '1️⃣6️⃣爱心红绿灯：经三路，爱心红绿灯和夹心胡同都在这里；'
ANCHOR = {'kind': 'qualified_heading', 'subject': '爱心红绿灯', 'qualifier': '经三路'}


async def seed(session, desc=QUOTE, quote=QUOTE):
    city = '标题字段' + uuid4().hex[:10]
    note = RawNote(city=city, note_id=uuid4().hex, keyword='街区', title='街区拍摄清单', desc=desc,
        source_url='https://example.com/qualified-heading', status='EXTRACTED')
    place = CanonicalPlace(city=city, name=NAME, normalized_name=NAME, place_type='photo_spot',
        geo_status='resolved', latitude=36.6, longitude=117.02, is_active=True, quality_score=20,
        content_profile={'profileVersion': 1, 'qualityVersion': 2, 'intro': '旧内容把夹心胡同算作灯自身景观'})
    session.add_all([note, place]); await session.flush(); await bootstrap(session, city)
    mention = PlaceMention(raw_note_id=note.id, name=NAME, normalized_name=NAME, place_type='photo_spot',
        mention_type='recommend', confidence=.95, reason='灯的景观包括夹心胡同，适合拍摄纪念照片',
        evidence_text='爱心红绿灯和夹心胡同都在这里', fact_type='visit_duration',
        fact_value={'minutes': 75, 'placeContent': {'version': 1, 'highlights': [
            {'text': '有爱心红绿灯和夹心胡同', 'quote': '爱心红绿灯和夹心胡同都在这里'}]}})
    session.add_all([mention, PlaceSummary(canonical_place_id=place.id, mention_count_30d=1,
        recommend_score=10, top_reasons=[{'reason': mention.reason}])]); await session.flush()
    cat = await load_mention_catalog(session, city); eid = cat.catalog.resolve(place_id=place.id)['entity_id']
    decision = await request(session, place, [eid], key=uuid4().hex)
    decision['assignments'][0]['factExclusions'] = {field: {'reason': 'subject_mismatch', 'quote': quote,
        'subjectAnchor': copy.deepcopy(ANCHOR)} for field in ('reason', 'evidence_text', 'place_content')}
    return place, note, mention, decision


def test_限定标题引用真实应用导出幂等和回滚保持独立事实(monkeypatch, tmp_path):
    from scripts import export_to_tripweaver as exporter
    async def check(factory):
        monkeypatch.setattr(exporter, 'SessionFactory', factory)
        async with factory() as session:
            p, note, _, decision = await seed(session, desc=QUOTE + '\n爱心红绿灯游览75分钟。')
            original = copy.deepcopy(await load_mention_rows(session, p.city))
            before = await load_catalog(session, p.city)
            await session.commit()
        async def export(label):
            dest = tmp_path / f'{label}.json'
            monkeypatch.setattr(sys, 'argv', ['export_to_tripweaver.py', '--city', p.city, '--out', str(dest)])
            await exporter.main(); return json.loads(dest.read_text(encoding='utf-8'))
        old = await export('before')
        assert '夹心胡同' in json.dumps(old, ensure_ascii=False)
        async with factory() as session:
            result = await apply_scope_decision(session, decision)
            assert result == await apply_scope_decision(session, decision)
            cat = await load_mention_catalog(session, p.city)
            resolved = cat.resolve(original[0]); assert resolved['status'] == 'resolved'
            assert resolved['factExclusions'] == decision['assignments'][0]['factExclusions']
            projected = effective_mention(original[0], resolved)
            assert projected['reason'] is None and projected['evidence_text'] is None
            assert projected['fact_value'] == {'minutes': 75}
            assert original == await load_mention_rows(session, p.city)
            await session.commit()
        after = await export('after'); item = after['places'][0]
        assert item['id'] == old['places'][0]['id'] and item['name'] == NAME and item['verified']
        assert item['payload']['typicalVisitMinutes'] == 75 and item['payload']['mentionCount'] == 1
        assert item['payload']['mentionSources'][0]['inputHash'] == mention_fingerprint(original[0])
        assert item['payload']['topReasons'] == [] and item['payload']['content']['intro'] == ''
        assert '夹心胡同' not in json.dumps(item, ensure_ascii=False)
        async with factory() as session:
            await rollback_decision(session, decision['key'])
            cat = await load_catalog(session, p.city)
            assert cat.entities == before.entities and cat.members == before.members
            assert original == await load_mention_rows(session, p.city)
            assert not (await load_mention_catalog(session, p.city)).scopes
            await session.commit()
        restored = await export('restored')
        assert restored['places'][0]['payload']['content'] == old['places'][0]['payload']['content']
    run(check)


@pytest.mark.parametrize('case', ['missing_anchor', 'null_anchor', 'unknown_kind', 'unknown_key', 'wrong_subject',
    'wrong_qualifier', 'fragment', 'nonstring', 'newline_part', 'empty_part', 'unavailable', 'fake_quote',
    'wrong_road', 'cross_line', 'cross_sentence', 'clipped_prefix', 'clipped_suffix', 'duplicate_heading',
    'duplicate_title', 'distributed_words', 'stale_input'])
def test_限定标题错误主体与截断引用拒绝且不写入(case):
    async def check(factory):
        async with factory() as session:
            desc, quote = QUOTE, QUOTE
            if case == 'wrong_road': desc = quote = QUOTE.replace('经三路', '纬三路')
            elif case == 'cross_line': desc = quote = QUOTE.replace('：', '：\n')
            elif case == 'cross_sentence': desc = quote = QUOTE.replace('：', '。位置是')
            elif case == 'clipped_prefix': desc, quote = '非爱心红绿灯：经三路，别处', '爱心红绿灯：经三路'
            elif case == 'clipped_suffix': desc, quote = '爱心红绿灯：经三路东段，别处', '爱心红绿灯：经三路'
            elif case == 'duplicate_heading': desc = QUOTE + '\n' + QUOTE
            elif case == 'distributed_words': desc = quote = '经三路有很多店。别处的爱心红绿灯值得看。'
            p, note, mention, decision = await seed(session, desc, quote)
            if case == 'duplicate_title': note.title = QUOTE
            if case == 'unavailable': note.status = 'PRIVATE'
            if case == 'stale_input': note.desc += '已变更'
            for item in decision['assignments'][0]['factExclusions'].values():
                if case == 'missing_anchor': del item['subjectAnchor']
                elif case == 'null_anchor': item['subjectAnchor'] = None
                elif case == 'unknown_kind': item['subjectAnchor']['kind'] = 'contains'
                elif case == 'unknown_key': item['subjectAnchor']['extra'] = True
                elif case == 'wrong_subject': item['subjectAnchor']['subject'] = '夹心胡同'
                elif case == 'wrong_qualifier': item['subjectAnchor']['qualifier'] = '纬三路'
                elif case == 'fragment': item['subjectAnchor']['subject'] = '红绿灯'
                elif case == 'nonstring': item['subjectAnchor']['subject'] = ['爱心红绿灯']
                elif case == 'newline_part': item['subjectAnchor']['qualifier'] = '经三\n路'
                elif case == 'empty_part': item['subjectAnchor']['subject'] = ''
                elif case == 'fake_quote': item['quote'] = '爱心红绿灯：经三路，正文没有'
            await session.flush()
            if case in ['duplicate_title', 'unavailable']:
                decision['assignments'][0]['inputHash'] = mention_fingerprint((await load_mention_rows(session, p.city))[0])
            before = (await load_catalog(session, p.city)).entities
            with pytest.raises(ValueError): await apply_scope_decision(session, decision)
            assert (await load_catalog(session, p.city)).entities == before
            assert not (await load_mention_catalog(session, p.city)).scopes
    run(check)


def test_已存限定标题篡改和正文更新分别重新待审():
    async def check(factory):
        async with factory() as session:
            p, note, mention, decision = await seed(session)
            await apply_scope_decision(session, decision)
            original = (await load_mention_rows(session, p.city))[0]
            assignment = await session.scalar(select(PlaceMentionAssignment).where(PlaceMentionAssignment.mention_id == mention.id))
            changed = copy.deepcopy(assignment.fact_exclusions)
            changed['reason']['subjectAnchor']['qualifier'] = '纬三路'
            assignment.fact_exclusions = changed; await session.flush()
            result = (await load_mention_catalog(session, p.city)).resolve(original)
            assert result['status'] == 'review' and result['reason'] == 'invalid_fact_exclusions'
            assert effective_mention(original, result)['fact_value'] == {}
            assignment.fact_exclusions = decision['assignments'][0]['factExclusions']
            note.desc += '正文变化'; await session.flush()
            result = (await load_mention_catalog(session, p.city)).resolve((await load_mention_rows(session, p.city))[0])
            assert result['reason'] == 'changed_input'
    run(check)


@pytest.mark.parametrize('quote', ['爱心红绿灯:经三路', '•爱心红绿灯 ： 经三路。', QUOTE])
def test_连续标题允许明确分隔符但不授予新名(quote):
    row = {'name': NAME, 'normalized_name': NAME, 'note_desc': quote, 'note_title': '拍摄清单', 'reason': '错误主体'}
    decision = {'reason': {'reason': 'subject_mismatch', 'quote': quote, 'subjectAnchor': ANCHOR}}
    assert validate_fact_exclusions(decision, row, 'existing-id') == decision
    assert row['name'] == NAME


def test_无效可选引用不能借正文已有原名退回通过():
    row = {'name': NAME, 'normalized_name': NAME, 'note_desc': NAME, 'reason': '错误主体'}
    with pytest.raises(ValueError):
        validate_fact_exclusions({'reason': {'reason': 'subject_mismatch', 'quote': NAME, 'subjectAnchor': None}}, row, 'id')
