"""同步后只读核对完整原始字段、日期、分析散列和成都全城分配；不查看图片。"""
from pathlib import Path
from datetime import datetime, timezone
import asyncio, hashlib, json, sys
sys.dont_write_bytecode = True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, 'D:/Project/xhs-travel-pipeline')
from sqlalchemy import select, text
from app.db import SessionFactory, engine
from app.models import CanonicalPlace, PlaceSummary, RawNote
from app.aggregate.mention_identity import load_mention_catalog
root = Path(__file__).resolve().parent
folder = root / 'priority-cities/成都/run-1791504271958861000'

def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()

async def main():
    target = root / 'priority-cities/成都/park-zones-inputs-check-01.json'
    assert not target.exists()
    details = json.loads((folder / 'details.json').read_text(encoding='utf-8'))
    frozen = json.loads((folder / 'sources.json').read_text(encoding='utf-8'))
    try:
        async with SessionFactory() as session:
            await session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            for entry in details['sources']:
                place = await session.get(CanonicalPlace, entry['source']['id'])
                assert place is not None
                for key, value in entry['source'].items():
                    assert getattr(place, key) == value, (place.id, key)
                for key, value in {**entry['derivedBefore'], **entry['supplement']}.items():
                    assert getattr(place, key) == value, (place.id, key)
                summary = await session.scalar(select(PlaceSummary).where(PlaceSummary.canonical_place_id == place.id))
                if entry['summary'] is None:
                    assert summary is None
                else:
                    assert summary is not None
                    for key, value in entry['summary'].items():
                        assert getattr(summary, key) == value, (place.id, key)
            null_notes = []
            for expected in details['noteDetails']:
                note = await session.get(RawNote, expected['id'])
                assert note is not None
                for field in ['city', 'title', 'desc', 'status']:
                    assert getattr(note, field) == expected[field], (note.id, field)
                assert note.source_url == expected['sourceUrl']
                assert digest(note.raw_json) == expected['rawJsonSha256']
                assert digest(note.img_analysis) == expected['analysisSha256']
                assert note.created_at.isoformat() == expected['observedAt']
                assert (note.publish_time.isoformat() if note.publish_time else None) == expected['publishedAt']
                if note.img_analysis is None:
                    null_notes.append(note.id)
            catalog = await load_mention_catalog(session, '成都')
            for assignment in frozen['assignments']:
                assert catalog.assignments[assignment['mention_id']] == assignment
            assert len(catalog.assignments) == 41 and len(null_notes) == 8
            report = {'batch': 66, 'readOnly': True, 'at': datetime.now(timezone.utc).isoformat(),
                'rawAndDerivedSourcesPreserved': 127, 'originalSummariesPreserved': True,
                'notes': 85, 'rawJsonHashesPreserved': True, 'analysisHashesAndNullPreserved': True,
                'publicationAndCollectionTimesPreserved': True, 'noteTextStatusAndSourceUrlsPreserved': True,
                'nullAnalysisNotes': null_notes, 'oldAssignmentsPreserved': 39, 'cityWideAssignmentRows': 41,
                'imageComparison': 'deferred_by_user', 'failures': []}
            with target.open('x', encoding='utf-8') as handle:
                json.dump(report, handle, ensure_ascii=False, indent=2)
                handle.write('\n')
            print(json.dumps(report, ensure_ascii=False))
    finally:
        await engine.dispose()

asyncio.run(main())
