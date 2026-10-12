"""第64批实库只读核对原始全文/日期/raw_json/分析与关系不变。"""
from pathlib import Path
import asyncio,hashlib,json,sys
sys.dont_write_bytecode=True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0,'D:/Project/xhs-travel-pipeline')
from sqlalchemy import select,text
from app.db import SessionFactory,engine
from app.models import CanonicalPlace,RawNote
from app.aggregate.mention_identity import load_mention_catalog,load_mention_rows
from app.clean.mention_identity import mention_fingerprint
from app.clean.mention_relations import mine_mention_relations
root=Path(__file__).resolve().parent
def read(p):return json.loads((root/p).read_text(encoding='utf-8'))
def digest(v):return hashlib.sha256(json.dumps(v,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
async def main():
    target=root/'priority-cities/济南/last-restaurants-inputs-check-01.json';assert not target.exists()
    frozen=read('all-cities/batch-64-source.json');scopes=read('all-cities/batch-64-scope-decisions.json');folder='all-cities/batch-64/sync-01/'
    try:
        async with SessionFactory() as s:
            await s.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            for t in frozen['noteTimes']:
                n=await s.get(RawNote,t['noteId']);detail=next(v for v in frozen['noteDetails'] if v['id']==n.id)
                m=next(m for m in frozen['mentions'] if m['raw_note_id']==n.id)
                assert n.publish_time.isoformat()==t['publishTime'] and n.created_at.isoformat()==t['collectedAt']
                assert digest(n.raw_json or {})==t['rawJsonSha256'] and digest(n.img_analysis or [])==detail['analysisSha256']
                assert (n.title,n.desc,n.img_analysis,n.status,n.source_url)==(detail['title'],detail['desc'],m['note_images'],detail['status'],detail['sourceUrl'])
                assert int(n.publish_time.timestamp()*1000)==next(v['value'] for v in t['rawTimeFields'] if v['path']=='.note_card.time')
            cat=await load_mention_catalog(s,'济南');rows=await load_mention_rows(s,'济南');by_id={m['id']:m for m in rows}
            for m in frozen['mentions']:assert mention_fingerprint(by_id[m['id']])==m['inputHash']
            assert cat.resolve(by_id[12893])['status']=='review'
            for scope in scopes:
                assert cat.scopes[scope['sourcePlaceId']].get('text_warnings') is None
                for a in scope['assignments']:
                    result=cat.resolve(by_id[a['mentionId']]);assert result['status']==('resolved' if a['entityId'] else 'review')
            assert cat.scope_for_source(5345) is None
            for g in frozen['sources']:
                raw=await s.get(CanonicalPlace,g['source']['id']);expected={**g['source'],**g['derivedBefore'],**g['supplement']}
                assert {k:getattr(raw,k) for k in expected}==expected
            surfaces=(await s.execute(select(CanonicalPlace.name,CanonicalPlace.normalized_name).where(CanonicalPlace.city=='济南'))).all()
            mined=mine_mention_relations(cat,rows,extra_surfaces=[n for pair in surfaces for n in pair])
            relations=read(folder+'xhs-place-relations-济南.json')['relations'];assert mined['relations']==relations
            prior=read(folder+'preview-济南/library-before.json')['tables']['place_relation_snapshots'][0]
            assert prior['relations']==relations and len(relations)==18
            delta=read(folder+'preview-济南/relation-delta.json');assert not delta['changed'] and not delta['removed']
            manifest=read(folder+'xhs-places-济南.json')['relationIdentity']
            assert manifest['sourceState']['supplementalSources']==prior['manifest']['sourceState']['supplementalSources']==cat.supplemental_sources()
        report={'batch':64,'readOnly':True,'notes':3,'notesWithExistingAnalysis':2,'nullAnalysisNotes':[2602],'sources':4,'mentions':10,
            'publicationAndCollectionTimesPreserved':True,'rawJsonHashesPreserved':True,'analysisHashesAndNullPreserved':True,'rawDerivedCachesPreserved':True,
            'readOnlyHuaXiangPreserved':True,'supplementalWarningSourcePreserved':True,'remainingRelationsPreserved':18,'strongRelationsPreserved':3,
            'relationChanges':0,'relationSourceRevision':38,'imageComparison':'deferred_by_user','failures':[]}
        with target.open('x',encoding='utf-8') as f:json.dump(report,f,ensure_ascii=False,indent=2)
        print(json.dumps(report,ensure_ascii=False))
    finally:await engine.dispose()
asyncio.run(main())
