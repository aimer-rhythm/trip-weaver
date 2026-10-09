"""真实SQL验证按字段排除组合时长，保留单点身份、描述、关系与原始指纹。"""
from __future__ import annotations
import copy
import json
import os
import sys
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import select, text
from app.aggregate.mention_identity import apply_scope_decision, load_mention_catalog, load_mention_rows, refresh_mention_reviews
from app.aggregate.place_identity import bootstrap, load_catalog, rollback_decision
from app.aggregate.summary import mention_groups
from app.clean.mention_identity import effective_fact_value, mention_fingerprint
from app.clean.scoped_place_export import scoped_facts
from app.models import CanonicalPlace, PlaceEntityReview, PlaceMention, PlaceMentionAssignment, PlaceSummary, RawNote
from test_mention_identity_db import run, request

QUOTE = '甲泉、乙泉、丙泉、丁泉合计游玩30分钟。'
EXCLUSION = {'visit_duration': {'reason': 'group_duration', 'quote': QUOTE}}

async def seed(session):
    city = '字段时长' + uuid4().hex[:10]
    note = RawNote(city=city, note_id=uuid4().hex, keyword='泉水', title='五处泉水',
        desc=QUOTE + '\n沿着老街看泉水。\n戊泉单独游玩75分钟。\n'
            + '\n'.join(name + '泉水清澈' for name in ['甲泉', '乙泉', '丙泉', '丁泉', '戊泉']),
        source_url='https://example.com/springs', status='EXTRACTED')
    other = RawNote(city=city, note_id=uuid4().hex, keyword='泉水', title='甲泉单独游览',
        desc='甲泉单独游玩45分钟。', source_url='https://example.com/single-spring', status='EXTRACTED')
    places = [CanonicalPlace(city=city, name=name, normalized_name=name, is_active=True,
        geo_status='resolved', latitude=36.66 + i * .001, longitude=117.02, quality_score=20,
        place_type='attraction', typical_visit_minutes=30 if i < 4 else 75, typical_visit_source='xhs_median')
        for i, name in enumerate(['甲泉', '乙泉', '丙泉', '丁泉', '戊泉'])]
    session.add_all([note, other, *places]); await session.flush()
    await bootstrap(session, city)
    for i, place in enumerate(places):
        session.add(PlaceMention(raw_note_id=note.id, name=place.name, normalized_name=place.name,
            place_type='attraction', mention_type='recommend', reason=place.name + '泉水清澈',
            evidence_text=QUOTE if i < 4 else '戊泉单独游玩75分钟。', confidence=.95,
            fact_type='visit_duration', fact_value={'minutes': 30 if i < 4 else 75,
                'placeContent': {'version': 1, 'highlights': [{'text': place.name + '泉水清澈', 'quote': place.name + '泉水清澈'}]}}))
        session.add(PlaceSummary(canonical_place_id=place.id, mention_count_30d=2 if i == 0 else 1, recommend_score=10))
    session.add(PlaceMention(raw_note_id=other.id, name='甲泉', normalized_name='甲泉', place_type='attraction',
        mention_type='recommend', reason='甲泉独立游览', evidence_text=other.desc, confidence=.95,
        fact_type='visit_duration', fact_value={'minutes': 45}))
    await session.flush()
    return places, note

async def decision_for(session, place, *, exclude=True):
    catalog = await load_mention_catalog(session, place.city)
    rows = [r for r in await load_mention_rows(session, place.city) if r['name'] == place.name]
    eid = catalog.catalog.resolve(place_id=place.id)['entity_id']
    decision = await request(session, place, [eid] * len(rows), key=uuid4().hex)
    if exclude:
        decision['assignments'][0]['factExclusions'] = copy.deepcopy(EXCLUSION)
    return decision

