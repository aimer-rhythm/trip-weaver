"""两独立小店的旧猜测坐标清除和杂货铺分类修订，不新增无必要的文字scope。"""
from pathlib import Path
import asyncio,hashlib,json,sys
from datetime import datetime,timezone
sys.dont_write_bytecode=True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0,'D:/Project/xhs-travel-pipeline')
from sqlalchemy import select,text
from app.db import SessionFactory,engine
from app.models import CanonicalPlace
from app.aggregate.mention_identity import load_mention_catalog,load_mention_rows,source_input,source_keys
from app.aggregate.image_identity import load_image_rows
from app.clean.mention_identity import mention_fingerprint,source_fingerprint,scope_matches
root=Path(__file__).resolve().parent
def read(p):return json.loads((root/p).read_text(encoding='utf-8'))
def write(p,v):
    with (root/p).open('x',encoding='utf-8') as f:json.dump(v,f,ensure_ascii=False,indent=2)
async def main():
    pointer=read('cleaning-scope/current.json');assert pointer['latestAppliedEntityBatch']==49 and pointer['userAcceptance'] is False
    assert pointer['imageComparisonPolicy']['status']=='deferred_by_user'
    packet_path='priority-cities/济南/vintage-source-packet-01.json';packet=read(packet_path)
    assert hashlib.sha256((root/packet_path).read_bytes()).hexdigest()=='fe0f6599fe2a96698118589810885a1cd56606065e20e64211d47a08c2be225f'
    original=read(packet['originalSourceFile'])
    assert hashlib.sha256((root/packet['originalSourceFile']).read_bytes()).hexdigest()==packet['originalSourceSha256']
    photos=read('priority-cities/济南/vintage-photo-metadata-01.json')
    provenance=read('priority-cities/济南/vintage-geocode-provenance-01.json')
    assert all(set(r['equalsFrozenSources'])=={'VILLASHAKA','BLUEDUCK骨董屋'} for r in provenance['rows'][1:])
    shop_page=read('priority-cities/济南/vintage-reference-05.json');cafe_page=read('priority-cities/济南/vintage-reference-09.json')
    assert shop_page['ok'] and 'Jingsan Road No.120, Shizhong' in shop_page['content'] and 'BLUE DUCK骨董屋' in shop_page['content']
    assert cafe_page['ok'] and '纬四路66号' in cafe_page['content']
    paths=[f'all-cities/batch-50-{kind}.json' for kind in ['source','catalog','scope-decisions','decisions','export-expectations']]
    review_path='priority-cities/济南/vintage-source-review-01.json';assert all(not (root/p).exists() for p in [review_path,*paths])
    try:
        async with SessionFactory() as s:
            await s.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            cat=await load_mention_catalog(s,'济南');sources=(await s.scalars(select(CanonicalPlace).where(CanonicalPlace.city=='济南'))).all()
            mentions=await load_mention_rows(s,'济南');selected={};decisions=[];expected=[];rows=[]
            for g in packet['groups']:
                eid=g['entity']['entity_id'];sid=g['entity']['primary_place_id'];assert cat.catalog.entities[eid]==g['entity']
                photo=next(e for e in photos['entities'] if e['entityId']==eid)
                assert photo['revision']==1 and not photo['independentSources'] and not photo['assignments']
                assert all(v is None for v in photo['currentImageFields'].values())
                assert {p.id for p in sources if source_keys(p)&set(g['nameKeys'])}=={sid}
                src=next(p for p in sources if p.id==sid);assert source_fingerprint(source_input(src))==g['sources'][0]['sourceHash']
                assert cat.scope_for_source(sid) is None
                current=[m for m in mentions if scope_matches({'city':'济南','name_keys':g['nameKeys']},m)]
                assert {m['id']:mention_fingerprint(m) for m in current}=={m['id']:m['inputHash'] for m in packet['mentions'] if m['id'] in g['mentionIds']}
                assert len(current)==1 and current[0]['raw_note_id']==2573 and not current[0]['note_unavailable']
                m=current[0];selected[m['id']]=m;shop=sid==5398
                overrides={'lat':None,'lng':None,'geoStatus':'unresolvable'}
                if shop:overrides.update(category='购物',address='山东省济南市市中区经三路120号')
                quote='BLUE DUCK骨董屋是自助式vintage杂货铺，超有味道' if shop else 'VILLA SHAKA的墙超好拍，咖啡也很赞'
                assert quote in m['note_desc']
                evidence=[{'kind':'reviewed_distinct_shop_subject','file':review_path,'mentionId':m['id'],'quote':quote,
                    'conclusion':'同篇分别介绍的古着杂货铺和咖啡店保持独立，名称空格仅按现行键归一；不互借看点或同义合并。'},
                    {'kind':'unsupported_geocoder_point_cleared','file':'priority-cities/济南/vintage-geocode-provenance-01.json',
                    'conclusion':'两个不同名称均复现同一无POI猜测点，且命名检索无门店命中；清空消费坐标，原源保持，不能当作精确定位。'}]
                evidence.append({'kind':'public_place_reference','file':'priority-cities/济南/vintage-reference-05.json' if shop else 'priority-cities/济南/vintage-reference-09.json',
                    'url':shop_page['url'] if shop else cafe_page['url'],
                    'conclusion':'地图中文全名及地址字段支持经三路120号，仅补文字地址，不用附近地点替代精确坐标。' if shop else
                    '纬四路店公开页面仅为分店候选；另有上新街文字记录，原笔记无明确店址，不将候选名、门牌或坐标加成当前实体身份。'})
                decisions.append({'key':f'all-cities-20261009-batch-50-source-{sid}-location','city':'济南','entityId':eid,
                    'expectedRevisions':{eid:1},'mergeEntityIds':[],'canonicalName':g['entity']['canonical_name'],'aliases':g['entity']['aliases'],
                    'overrides':overrides,'evidence':evidence})
                expected.append({'city':'济南','id':eid,'name':g['entity']['canonical_name'],'revision':2,'verified':True})
                rows.append({'entityId':eid,'sourceId':sid,'mentionId':m['id'],'noteId':2573,'inputHash':mention_fingerprint(m),'quote':quote,
                    'status':'text_subject_distinct_location_unresolved','category':'购物' if shop else '美食','xhsPlaceType':'shop' if shop else 'cafe',
                    'coordinateAction':'clear_unidentified_geocoder_point','addressAction':'add_named_map_address' if shop else 'retain_empty_branch_unresolved'})
            images=[im for im in await load_image_rows(s,'济南') if im['source_place_id'] in [5398,5399]];assert images==[]
            source={'readOnly':True,'capturedAt':datetime.now(timezone.utc).isoformat(),'city':'济南','groups':packet['groups'],
                'sources':[v for g in packet['groups'] for v in g['sources']],'mentions':[{**m,'inputHash':mention_fingerprint(m)} for m in selected.values()],
                'notes':[n for n in original['notes'] if n['id']==2573],'images':images,'reviews':[],
                'originalSourceFile':packet['originalSourceFile'],'originalSourceSha256':packet['originalSourceSha256']}
        report={'city':'济南','batch':50,'roots':2,'sources':2,'mentions':2,'fullNotes':1,'rows':rows,'fullOriginalTextRead':True,
            'noNewScopeNeeded':True,'originalMentionFactsPreserved':True,'coordinatesCleared':2,'newPreciseLocations':0,'categoriesCorrected':1,
            'branchCandidateNotAdopted':'VILLA SHAKA为了沙卡(纬四路店)','imageComparison':'deferred_by_user','fullReviewPassed':False,'appliedAtFreeze':False,
            'webEvidence':{'accepted':['vintage-reference-05.json','vintage-reference-09.json'],
                'limited':['vintage-reference-08.json'], 'rejectedGeneratedClaim':'shops-search-03经七路189号无引用支持且与地图地址冲突，不采用；无关佛教网页排除。',
                'unavailable':['vintage-reference-01.json','vintage-reference-02.json','vintage-reference-03.json','vintage-reference-04.json','vintage-reference-06.json','vintage-reference-07.json'],
                'namedMapsNoResults':['vintage-geo-01.json','vintage-geo-02.json'],'streetOnlyNotStorePins':'vintage-geo-03.json'}}
        write(review_path,report)
        for p,v in zip(paths,[source,packet['catalog'],[],decisions,expected]):write(p,v)
        print(json.dumps({'batch':50,'sourceSha256':hashlib.sha256((root/paths[0]).read_bytes()).hexdigest(),'decisions':2,'scopes':0,'coordinateClears':2,'categoryCorrections':1},ensure_ascii=False))
    finally:await engine.dispose()
asyncio.run(main())
