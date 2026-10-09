"""第69批同步后只读核对全量冻结输入及原有41条分配，不查看图片。"""
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
base = root / 'priority-cities/成都/run-1791504271958861000'
def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
def read(path): return json.loads(path.read_text(encoding='utf-8'))
async def main():
    target = root / 'priority-cities/成都/heming-inputs-check-01.json'
    assert not target.exists()
    details, frozen = read(base/'details.json'), read(base/'sources.json')
    try:
        async with SessionFactory() as session:
            await session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            for entry in details['sources']:
                place = await session.get(CanonicalPlace, entry['source']['id'])
                assert place is not None
                for key, value in {**entry['source'], **entry['derivedBefore'], **entry['supplement']}.items():
                    assert getattr(place,key) == value, (place.id,key)
                summary = await session.scalar(select(PlaceSummary).where(PlaceSummary.canonical_place_id==place.id))
                if entry['summary'] is None: assert summary is None
                else:
                    assert summary is not None
                    for key,value in entry['summary'].items(): assert getattr(summary,key)==value, (place.id,key)
            null_notes = []
            for expected in details['noteDetails']:
                note = await session.get(RawNote,expected['id'])
                assert note is not None
                for key in ['city','title','desc','status']: assert getattr(note,key)==expected[key], (note.id,key)
                assert note.source_url==expected['sourceUrl']
                assert digest(note.raw_json)==expected['rawJsonSha256']
                assert digest(note.img_analysis)==expected['analysisSha256']
                assert note.created_at.isoformat()==expected['observedAt']
                assert (note.publish_time.isoformat() if note.publish_time else None)==expected['publishedAt']
                if note.img_analysis is None: null_notes.append(note.id)
            catalog = await load_mention_catalog(session,'成都')
            for assignment in frozen['assignments']: assert catalog.assignments[assignment['mention_id']]==assignment
            for scope in read(root/'all-cities/batch-66-scope-decisions.json'):
                assert catalog.scopes[scope['sourcePlaceId']]['revision']==1
                for a in scope['assignments']:
                    current = catalog.assignments[a['mentionId']]
                    assert current['entity_id']==a['entityId'] and current['input_hash']==a['inputHash']
                    assert current['scope_place_id']==scope['sourcePlaceId'] and current['change_key']==scope['key'] and current['revision']==1
            current_scope=read(root/'all-cities/batch-69-scope-decisions.json')[0]
            assert catalog.scopes[1847]['revision']==1 and catalog.scopes[1847]['text_warnings']==current_scope['textWarnings']
            for a in current_scope['assignments']:
                actual=catalog.assignments[a['mentionId']]
                assert actual['entity_id']==a['entityId'] and actual['input_hash']==a['inputHash']
                assert actual['scope_place_id']==1847 and actual['change_key']==current_scope['key'] and actual['revision']==1
            assert len(catalog.assignments)==47 and len(null_notes)==8
            report={'batch':69,'readOnly':True,'at':datetime.now(timezone.utc).isoformat(),'rawAndDerivedSourcesPreserved':127,
                'originalSummariesPreserved':True,'notes':85,'rawJsonHashesPreserved':True,'analysisHashesAndNullPreserved':True,
                'publicationAndCollectionTimesPreserved':True,'noteTextStatusAndSourceUrlsPreserved':True,'nullAnalysisNotes':null_notes,
                'oldAssignmentsPreserved':41,'cityWideAssignmentRows':47,'confirmedAssignmentsAdded':6,'exactMultilineWarningStored':True,'imageComparison':'deferred_by_user','failures':[]}
            with target.open('x',encoding='utf-8') as handle: json.dump(report,handle,ensure_ascii=False,indent=2);handle.write('\n')
            print(json.dumps(report,ensure_ascii=False))
    finally: await engine.dispose()
asyncio.run(main())
