"""字段主语错误的真实SQL回归：保留主体、原文、有效字段和可逆版本。"""
import copy
import json
import os
import sys
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import select
from app.aggregate.mention_identity import apply_scope_decision, load_mention_catalog, load_mention_rows
from app.aggregate.place_identity import bootstrap, load_catalog, rollback_decision
from app.aggregate.summary import mention_groups
from app.clean.mention_identity import effective_mention, mention_fingerprint
from app.clean.scoped_place_export import scoped_binding, scoped_facts
from app.models import CanonicalPlace, CanonicalPlaceSource, PlaceMention, PlaceMentionAssignment, PlaceSummary, RawNote
from test_mention_identity_db import run, request


async def seed(session):
    city = '描述字段' + uuid4().hex[:10]
    names = ['甲古城', '乙野生动物园', '丙古城']
    note = RawNote(city=city, note_id=uuid4().hex, keyword='景点', title='三处游览',
        desc='甲古城、乙野生动物园、丙古城各自独立。整座城市泉水泡茶。\n乙野生动物园建议游玩75分钟。\n丙古城砖墙保存完整。',
        source_url='https://example.com/description', status='EXTRACTED')
    places = [CanonicalPlace(city=city, name=name, normalized_name=name, place_type='attraction',
        geo_status='resolved', is_active=True, latitude=36.6 + i * .001, longitude=117.02, quality_score=20,
        content_profile={'profileVersion': 1, 'qualityVersion': 2, 'intro': '整座城市泉水泡茶的旧介绍'})
        for i, name in enumerate(names)]
    session.add_all([note, *places]); await session.flush(); await bootstrap(session, city)
    for i, p in enumerate(places):
        session.add(PlaceMention(raw_note_id=note.id, name=p.name, normalized_name=p.name, place_type='attraction',
            mention_type='recommend', confidence=.95, reason=['整座城市泉水泡茶是旅行看点', '乙动物园的园区适合拍照游览', '丙古城砖墙保存完整'][i],
            evidence_text=['整座城市泉水泡茶', '乙野生动物园建议游玩75分钟。', '丙古城砖墙保存完整。'][i],
            fact_type='visit_duration' if i == 1 else None,
            fact_value={'minutes': 75} if i == 1 else {'placeContent': {'version': 1, 'highlights': [
                {'text': '整座城市泉水泡茶', 'quote': '整座城市泉水泡茶'}]}}))
        session.add(PlaceSummary(canonical_place_id=p.id, mention_count_30d=1, recommend_score=10,
            top_reasons=[{'reason': '整座城市泉水泡茶的旧聚合'}]))
        session.add(CanonicalPlaceSource(canonical_place_id=p.id, source_type='xhs',
            source_url=note.source_url, source_name='旧来源摘要', evidence_summary='整座城市泉水泡茶的旧聚合'))
    await session.flush()
    return places, note


async def decision(session, place, fields):
    cat = await load_mention_catalog(session, place.city)
    eid = cat.catalog.resolve(place_id=place.id)['entity_id']
    d = await request(session, place, [eid], key=uuid4().hex)
    if fields:
        d['assignments'][0]['factExclusions'] = {field: {'reason': 'subject_mismatch',
            'quote': '甲古城、乙野生动物园、丙古城各自独立。整座城市泉水泡茶。'} for field in fields}
    return d


