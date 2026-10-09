"""冻结五个街道廊道及店铺主体完整原文、来源时间及现行身份，不查看图片。"""
from pathlib import Path
import asyncio,hashlib,json,sys
from datetime import datetime,timezone
sys.dont_write_bytecode=True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0,'D:/Project/xhs-travel-pipeline')
from sqlalchemy import select,text
from app.db import SessionFactory,engine
from app.models import CanonicalPlace,PlaceSummary,PlaceEntityReview,RawNote
from app.aggregate.mention_identity import load_mention_catalog,load_mention_rows,source_input,source_keys
from app.clean.mention_identity import mention_fingerprint,source_fingerprint,scope_matches
root=Path(__file__).resolve().parent
original=root/'priority-cities/济南/run-1791385235272324900/sources.json'
target=root/'priority-cities/济南/remaining-streets-source-packet-01.json'
ids=['747792d1b5834255f5feaa6c2dc62925', '9dbf8ef94ec1777461c9d486973ce0c7', 'a16d03423b6c350d1d3526a2a1c4280d', 'e1cfa0121a1455efea5324938742d4f4', '636406ca3bce1e8189be38c73b4e8ae4']
async def main():
    assert not target.exists()
    digest=hashlib.sha256(original.read_bytes()).hexdigest();assert digest=='9aa559e894e1cfbcdf74db2214c8eeb6614739064a96967780c6b32af59a889b'
    frozen=json.loads(original.read_text(encoding='utf-8'))
    pointer=json.loads((root/'cleaning-scope/current.json').read_text(encoding='utf-8'))
    assert pointer['latestAppliedEntityBatch']==61 and pointer['imageComparisonPolicy']['status']=='deferred_by_user'
    try:
        async with SessionFactory() as s:
            await s.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            cat=await load_mention_catalog(s,'济南');sources=(await s.scalars(select(CanonicalPlace).where(CanonicalPlace.city=='济南'))).all()
            rows=await load_mention_rows(s,'济南');groups=[];selected={};source_ids=set()
            for eid in ids:
                old=next(g for g in frozen['groups'] if g['entity']['entity_id']==eid);keys=set(old['nameKeys'])
                current=[m for m in rows if scope_matches({'city':'济南','name_keys':keys},m)]
                assert {m['id'] for m in current}==set(old['mentionIds'])
                for m in current:
                    assert mention_fingerprint(m)==next(v for v in frozen['mentions'] if v['id']==m['id'])['inputHash'];selected[m['id']]=m
                members=[]
                for source in [v for v in sources if keys&source_keys(v)]:
                    raw=next(v for v in frozen['sources'] if v['id']==source.id);source_ids.add(source.id)
                    assert source_fingerprint(source_input(source))==raw['sourceHash']
                    entity=cat.catalog.resolve(place_id=source.id);assert entity['entity_id']==eid and cat.scope_for_source(source.id) is None
                    summary=await s.scalar(select(PlaceSummary).where(PlaceSummary.canonical_place_id==source.id))
                    fields=['id','city','name','normalized_name','address','latitude','longitude','place_type','geo_status','amap_poi_id','is_active','quality_score']
                    data={k:getattr(source,k) for k in fields};assert data=={k:raw[k] for k in fields}
                    members.append({'source':data,'sourceHash':raw['sourceHash'],
                        'derivedBefore':{k:getattr(source,k) for k in ['typical_visit_minutes','typical_visit_source','theme_tags','content_profile']},
                        'supplement':{'adcode':source.adcode},'summary':{k:getattr(summary,k) for k in ['canonical_place_id','mention_count_30d','recommend_score','top_reasons']}})
                groups.append({'entity':entity,'sources':members,'nameKeys':sorted(keys),'mentionIds':[m['id'] for m in current]})
            notes=[]
            for nid in sorted({m['raw_note_id'] for m in selected.values()}):
                m=next(m for m in selected.values() if m['raw_note_id']==nid)
                notes.append({'id':nid,'city':m['note_city'],'title':m['note_title'],'desc':m['note_desc'],
                    'unavailable':m['note_unavailable'],'mentionIds':[m['id'] for m in selected.values() if m['raw_note_id']==nid]})
            note_times=[]
            for n in (await s.scalars(select(RawNote).where(RawNote.id.in_([n['id'] for n in notes])))).all():
                raw=n.raw_json or {}
                fields=[]
                def times(value,path=''):
                    if isinstance(value,dict):
                        for k,v in value.items():
                            key=path+'.'+k
                            if ('time' in k.lower() or 'date' in k.lower()) and isinstance(v,(str,int,float,type(None))):fields.append({'path':key,'value':v})
                            if isinstance(v,(dict,list)):times(v,key)
                    elif isinstance(value,list):
                        for i,v in enumerate(value):times(v,path+'.'+str(i))
                times(raw)
                note_times.append({'noteId':n.id,'publishTime':n.publish_time.isoformat() if n.publish_time else None,'collectedAt':n.created_at.isoformat(),
                    'rawJsonSha256':hashlib.sha256(json.dumps(raw,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest(),'rawTimeFields':fields})
            history=[e for eid,e in cat.catalog.entities.items() if (cat.catalog.root(eid) or {}).get('entity_id') in ids]
            history_ids={e['entity_id'] for e in history}
            reviews=(await s.scalars(select(PlaceEntityReview).where(PlaceEntityReview.city=='济南'))).all()
            related=[{k:getattr(r,k) for k in ['id','city','fingerprint','status','detail']} for r in reviews if history_ids&set(r.detail.get('entityIds',[]))]
            payload={'readOnly':True,'capturedAt':datetime.now(timezone.utc).isoformat(),'city':'济南','entityBatch':61,'groups':groups,
                'originalSourceFile':str(original.relative_to(root)),'originalSourceSha256':digest,
                'catalog':{'entities':history,'members':[{'place_id':pid,'entity_id':eid} for pid,eid in cat.catalog.members.items() if pid in source_ids],'reviews':related},
                'mentions':[{k:v for k,v in m.items() if k not in ['note_images','note_desc','note_title','source_url']}|{'inputHash':mention_fingerprint(m)} for m in selected.values()],
                'notes':notes,'noteTimes':note_times,'imageComparison':'deferred_by_user','businessMutations':False}
            with target.open('x',encoding='utf-8') as f:json.dump(payload,f,ensure_ascii=False,indent=2)
            print(json.dumps({'file':str(target.relative_to(root)),'groups':[(g['entity']['canonical_name'],len(g['sources']),len(g['mentionIds'])) for g in groups],
                'notes':len(notes),'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'historicalEntities':len(history),'relatedReviews':len(related)},ensure_ascii=False))
    finally:await engine.dispose()
asyncio.run(main())
