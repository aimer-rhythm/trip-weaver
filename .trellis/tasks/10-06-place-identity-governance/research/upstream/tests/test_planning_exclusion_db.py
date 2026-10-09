"""静态组合排除的真实数据库决定、导出、幂等与恢复回滚。"""
from __future__ import annotations

import copy
import json
import sys
from uuid import uuid4

import pytest

from app.clean import alias
from app.aggregate.mention_identity import apply_scope_decision
from app.aggregate.place_identity import apply_decision, bootstrap, load_catalog, rollback_decision
from app.models import CanonicalPlace, PlaceMention, PlaceSummary, RawNote
from test_mention_identity_db import request, run


@pytest.mark.parametrize('child_pending', [True, False])
def test_逐提及先处置后排除_实际导出和恢复回滚一致(monkeypatch, tmp_path, child_pending):
    from scripts import export_to_tripweaver as exporter

    async def check(factory):
        city = '组合排除' + uuid4().hex[:8]
        monkeypatch.setitem(alias._PLANNING_GROUPS, city, {'锦里': ('锦里古街主巷',)})
        monkeypatch.setattr(exporter, 'SessionFactory', factory)
        out = tmp_path / 'planning-exclusion.json'

        async def exported():
            monkeypatch.setattr(sys, 'argv', ['export_to_tripweaver.py', '--city', city, '--out', str(out)])
            await exporter.main()
            places = json.loads(out.read_text(encoding='utf-8'))['places']
            assert len(places) == 1
            places[0]['payload'].get('content', {}).pop('compiledAt', None)
            return places[0]

        async with factory() as session:
            source = CanonicalPlace(city=city, name='锦里', normalized_name='锦里', place_type='market',
                                    latitude=30.64, longitude=104.04, is_active=True, quality_score=30)
            note = RawNote(city=city, note_id=uuid4().hex, keyword='夜游', title='锦里路线',
                           desc='锦里夜景可顺路看；锦里古街主巷是路线一站，入口和小吃巷分开。',
                           source_url='https://example.com/jinli', status='EXTRACTED')
            session.add_all([source, note])
            await session.flush()
            await bootstrap(session, city)
            entity = (await load_catalog(session, city)).resolve(place_id=source.id)
            eid = entity['entity_id']
            mentions = [PlaceMention(raw_note_id=note.id, name=name, normalized_name='锦里', place_type='market',
                                     mention_type='recommend', reason=reason, evidence_text=reason, confidence=.95)
                        for name, reason in [('锦里', '锦里夜景可顺路看'), ('锦里古街主巷', '锦里古街主巷是路线一站')]]
            session.add_all([*mentions, PlaceSummary(canonical_place_id=source.id, mention_count_30d=2, recommend_score=10)])
            await session.flush()
            original = [(m.id, m.name, m.normalized_name, m.reason, m.evidence_text) for m in mentions]
            original_note = (note.title, note.desc, note.img_analysis, note.created_at, note.publish_time)
            exclusion = {'key': city+'-exclude', 'city': city, 'entityId': eid,
                         'excludeNames': [' 锦里 古街主巷 '], 'expectedRevisions': {eid: 1},
                         'evidence': [{'source': '已核对原文：主巷不是整街同义名'}]}
            with pytest.raises(ValueError):
                await apply_decision(session, exclusion)
            scope = await request(session, source, [eid, None if child_pending else eid], key=city+'-scope')
            scope_result = await apply_scope_decision(session, scope)
            assert await apply_scope_decision(session, scope) == scope_result
            await session.commit()
        before = await exported()
        assert '锦里古街主巷' not in before['payload']['identity']['memberNames']
        async with factory() as session:
            current = (await load_catalog(session, city)).root(eid)
            exclusion['expectedRevisions'] = {eid: current['revision']}
            if child_pending:
                with pytest.raises(ValueError, match='未分配、过期或其他实体'):
                    await apply_decision(session, exclusion)
                await rollback_decision(session, city+'-scope')
                await session.commit()
                restored_unscoped = await exported()
                assert '锦里古街主巷' in restored_unscoped['payload']['identity']['memberNames']
                return
            result = await apply_decision(session, exclusion)
            assert await apply_decision(session, exclusion) == result
            with pytest.raises(ValueError, match='版本'):
                await apply_decision(session, {**exclusion, 'key': city+'-outdated-exclude'})
            await session.commit()
        after = await exported()
        assert '锦里古街主巷' not in after['payload']['identity']['memberNames']
        assert 'identityExcludedNames' not in after['payload']
        expected = copy.deepcopy(before)
        expected['payload']['identity']['revision'] += 1
        expected['payload']['imageIdentity']['revision'] += 1
        assert after == expected, '仅版本和已排除的母项名称变化，旧ID/图片字段/语料/位置保持'
        async with factory() as session:
            current = (await load_catalog(session, city)).root(eid)
            await apply_decision(session, {'key': city+'-restore', 'city': city, 'entityId': eid,
                'restoreNames': ['锦里古街主巷'], 'expectedRevisions': {eid: current['revision']},
                'evidence': [{'source': '合成夹具验证显式恢复，不是实际地点决定'}]})
            await session.commit()
        restored = await exported()
        assert '锦里古街主巷' in restored['payload']['identity']['memberNames']
        async with factory() as session:
            await rollback_decision(session, city+'-restore')
            await session.commit()
        assert await exported() == after
        async with factory() as session:
            await rollback_decision(session, city+'-exclude')
            await session.commit()
        assert await exported() == before
        async with factory() as session:
            await rollback_decision(session, city+'-scope')
            for old in original:
                current = await session.get(PlaceMention, old[0])
                assert (current.id, current.name, current.normalized_name, current.reason, current.evidence_text) == old
            current_note = await session.get(RawNote, note.id)
            assert (current_note.title, current_note.desc, current_note.img_analysis, current_note.created_at, current_note.publish_time) == original_note
            await session.commit()

    run(check)
