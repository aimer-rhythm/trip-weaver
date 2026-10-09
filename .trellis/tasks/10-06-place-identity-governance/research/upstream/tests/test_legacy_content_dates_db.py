"""真实导出中旧reason和结构化看点都携带来源日期，重导出不刷新observedAt。"""
import copy
import json
import sys
from datetime import datetime, timezone
from uuid import uuid4

import pytest
from app.aggregate.place_identity import bootstrap, load_catalog
from app.aggregate.mention_identity import apply_scope_decision, load_mention_catalog, load_mention_rows
from app.clean.scoped_place_export import scoped_facts
from app.models import CanonicalPlace, PlaceMention, PlaceSummary, RawNote
from test_mention_identity_db import run, request


def test_真实重复导出保留两路径旧看点来源日期及结构化内容(monkeypatch, tmp_path):
    from scripts import export_to_tripweaver as exporter

    async def check(factory):
        city = '来源日期' + uuid4().hex[:10]
        original_at = datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc)
        async with factory() as session:
            places = []
            for i, name in enumerate(['普通旧园', '受控旧园', '普通新园', '受控新园']):
                reason = name + '保存着石桥和古树，沿湖步道连接庭院。'
                place = CanonicalPlace(city=city, name=name, normalized_name=name, place_type='attraction',
                    is_active=True, quality_score=20, geo_status='resolved', latitude=36.6 + i * .001, longitude=117.0)
                note = RawNote(city=city, note_id=uuid4().hex, keyword='园林', title=name, desc=reason,
                    source_url='https://example.com/garden/' + str(i), status='EXTRACTED', created_at=original_at)
                session.add_all([place, note]); await session.flush()
                content = {'version': 1, 'highlights': [{'text': reason[:-1], 'quote': reason}]} if i >= 2 else None
                session.add(PlaceMention(raw_note_id=note.id, name=name, normalized_name=name, place_type='attraction',
                    mention_type='recommend', confidence=.95, reason=reason, evidence_text=reason,
                    fact_value={'placeContent': content} if content else {}))
                session.add(PlaceSummary(canonical_place_id=place.id, mention_count_30d=1, recommend_score=10))
                places.append(place)
            await session.flush(); await bootstrap(session, city)
            for place in [places[1], places[3]]:
                eid = (await load_catalog(session, city)).resolve(place_id=place.id)['entity_id']
                await apply_scope_decision(session, await request(session, place, [eid], key=uuid4().hex))
            originals = copy.deepcopy(await load_mention_rows(session, city))
            cat = await load_mention_catalog(session, city)
            entities, assignments = copy.deepcopy(cat.catalog.entities), copy.deepcopy(cat.assignments)
            await session.commit()
        monkeypatch.setattr(exporter, 'SessionFactory', factory)
        exports = []
        for day in [8, 9]:
            class Clock(datetime):
                @classmethod
                def now(cls, tz=None):
                    return datetime(2026, 10, day, 12, tzinfo=timezone.utc)
            monkeypatch.setattr(exporter, 'datetime', Clock)
            output = tmp_path / f'places-{day}.json'
            monkeypatch.setattr(sys, 'argv', ['export_to_tripweaver.py', '--city', city, '--out', str(output)])
            await exporter.main()
            data = json.loads(output.read_text(encoding='utf-8'))
            assert len(data['places']) == 4
            for place in data['places']:
                content = place['payload']['content']
                assert content['compiledAt'] == Clock.now().isoformat()
                assert len(content['highlights']) == 1
                assert content['highlights'][0]['observedAt'] == original_at.isoformat()
                assert bool(place['payload'].get('mentionSources')) == place['name'].startswith('受控')
            exports.append(data)
        before, after = [{p['id']: p for p in d['places']} for d in exports]
        for eid in before:
            expected = copy.deepcopy(before[eid])
            expected['payload']['content']['compiledAt'] = after[eid]['payload']['content']['compiledAt']
            assert expected == after[eid]
        async with factory() as session:
            assert await load_mention_rows(session, city) == originals
            cat = await load_mention_catalog(session, city)
            assert cat.catalog.entities == entities and cat.assignments == assignments
    run(check)


@pytest.mark.parametrize('structured', [False, True])
def test_来源日期确实缺失才沿用编译时间且不改输入(structured):
    row = {'id': 1, 'raw_note_id': 1, 'name': '甲园', 'normalized_name': '甲园', 'confidence': .95,
        'source_url': 'https://example.com/garden', 'observed_at': None,
        'mention_type': 'recommend', 'reason': '甲园保存着古树与石桥。', 'evidence_text': '',
        'fact_type': None, 'fact_value': {}}
    if structured:
        row['fact_value']['placeContent'] = {'version': 1, 'highlights': [{'text': row['reason'], 'quote': row['reason']}]}
    original = copy.deepcopy(row)
    for at in ['2026-10-08T12:00:00+00:00', '2026-10-09T12:00:00+00:00']:
        facts, _ = scoped_facts({'entity_id': 'garden', 'canonical_name': '甲园', 'aliases': [], 'revision': 1}, [row], at, [])
        assert facts['content']['highlights'][0]['observedAt'] == at
    assert row == original