def test_逐字段独立排除保留身份时长原指纹并使旧介绍失效(monkeypatch):
    from app.extract import place_profiles
    from app.aggregate import summary
    async def check(factory):
        monkeypatch.setattr(place_profiles, 'SessionFactory', factory)
        monkeypatch.setattr(summary, 'SessionFactory', factory)
        async with factory() as session:
            places, _ = await seed(session); city = places[0].city
            original = copy.deepcopy(await load_mention_rows(session, city))
            # 先生成旧的受控介绍绑定，再修改字段策略；相同原文哈希不能复活旧版本介绍。
            old = await decision(session, places[0], [])
            await apply_scope_decision(session, old)
            cat = await load_mention_catalog(session, city)
            stale = {**places[0].content_profile, 'identityBinding': scoped_binding(cat.catalog.resolve(place_id=places[0].id), [original[0]])}
            places[0].content_profile = stale
            ds = [await decision(session, p, fields) for p, fields in zip(places,
                [('reason', 'evidence_text', 'place_content'), ('reason',), ('place_content',)])]
            for d in ds:
                result = await apply_scope_decision(session, d)
                assert result == await apply_scope_decision(session, d)
            cat = await load_mention_catalog(session, city)
            for i, p in enumerate(places):
                row = original[i]; resolved = cat.resolve(row)
                assert resolved['status'] == 'resolved'
                projected = effective_mention(row, resolved)
                assert projected['id'] == row['id']
                payload, evidence = scoped_facts(cat.catalog.resolve(place_id=p.id), [row], '', [],
                    profile=p.content_profile, mention_catalog=cat)
                assert payload['mentionSources'][0]['inputHash'] == mention_fingerprint(row)
                assert payload['mentionCount'] == 1
                assert payload['content']['intro'] == ''  # 丙不能从同提及reason兜底恢复被排除的整块内容。
                if i == 0:
                    assert projected['reason'] is None and projected['evidence_text'] is None
                    assert payload['topReasons'] == [] and evidence == []
                elif i == 1:
                    assert projected['evidence_text'] == row['evidence_text']
                    assert payload['typicalVisitMinutes'] == 75
                    assert evidence == [] and payload['topReasons'] == []
                else:
                    assert projected['reason'] == row['reason'] and projected['evidence_text'] == row['evidence_text']
                    assert evidence[0]['content'] == row['reason'] and payload['topReasons'] == [row['reason']]
            assert original == await load_mention_rows(session, city)
            groups = list(mention_groups(city, cat, original).values())
            assert [g['mentions'] for g in groups] == [1, 1, 1]
            assert [g['reasons'] for g in groups[:2]] == [[], []]
            await session.commit()
        assert await place_profiles.load_sources(city, places[0].name) == []
        kept = await place_profiles.load_sources(city, places[1].name)
        assert len(kept) == 1 and kept[0]['text'] == original[1]['evidence_text']
        async with factory() as session:
            for d in reversed(ds): await rollback_decision(session, d['key'])
            restored = await load_mention_catalog(session, city)
            payload, _ = scoped_facts(restored.catalog.resolve(place_id=places[0].id), [original[0]], '', [],
                profile=stale, mention_catalog=restored)
            assert payload['content']['intro'] == stale['intro']
            # 旧scope后曾写介绍，回滚不得跨过该写入；本次字段决定已完整逆序恢复。
            with pytest.raises(ValueError, match='后续'):
                await rollback_decision(session, old['key'])
            assert original == await load_mention_rows(session, city)
    run(check)


@pytest.mark.parametrize('case', ['empty', 'unknown', 'wrong_reason', 'replacement', 'missing_reason',
    'missing_evidence', 'missing_content', 'null_target', 'wrong_quote', 'other_subject', 'stale', 'mixed'])
def test_描述字段策略拒绝非法或不匹配原文(case):
    async def check(factory):
        async with factory() as session:
            places, note = await seed(session); p = places[0]
            d = await decision(session, p, ['reason', 'evidence_text', 'place_content']); a = d['assignments'][0]
            if case == 'empty': a['factExclusions'] = {}
            elif case == 'unknown': a['factExclusions']['intro'] = a['factExclusions'].pop('place_content')
            elif case == 'wrong_reason': a['factExclusions']['reason']['reason'] = 'group_duration'
            elif case == 'replacement': a['factExclusions']['reason']['text'] = '新的推荐理由'
            elif case == 'null_target': a['entityId'] = None
            elif case == 'wrong_quote': a['factExclusions']['reason']['quote'] = '甲古城原文没有这一句'
            elif case == 'other_subject': a['factExclusions']['reason']['quote'] = '丙古城砖墙保存完整。'
            elif case == 'stale': note.desc += '原文变化'; await session.flush()
            elif case == 'mixed': a['exclusion'] = {'reason': 'not_a_place', 'quote': note.desc}
            else:
                m = await session.get(PlaceMention, a['mentionId'])
                if case == 'missing_content': m.fact_value = {}
                elif case == 'missing_reason': m.reason = None
                else: m.evidence_text = ''
                await session.flush()
                a['inputHash'] = mention_fingerprint((await load_mention_rows(session, p.city, [m.id]))[0])
            before = (await load_catalog(session, p.city)).entities
            with pytest.raises(ValueError): await apply_scope_decision(session, d)
            assert (await load_catalog(session, p.city)).entities == before
            assert not (await load_mention_catalog(session, p.city)).scopes
    run(check)


