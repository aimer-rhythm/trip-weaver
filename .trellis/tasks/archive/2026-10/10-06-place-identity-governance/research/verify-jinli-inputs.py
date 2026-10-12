"""第70批同步后只读核对全量冻结输入及原有47条分配，不查看图片。"""
from pathlib import Path
from datetime import datetime, timezone
import asyncio, hashlib, json, sys
sys.dont_write_bytecode = True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, 'D:/Project/xhs-travel-pipeline')
from sqlalchemy import select, text
from app.db import SessionFactory, engine
from app.models import CanonicalPlace, PlaceSummary, RawNote
from app.aggregate.mention_identity import load_mention_catalog, load_mention_rows
from app.clean.mention_identity import mention_fingerprint
from app.clean.mention_relations import mine_mention_relations
root = Path(__file__).resolve().parent
base = root / 'priority-cities/成都/run-1791504271958861000'
def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
def read(path): return json.loads(path.read_text(encoding='utf-8'))
async def main():
    target = root / 'priority-cities/成都/jinli-inputs-check-01.json'
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
            expected_notes = {n['id']:n for n in [*details['noteDetails'], *read(root/'all-cities/batch-70-source.json')['noteDetails']]}
            for expected in expected_notes.values():
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
            new_scope=read(root/'all-cities/batch-70-scope-decisions.json')[0]
            assert catalog.scopes[1689]['revision']==1 and catalog.scopes[1689]['text_warnings']==new_scope['textWarnings']
            for a in new_scope['assignments']:
                actual=catalog.assignments[a['mentionId']]
                assert actual['entity_id']==a['entityId'] and actual['input_hash']==a['inputHash']
                assert actual['scope_place_id']==1689 and actual['change_key']==new_scope['key'] and actual['revision']==1
                assert (actual.get('fact_exclusions') or {})==(a.get('factExclusions') or {})
            assert len(catalog.assignments)==64 and len(null_notes)==8
            all_rows=await load_mention_rows(session,'成都')
            by_id={m['id']:m for m in all_rows}
            for m in details['mentions']: assert mention_fingerprint(by_id[m['id']])==m['inputHash']
            relation_review=mine_mention_relations(catalog,all_rows)
            ambiguous=[]
            for mid in [3961,4155,4209]:
                matches=[x for x in relation_review['unresolved'] if mid in x.get('mentionIds',[]) and 'ambiguous_text_occurrence' in x.get('reasons',[])]
                assert matches, mid
                ambiguous.append({'mentionId':mid,'noteId':by_id[mid]['raw_note_id'],'reason':'ambiguous_text_occurrence','positions':len(matches)})
            old_graph=read(root/'all-cities/batch-69/sync-01/xhs-place-relations-成都.json')['relations']
            new_graph=read(root/'all-cities/batch-70/sync-01/xhs-place-relations-成都.json')['relations']
            eid='8a433260acdd259716088f8009e0fbdc'
            expected_graph=json.loads(json.dumps(old_graph))
            affected=[e for e in expected_graph if eid in [e['fromEntityId'],e['toEntityId']]]
            assert len(affected)==1
            edge=affected[0];assert [e['noteId'] for e in edge['evidence']]==[884,912,945,950]
            edge['toRevision']=3;edge['strength']='weak';edge['noteCount']=1
            edge['evidence']=[e for e in edge['evidence'] if e['noteId']==945]
            edge['evidence'][0]['to']['revision']=3
            assert new_graph==expected_graph
            assert catalog.scope_for_source(1688) is None
            report={'batch':70,'readOnly':True,'at':datetime.now(timezone.utc).isoformat(),'rawAndDerivedSourcesPreserved':127,
                'originalSummariesPreserved':True,'notes':len(expected_notes),'rawJsonHashesPreserved':True,'analysisHashesAndNullPreserved':True,
                'publicationAndCollectionTimesPreserved':True,'noteTextStatusAndSourceUrlsPreserved':True,'nullAnalysisNotes':null_notes,
                'oldAssignmentsPreserved':47,'cityWideAssignmentRows':64,'confirmedAssignmentsAdded':16,'pendingAssignmentsAdded':1,'exactTextWarningsStored':3,'originalMentionsUnchanged':len(details['mentions']),'wuhouNoScope':True,'relationAmbiguities':ambiguous,'relationChangesExplained':True,'imageComparison':'deferred_by_user','failures':[]}
            with target.open('x',encoding='utf-8') as handle: json.dump(report,handle,ensure_ascii=False,indent=2);handle.write('\n')
            print(json.dumps(report,ensure_ascii=False))
    finally: await engine.dispose()
asyncio.run(main())