def test_字段排除保留单点与独立时长_幂等及倒序回滚():
    async def check(factory):
        async with factory() as session:
            places, _ = await seed(session); city = places[0].city
            original = copy.deepcopy(await load_mention_rows(session, city))
            before = copy.deepcopy((await load_catalog(session, city)).entities)
            decisions = []
            for place in places[:4]:
                d = await decision_for(session, place); decisions.append(d)
                after = await apply_scope_decision(session, d)
                assert await apply_scope_decision(session, d) == after
                assert after['assignments'][0]['fact_exclusions'] == EXCLUSION
            catalog = await load_mention_catalog(session, city)
            assert all(catalog.resolve(r)['status'] == 'resolved' for r in original)
            groups = mention_groups(city, catalog, original)
            by_name = {g['name']: g for g in groups.values()}
            assert [by_name[p.name]['durations'] for p in places] == [[45], [], [], [], [75]]
            assert [by_name[p.name]['mentions'] for p in places] == [2, 1, 1, 1, 1]
            for place in places[:4]:
                entity = catalog.catalog.resolve(place_id=place.id)
                rows = [r for r in original if r['name'] == place.name]
                facts, evidence = scoped_facts(entity, rows, '', [], mention_catalog=catalog)
                assert facts.get('typicalVisitMinutes') == (45 if place.name == '甲泉' else None)
                assert facts['mentionCount'] == len(rows) and len(evidence) == len(rows)
                assert place.name + '泉水清澈' in facts['content']['intro']
                assert facts['mentionSources'][0]['inputHash'] == mention_fingerprint(rows[0])
            restored = await decision_for(session, places[1], exclude=False)
            await apply_scope_decision(session, restored)
            current = await load_mention_catalog(session, city)
            row = next(r for r in original if r['name'] == '乙泉')
            assert effective_fact_value(row, current.resolve(row))['minutes'] == 30
            with pytest.raises(ValueError, match='后续'):
                await rollback_decision(session, decisions[1]['key'])
            await rollback_decision(session, restored['key'])
            for d in reversed(decisions): await rollback_decision(session, d['key'])
            assert (await load_catalog(session, city)).entities == before
            assert not (await load_mention_catalog(session, city)).scopes
            assert await load_mention_rows(session, city) == original
    run(check)

@pytest.mark.parametrize('invalid', ['null_target', 'field', 'reason', 'extra', 'empty', 'quote', 'other_subject', 'missing_minutes', 'bool_minutes', 'type', 'unavailable', 'stale', 'mixed_exclusion'])
def test_字段审核必须匹配当前事实及原文(invalid):
    async def check(factory):
        async with factory() as session:
            places, note = await seed(session); place = places[1]
            d = await decision_for(session, place); a = d['assignments'][0]
            if invalid == 'null_target': a['entityId'] = None
            elif invalid == 'field': a['factExclusions']['price'] = a['factExclusions'].pop('visit_duration')
            elif invalid == 'reason': a['factExclusions']['visit_duration']['reason'] = 'unknown'
            elif invalid == 'extra': a['factExclusions']['visit_duration']['minutes'] = 7.5
            elif invalid == 'empty': a['factExclusions'] = {}
            elif invalid == 'quote': a['factExclusions']['visit_duration']['quote'] = '乙泉不需要半小时'
            elif invalid == 'other_subject': a['factExclusions']['visit_duration']['quote'] = '戊泉单独游玩75分钟。'
            elif invalid in ('missing_minutes', 'bool_minutes', 'type'):
                m = await session.get(PlaceMention, a['mentionId'])
                if invalid == 'type': m.fact_type = 'price'
                else: m.fact_value = {} if invalid == 'missing_minutes' else {'minutes': True}
                await session.flush()
                a['inputHash'] = mention_fingerprint((await load_mention_rows(session, place.city, [m.id]))[0])
            elif invalid == 'unavailable':
                note.status = 'PRIVATE'; await session.flush()
                a['inputHash'] = mention_fingerprint((await load_mention_rows(session, place.city, [a['mentionId']]))[0])
            elif invalid == 'stale': note.desc += '更新'; await session.flush()
            elif invalid == 'mixed_exclusion': a['exclusion'] = {'reason': 'not_a_place', 'quote': QUOTE}
            baseline = copy.deepcopy((await load_catalog(session, place.city)).entities)
            with pytest.raises(ValueError): await apply_scope_decision(session, d)
            assert (await load_catalog(session, place.city)).entities == baseline
            assert not (await load_mention_catalog(session, place.city)).scopes
    run(check)

def test_原文变化新提及及非法持久化策略重新待审():
    async def check(factory):
        async with factory() as session:
            places, note = await seed(session); place = places[1]; city = place.city
            d = await decision_for(session, place); await apply_scope_decision(session, d)
            row = (await load_mention_rows(session, city, [d['assignments'][0]['mentionId']]))[0]
            assignment = await session.scalar(select(PlaceMentionAssignment).where(PlaceMentionAssignment.mention_id == row['id']))
            assignment.fact_exclusions = {'visit_duration': {'reason': 'arbitrary', 'quote': QUOTE}}
            await session.flush(); await refresh_mention_reviews(session, city)
            catalog = await load_mention_catalog(session, city)
            assert catalog.resolve(row)['reason'] == 'invalid_fact_exclusions'
            assignment.fact_exclusions = EXCLUSION; await session.flush()
            session.add(PlaceMention(raw_note_id=note.id, name=place.name, normalized_name=place.name, reason='新提及'))
            await session.flush(); await refresh_mention_reviews(session, city)
            catalog = await load_mention_catalog(session, city)
            rows = [r for r in await load_mention_rows(session, city) if r['name'] == place.name]
            assert [catalog.resolve(r)['status'] for r in rows] == ['resolved', 'review']
            note.desc += '\n现在有独立游览新信息。'; await session.flush(); await refresh_mention_reviews(session, city)
            catalog = await load_mention_catalog(session, city)
            rows = [r for r in await load_mention_rows(session, city) if r['name'] == place.name]
            assert [catalog.resolve(r)['reason'] for r in rows] == ['changed_input', 'unreviewed_mention']
            assert len((await session.scalars(select(PlaceEntityReview).where(PlaceEntityReview.city == city, PlaceEntityReview.status == 'PENDING'))).all()) == 2
    run(check)

