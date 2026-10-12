"""实库只读：完整来源日期/分析、补充警告指纹与被移除关系的原端点原因。"""
from pathlib import Path
import asyncio,copy,hashlib,json,sys
sys.dont_write_bytecode=True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0,'D:/Project/xhs-travel-pipeline')
from sqlalchemy import select,text
from app.db import SessionFactory,engine
from app.models import CanonicalPlace,RawNote
from app.aggregate.mention_identity import load_mention_catalog,load_mention_rows
from app.clean.mention_identity import effective_mention
from app.clean.mention_relations import mine_mention_relations
root=Path(__file__).resolve().parent
def read(p):return json.loads((root/p).read_text(encoding='utf-8'))
def digest(v):return hashlib.sha256(json.dumps(v,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
async def main():
    target=root/'priority-cities/济南/furong-inputs-check-01.json';assert not target.exists()
    frozen=read('priority-cities/济南/furong-source-packet-01.json');scope=read('all-cities/batch-63-scope-decisions.json')[0]
    folder='all-cities/batch-63/sync-01/';delta=read(folder+'preview-济南/relation-delta.json')
    try:
        async with SessionFactory() as s:
            await s.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            for t in frozen['noteTimes']:
                n=await s.get(RawNote,t['noteId']);detail=next(v for v in frozen['noteDetails'] if v['id']==n.id)
                assert n.publish_time.isoformat()==t['publishTime'] and n.created_at.isoformat()==t['collectedAt']
                assert digest(n.raw_json or {})==t['rawJsonSha256'] and digest(n.img_analysis or [])==detail['analysisSha256']
                assert (n.title,n.desc,n.img_analysis,n.status,n.source_url)==(detail['title'],detail['desc'],detail['images'],detail['status'],detail['sourceUrl'])
                assert int(n.publish_time.timestamp()*1000)==next(v['value'] for v in t['rawTimeFields'] if v['path']=='.note_card.time')
            cat=await load_mention_catalog(s,'济南');rows=await load_mention_rows(s,'济南');by_id={r['id']:r for r in rows}
            assert cat.scopes[5353]['text_warnings']==scope['textWarnings']
            warnings=cat.text_warnings_for(frozen['groups'][0]['entity']['entity_id']);assert len(warnings)==1
            assert {k:v for k,v in warnings[0].items() if k!='sourceUrl'}==scope['textWarnings'][0]
            manifest=read(folder+'xhs-places-济南.json')['relationIdentity']
            assert cat.supplemental_sources()==manifest['sourceState']['supplementalSources']
            effective=effective_mention(by_id[11699],cat.resolve(by_id[11699]))
            assert effective['reason'] is None and effective['evidence_text'] is None and by_id[11699]['reason']=='晚上去小吃街方便'
            for g in frozen['groups'][0]['sources']:
                raw=await s.get(CanonicalPlace,g['source']['id']);assert {k:getattr(raw,k) for k in g['derivedBefore']}==g['derivedBefore']
            surfaces=(await s.execute(select(CanonicalPlace.name,CanonicalPlace.normalized_name).where(CanonicalPlace.city=='济南'))).all()
            mined=mine_mention_relations(cat,rows,extra_surfaces=[n for pair in surfaces for n in pair])
            expected=read(folder+'xhs-place-relations-济南.json')['relations'];assert mined['relations']==expected
            assert len(delta['removed'])==1 and len(delta['changed'])==1
            removed=delta['removed'][0];assert removed['from']=='芙蓉街' and removed['to']=='宽厚里'
            old=removed['evidence'][0];assert old['noteId']==2851
            endpoint=old['from'];assert endpoint['start']==74 and endpoint['end']==77
            unbound=[v for v in mined['unresolved'] if v.get('noteId')==2851 and v.get('start')==74 and v.get('end')==77]
            assert len(unbound)==1 and unbound[0]['reasons']==['ambiguous_text_occurrence']
            assert unbound[0]['mentionIds']==[12835,12836]
            assert all(cat.resolve(by_id[mid])['status']=='resolved' for mid in [12835,12836])
            before=read(folder+'preview-济南/library-before.json')['tables']['place_relation_snapshots'][0]['relations']
            retained=[copy.deepcopy(r) for r in before if r!=removed];updated=0
            for r in retained:
                for end in ['from','to']:
                    if r[end+'EntityId']==frozen['groups'][0]['entity']['entity_id']:
                        assert r[end+'Revision']==3;r[end+'Revision']=4;updated+=1
                        for e in r['evidence']:assert e[end]['revision']==3;e[end]['revision']=4
            assert updated==1 and retained==expected
        report={'batch':63,'readOnly':True,'notes':24,'supplementalNotes':1,'publicationAndCollectionTimesPreserved':True,
            'rawJsonHashesPreserved':True,'analysisHashesPreserved':True,'rawDerivedCachesPreserved':True,
            'textWarningsVerified':1,'supplementalSourceStateVerified':True,'hotelDescriptionExcluded':True,
            'relationRemoved':{'from':'芙蓉街','to':'宽厚里','noteId':2851,'oldStart':74,'oldEnd':77,'mentionIds':[12835,12836],'reasons':['ambiguous_text_occurrence'],'mentionsStillResolved':True},
            'remainingRelationsPreserved':18,'endpointRevisionsUpdated':1,'strongRelationsPreserved':3,
            'relationMeaning':'同篇多次芙蓉街，菜品与拥挤提及引用不含能定位路线位置的地名；受控后不能凭确认身份认领原路线74–77端点。并非两条餐馆待审导致，也不是补充警示建立了关系。',
            'imageComparison':'deferred_by_user','failures':[]}
        with target.open('x',encoding='utf-8') as f:json.dump(report,f,ensure_ascii=False,indent=2)
        print(json.dumps(report,ensure_ascii=False))
    finally:await engine.dispose()
asyncio.run(main())
