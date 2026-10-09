"""只读复现灵岩寺时长来源，并核对五个待审主体的上下游实际消费值。"""
from pathlib import Path
import asyncio
import hashlib
import importlib.util
import json
import sys
from datetime import datetime, timezone

sys.dont_write_bytecode = True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, 'D:/Project/xhs-travel-pipeline')
from dotenv import dotenv_values
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import create_async_engine
from app.db import SessionFactory, engine
from app.models import CanonicalPlace, RawNote
from app.aggregate.mention_identity import load_mention_catalog, load_mention_rows
from app.clean.mention_identity import mention_fingerprint

root = Path(__file__).resolve().parent
read = lambda f: json.loads((root / f).read_text(encoding='utf-8'))
digest = lambda f: hashlib.sha256(Path(f).read_bytes()).hexdigest()
script = Path('D:/Project/xhs-travel-pipeline/scripts/build_visit_duration.py')
spec = importlib.util.spec_from_file_location('duration_builder_probe', script)
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)

async def main():
    out = root / 'priority-cities/济南/outer-findings-check-01.json'
    assert not out.exists()
    pointer = read('cleaning-scope/current.json')
    assert pointer['latestAppliedEntityBatch'] == 38
    assert '济南' not in pointer['policy']['excludedCities']
    packet_paths = [f'priority-cities/济南/{name}-source-packet-01.json' for name in ['bridge', 'outer']]
    packets = [read(f) for f in packet_paths]
    groups = [g for p in packets for g in p['groups']]
    targets = [g['entity']['entity_id'] for g in groups]
    report = {'readOnly': True, 'capturedAt': datetime.now(timezone.utc).isoformat(),
        'entityBatch': 38, 'sourcePackets': [{'file': f, 'sha256': digest(root / f)} for f in packet_paths],
        'durationBuilder': {'file': str(script), 'sha256': digest(script)}, 'failures': []}
    db_url = dotenv_values(root.parents[3] / 'apps/server/.env')['DATABASE_URL']
    db_url = db_url.replace('postgres://', 'postgresql+asyncpg://').replace('postgresql://', 'postgresql+asyncpg://')
    downstream = create_async_engine(db_url)
    try:
        async with SessionFactory() as session:
            await session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            catalog = await load_mention_catalog(session, '济南')
            mentions = await load_mention_rows(session, '济南')
            by_id = {m['id']: m for m in mentions}
            for packet in packets:
                for m in packet['mentions']:
                    assert mention_fingerprint(by_id[m['id']]) == m['inputHash']
                for g in packet['groups']:
                    assert catalog.catalog.root(g['entity']['entity_id']) == g['entity']
            report['verifiedMentionCount'] = sum(len(p['mentions']) for p in packets)
            raw_sources = (await session.scalars(select(CanonicalPlace).where(
                CanonicalPlace.id.in_([pid for g in groups for pid in g['sourceIds']])))).all()
            report['upstreamDerived'] = [{k: getattr(p, k) for k in ['id', 'name', 'typical_visit_minutes',
                'typical_visit_source', 'latitude', 'longitude']} for p in raw_sources]
            temple = next(p for p in raw_sources if p.id == 5475)
            assert temple.typical_visit_minutes == 180 and temple.typical_visit_source == 'xhs_median'
            assert by_id[11686]['fact_type'] is None
            note = await session.get(RawNote, 2609)
            frozen_note = next(n for n in packets[1]['notes'] if n['id'] == 2609)
            assert note.desc == frozen_note['note_desc'] and note.img_analysis == frozen_note['note_images']
            note_mentions = [m for m in mentions if m['raw_note_id'] == note.id]
            texts = [('desc', note.desc or '')]
            for i, item in enumerate(note.img_analysis or []):
                if item.get('has_text'):
                    texts.append((f'img_analysis[{i}].text_content', str(item.get('text_content') or '')))
                    texts.extend((f'img_analysis[{i}].key_info.{k}', str(v)) for k, v in (item.get('key_info') or {}).items() if v)
            matches = []
            for origin, value in texts:
                for sentence in builder._SENT_SPLIT.split(value):
                    sentence = sentence.strip()
                    if not sentence or not builder.has_duration_hint(sentence):
                        continue
                    for m in note_mentions:
                        if m['id'] != 11686 or m['name'] not in sentence:
                            continue
                        idx = sentence.find(m['name'])
                        window = sentence[max(0, idx - builder._WINDOW):idx + len(m['name']) + builder._WINDOW]
                        if any(w in window for w in builder._COMMUTE_WORDS):
                            continue
                        if any(o['name'] and o['name'] != m['name'] and o['name'] in window for o in note_mentions):
                            continue
                        minutes = builder.normalize_visit_duration(window, place_name=m['name'], place_type=m['place_type'])
                        if minutes is not None:
                            matches.append({'noteId': note.id, 'mentionId': m['id'], 'textSource': origin,
                                'sentence': sentence, 'window': window, 'minutes': minutes})
            assert matches and all(m['minutes'] == 180 for m in matches)
            assert any('不建议安排' in m['sentence'] and '不建议安排' not in m['window'] for m in matches)
            report['durationReproduction'] = matches
            report['templeExistingScope'] = catalog.scope_for_source(5475)
            assert report['templeExistingScope'] is None
        async with downstream.connect() as conn:
            await conn.execute(text('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            rows = (await conn.execute(text('SELECT id,name,category,lat,lng,verified,payload FROM canonical_places WHERE city=:city AND id=ANY(:ids)'),
                {'city': '济南', 'ids': targets})).mappings().all()
            assert len(rows) == 5
            report['downstream'] = []
            for row in rows:
                payload = row['payload']
                report['downstream'].append({k: row[k] for k in ['id', 'name', 'category', 'lat', 'lng', 'verified']} | {
                    'identity': payload.get('identity'), 'typicalVisitMinutes': payload.get('typicalVisitMinutes'),
                    'intro': (payload.get('content') or {}).get('intro'), 'openHoursStatus': (payload.get('openHours') or {}).get('status'),
                    'reservation': payload.get('reservation'), 'topReasons': payload.get('topReasons'),
                    'imageFieldsEmpty': all(not payload.get(k) for k in ['coverImage', 'amapPhoto', 'imageGallery'])})
            assert next(r for r in report['downstream'] if r['name'] == '灵岩寺')['typicalVisitMinutes'] == 180
            report['trips'] = dict((await conn.execute(text("SELECT count(*)::int count,md5(COALESCE(string_agg(h,'' ORDER BY h),'')) digest FROM (SELECT md5(to_jsonb(t)::text) h FROM trips t) x"))).mappings().one())
            assert report['trips'] == {'count': 201, 'digest': 'e01d67cbf42a62fc595f4ef052f99e75'}
            await conn.rollback()
        with out.open('x', encoding='utf-8') as handle:
            json.dump(report, handle, ensure_ascii=False, indent=2)
        print(json.dumps({'file': str(out.relative_to(root)), 'verifiedMentions': report['verifiedMentionCount'],
            'durationMatches': matches, 'trips': report['trips'], 'failures': report['failures']}, ensure_ascii=False))
    finally:
        await engine.dispose()
        await downstream.dispose()

asyncio.run(main())