def test_迁移仅加可空列_旧审计不改写且可回滚():
    from scripts.migrate_place_identity import migrate
    async def check(factory):
        async with factory() as session:
            places, _ = await seed(session); city = places[1].city
            old = await decision_for(session, places[1], exclude=False)
            after = await apply_scope_decision(session, old)
            assert 'fact_exclusions' not in after['assignments'][0]
            await session.commit()
        async with factory.kw['bind'].begin() as connection:
            await connection.execute(text('ALTER TABLE place_mention_assignment DROP COLUMN fact_exclusions'))
            assert (await migrate(connection, False))['missingColumns'] == ['place_mention_assignment.fact_exclusions']
            await migrate(connection, True); assert (await migrate(connection, False))['missingColumns'] == []
        async with factory() as session:
            assert all('fact_exclusions' not in a for a in (await load_mention_catalog(session, city)).assignments.values())
            await rollback_decision(session, old['key'])
    run(check)

def test_真实导出不恢复旧30分钟_四主体及关系原指纹保持(monkeypatch, tmp_path):
    from scripts import export_to_tripweaver as exporter
    async def check(factory):
        async with factory() as session:
            places, _ = await seed(session); city = places[0].city
            original = copy.deepcopy(await load_mention_rows(session, city))
            decisions = [await decision_for(session, place) for place in places[:4]]
            ids = [next(iter(d['expectedRevisions'])) for d in decisions]
            await session.commit()
        monkeypatch.setattr(exporter, 'SessionFactory', factory)
        directory = Path(os.environ.get('FACT_FIXTURE_DIR') or tmp_path)
        async def export(label):
            dest = directory / f'xhs-places-{label}.json'
            monkeypatch.setattr(sys, 'argv', ['export_to_tripweaver.py', '--city', city, '--out', str(dest)])
            await exporter.main()
            return json.loads(dest.read_text(encoding='utf-8'))
        before = await export('before')
        async with factory() as session:
            for d in decisions: await apply_scope_decision(session, d)
            await session.commit()
        after = await export('after')
        assert len(after['places']) == len(before['places']) == 5
        for p in after['places']:
            assert p['verified'] is True and 'identityWithdrawal' not in p['payload']
            assert p['payload'].get('typicalVisitMinutes') == (45 if p['name'] == '甲泉' else 75 if p['name'] == '戊泉' else None)
            if p['id'] in ids:
                assert p['payload']['mentionCount'] == (2 if p['name'] == '甲泉' else 1)
                assert p['payload']['identity']['revision'] == 2
        state = after['relationIdentity']['sourceState']['mentions']
        for m in original:
            bound = next(r for r in state if r['mentionId'] == m['id'])
            assert bound['status'] == 'resolved' and bound['inputHash'] == mention_fingerprint(m)
        async with factory() as session:
            assert await load_mention_rows(session, city) == original
            assert [(await session.get(CanonicalPlace, p.id)).typical_visit_minutes for p in places] == [30, 30, 30, 30, 75]
            for d in reversed(decisions): await rollback_decision(session, d['key'])
            await session.commit()
        reverted = await export('rollback')
        assert [p['payload'].get('typicalVisitMinutes') for p in reverted['places']] == [p['payload'].get('typicalVisitMinutes') for p in before['places']]
        if os.environ.get('FACT_FIXTURE_DIR'):
            (directory / 'report.json').write_text(json.dumps({'city': city, 'governedIds': ids,
                'before': 'xhs-places-before.json', 'after': 'xhs-places-after.json',
                'rollback': 'xhs-places-rollback.json', 'rawMentionsUnchanged': len(original), 'failures': []}, ensure_ascii=False, indent=2), encoding='utf-8')
    run(check)
