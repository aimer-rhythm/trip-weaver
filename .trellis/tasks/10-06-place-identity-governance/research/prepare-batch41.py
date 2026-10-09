"""冻结尚泉尚水茶馆前平台治理；正文可证的主体修正，不比对图片、不推测坐标。"""
from pathlib import Path
import asyncio
import hashlib
import json
import sys
from datetime import datetime, timezone
sys.dont_write_bytecode=True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0,'D:/Project/xhs-travel-pipeline')
from sqlalchemy import select,text
from app.db import SessionFactory,engine
from app.models import CanonicalPlace,PlaceSummary
from app.aggregate.mention_identity import load_mention_catalog,load_mention_rows,source_input,source_keys
from app.aggregate.image_identity import load_image_rows
from app.clean.mention_identity import mention_fingerprint,source_fingerprint,scope_matches

root=Path(__file__).resolve().parent
read=lambda p:json.loads((root/p).read_text(encoding='utf-8'))
sha=lambda p:hashlib.sha256((root/p).read_bytes()).hexdigest()
source_file='priority-cities/济南/run-1791385235272324900/sources.json'
eid='2c8372d3a47dbcb68abd998af495436d'
name='尚泉尚水茶馆前平台'
quote='第二个机位搜索“尚泉尚水茶馆”（图5位置），其前面平台即可拍摄湖面与楼阁全景'
def write_new(p,v):
    with (root/p).open('x',encoding='utf-8',newline='\n') as f:f.write(json.dumps(v,ensure_ascii=False,indent=2)+'\n')

async def main():
    pointer=read('cleaning-scope/current.json')
    assert pointer['latestAppliedEntityBatch']==40 and pointer['imageComparisonPolicy']['status']=='deferred_by_user'
    assert sha(source_file)=='9aa559e894e1cfbcdf74db2214c8eeb6614739064a96967780c6b32af59a889b'
    paths=[f'all-cities/batch-41-{x}.json' for x in ['source','decisions','scope-decisions','export-expectations']]
    ledger_file='priority-cities/济南/platform-source-review-01.json'
    assert all(not(root/p).exists() for p in [*paths,ledger_file])
    frozen=read(source_file)
    try:
        async with SessionFactory() as session:
            await session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            await session.execute(text("SET LOCAL statement_timeout='30s'"))
            catalog=await load_mention_catalog(session,'济南')
            sources=(await session.scalars(select(CanonicalPlace).where(CanonicalPlace.city=='济南'))).all()
            rows=await load_mention_rows(session,'济南');by_row={m['id']:m for m in rows};by_source={s.id:s for s in sources}
            for old in frozen['sources']:
                s=by_source[old['id']];assert source_fingerprint(source_input(s))==old['sourceHash']
                for key in ['name','normalized_name','city','address','latitude','longitude','place_type','geo_status','amap_poi_id','is_active','quality_score']:
                    assert getattr(s,key)==old[key],(s.id,key)
            for old in frozen['mentions']:assert mention_fingerprint(by_row[old['id']])==old['inputHash']
            matches=[s for s in sources if {'尚泉尚水茶馆',name}&source_keys(s)]
            assert [s.id for s in matches]==[5945]
            s=matches[0];entity=catalog.catalog.resolve(place_id=s.id)
            assert entity['entity_id']==eid and entity['revision']==2 and entity['status']=='ACTIVE'
            assert entity['overrides']['lat'] is None and entity['overrides']['lng'] is None
            assert entity['overrides']['geoStatus']=='unresolvable'
            assert catalog.scope_for_source(5945) is None
            mentions=[m for m in rows if scope_matches({'city':'济南','name_keys':{'尚泉尚水茶馆',name}},m)]
            assert [m['id'] for m in mentions]==[12653]
            m=mentions[0];assert quote in m['note_desc'] and not m['note_unavailable']
            assert m['place_type']=='cafe' and s.place_type=='cafe'
            images=await load_image_rows(session,'济南')
            assert not [im for im in images if im['source_place_id']==5945 or im['raw_note_id']==2795]
            summary=await session.scalar(select(PlaceSummary).where(PlaceSummary.canonical_place_id==5945))
            group={'entity':entity,'source':{k:getattr(s,k) for k in ['id','city','name','normalized_name','address','latitude','longitude',
                'place_type','geo_status','amap_poi_id','is_active','quality_score']},
                'derivedBefore':{k:getattr(s,k) for k in ['typical_visit_minutes','typical_visit_source','theme_tags','content_profile']},
                'summary':{k:getattr(summary,k) for k in ['canonical_place_id','mention_count_30d','recommend_score']},
                'mentions':[{**m,'inputHash':mention_fingerprint(m)}]}
            ledger={'city':'济南','batch':'batch-41','entityId':eid,'sourcePlaceId':5945,'mentionId':12653,'quote':quote,
                'conclusion':'茶馆仅为导航参照，推荐主体为茶馆前平台；保留原稳定ID及有效摄影描述，排除茶馆裸名同义，细分类改photo_spot。',
                'sourceFile':source_file,'sourceSha256':sha(source_file),'noteId':2795,'imageComparison':'deferred_by_user',
                'coordinates':'unknown_preserve_null','fullReviewPassed':False,'appliedAtFreeze':False}
        write_new(ledger_file,ledger)
        proof=[{'kind':'reviewed_text_platform_scope','file':ledger_file,'sha256':sha(ledger_file),'quote':quote,
            'mentionIds':[12653],'sourcePlaceIds':[5945],'conclusion':ledger['conclusion']}]
        scope={'key':'all-cities-20261009-batch-41-platform-scope','city':'济南','sourcePlaceId':5945,
            'expectedSourceHash':source_fingerprint(source_input(s)),'expectedScopeRevision':0,'expectedRevisions':{eid:2},
            'assignments':[{'mentionId':12653,'inputHash':mention_fingerprint(m),'entityId':eid}],'evidence':proof}
        decision={'key':'all-cities-20261009-batch-41-platform-correct','city':'济南','entityId':eid,'mergeEntityIds':[],
            'canonicalName':name,'aliases':[name],'excludeNames':['尚泉尚水茶馆'],'expectedRevisions':{eid:3},
            'overrides':{'category':'自然','xhsPlaceType':'photo_spot','lat':None,'lng':None,'geoStatus':'unresolvable',
                'address':'济南大明湖畔尚泉尚水茶馆前平台，精确机位待核'},'evidence':proof}
        source={'readOnly':True,'city':'济南','capturedAt':datetime.now(timezone.utc).isoformat(),'originalSourceFile':source_file,
            'originalSourceSha256':sha(source_file),'groups':[group],'notes':[n for n in frozen['notes'] if n['id']==2795],'images':[],'reviews':[]}
        expected=[{'city':'济南','id':eid,'name':name,'revision':4,'verified':True,'mentionIds':[12653]}]
        for p,v in zip(paths,[source,[decision],[scope],expected]):write_new(p,v)
        print(json.dumps({'batch':'batch-41','sourceSha256':sha(paths[0]),'mentions':1,'rename':name,
            'fineType':'photo_spot','coordinates':None,'imageComparison':'deferred_by_user'},ensure_ascii=False))
    finally:await engine.dispose()
asyncio.run(main())