def test_描述非法持久策略与原文变化都重新待审():
    async def check(factory):
        async with factory() as session:
            places, note = await seed(session); p = places[0]
            d = await decision(session, p, ['reason']); await apply_scope_decision(session, d)
            row = (await load_mention_rows(session, p.city))[0]
            assignment = await session.scalar(select(PlaceMentionAssignment).where(PlaceMentionAssignment.mention_id == row['id']))
            assignment.fact_exclusions = {'reason': {'reason': 'invalid', 'quote': note.desc}}
            await session.flush()
            cat = await load_mention_catalog(session, p.city)
            assert cat.resolve(row)['reason'] == 'invalid_fact_exclusions'
            assert effective_mention(row, cat.resolve(row))['reason'] is None
            assignment.fact_exclusions = d['assignments'][0]['factExclusions']
            note.desc += '新版正文'; await session.flush()
            cat = await load_mention_catalog(session, p.city)
            row = (await load_mention_rows(session, p.city))[0]
            assert cat.resolve(row)['reason'] == 'changed_input'
    run(check)


def test_实际摘要刷新不恢复被排除理由且保留提及数(monkeypatch):
    from app.aggregate import summary
    async def check(factory):
        monkeypatch.setattr(summary, 'SessionFactory', factory)
        async with factory() as session:
            places, _ = await seed(session); city = places[0].city
            for p in places[:2]: await apply_scope_decision(session, await decision(session, p, ['reason']))
            await session.commit()
        await summary.refresh_summary(city)
        async with factory() as session:
            rows = (await session.scalars(select(PlaceSummary).where(PlaceSummary.canonical_place_id.in_([p.id for p in places])).order_by(PlaceSummary.canonical_place_id))).all()
            assert [s.mention_count_30d for s in rows] == [1, 1, 1]
            assert [s.top_reasons for s in rows[:2]] == [[], []]
            assert rows[2].top_reasons[0]['reason'] == '丙古城砖墙保存完整'
    run(check)


def test_真实导出清理描述保留独立事实及倒序恢复(monkeypatch, tmp_path):
    from scripts import export_to_tripweaver as exporter
    async def check(factory):
        monkeypatch.setattr(exporter, 'SessionFactory', factory)
        async with factory() as session:
            places, _ = await seed(session); city = places[0].city
            original = copy.deepcopy(await load_mention_rows(session, city))
            ds = [await decision(session, p, fields) for p, fields in zip(places,
                [('reason', 'evidence_text', 'place_content'), ('reason',), ('place_content',)])]
            await session.commit()
        directory = Path(os.environ.get('DESCRIPTION_FIXTURE_DIR') or tmp_path)
        async def export(label):
            dest = directory / f'xhs-places-{label}.json'
            monkeypatch.setattr(sys, 'argv', ['export_to_tripweaver.py', '--city', city, '--out', str(dest)])
            await exporter.main()
            return json.loads(dest.read_text(encoding='utf-8'))
        before = await export('before')
        # 旧语料须实际达到普通导出的长度门槛，才能验证下游删除已存的错误语料。
        assert any('整座城市' in e['content'] for p in before['places'] for e in p['evidence'])
        assert any('乙动物园' in e['content'] for p in before['places'] for e in p['evidence'])
        async with factory() as session:
            for d in ds: await apply_scope_decision(session, d)
            await session.commit()
        after = await export('after')
        assert len(before['places']) == len(after['places']) == 3
        for p in after['places']:
            assert p['verified'] and p['payload']['mentionCount'] == 1
            assert p['payload']['content']['intro'] == ''
            assert '整座城市' not in json.dumps(p, ensure_ascii=False)
            assert '乙动物园' not in json.dumps(p, ensure_ascii=False)
            assert p['payload'].get('typicalVisitMinutes') == (75 if p['name'] == '乙野生动物园' else None)
        async with factory() as session:
            for d in reversed(ds): await rollback_decision(session, d['key'])
            assert await load_mention_rows(session, city) == original
            await session.commit()
        reverted = await export('rollback')
        assert [p['payload'].get('content') for p in reverted['places']] == [p['payload'].get('content') for p in before['places']]
        if os.environ.get('DESCRIPTION_FIXTURE_DIR'):
            (directory / 'report.json').write_text(json.dumps({'city': city, 'before': 'xhs-places-before.json',
                'after': 'xhs-places-after.json', 'rollback': 'xhs-places-rollback.json', 'failures': []}, ensure_ascii=False, indent=2), encoding='utf-8')
    run(check)
