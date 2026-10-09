"""六家餐饮店按完整原文地址纠正无支持的消费坐标，不制造文字scope。"""
from pathlib import Path
import asyncio, hashlib, json, math, sys
from datetime import datetime, timezone
sys.dont_write_bytecode = True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, 'D:/Project/xhs-travel-pipeline')
from sqlalchemy import select, text
from app.db import SessionFactory, engine
from app.models import CanonicalPlace
from app.aggregate.mention_identity import load_mention_catalog, load_mention_rows, source_input
from app.aggregate.image_identity import load_image_rows
from app.clean.mention_identity import mention_fingerprint, source_fingerprint, scope_matches
ROOT = Path(__file__).resolve().parent
def read(p): return json.loads((ROOT / p).read_text(encoding='utf-8'))
def write(p,v):
    with (ROOT / p).open('x', encoding='utf-8') as file: json.dump(v,file,ensure_ascii=False,indent=2)
ADDRESS = {5332: ('县西巷86号','🔸李山记铁板炒鸡📍县西巷86号（近大明湖/泉城路）','大明湖',117.03165220153181,36.67752439711543),
    5336: ('老商埠5号楼109','🔸新秀炸鸡📍老商埠5号楼109（经三路爱心红绿灯西侧50米）','融汇老商埠',116.992757,36.662082),
    5337: ('经二路398号','🔸乐乎哉刘家菜📍经二路398号（近经三路/西市场）','经三路街区参照',116.98727328058241,36.66172763288482),
    5338: ('铜元局前街','🔸凉皮嫂子📍铜元局前街(近大明湖西南门)','铜元局前街69号五龙潭东门',117.01565443178703,36.666405335382514),
    5341: ('经二路253号','🔸邻家羊肉面饸饹面📍经二路253号(近经三路/大观园)','经二路262-1号道路参照',116.9890599499714,36.66370001532388),
    5344: ('辘轳把子街12号','🔹杨氏泉水茶汤📍辘轳把子街12号(近泉城路曲水亭街大明湖)','大明湖',117.03165220153181,36.67752439711543)}

def km(lng1,lat1,lng2,lat2):
    a,b=map(math.radians,[lat1,lat2]);dlat=b-a;dlng=math.radians(lng2-lng1)
    return 6371*2*math.asin(math.sqrt(math.sin(dlat/2)**2+math.cos(a)*math.cos(b)*math.sin(dlng/2)**2))

async def main():
    pointer=read('cleaning-scope/current.json');assert pointer['latestAppliedEntityBatch']==50
    assert pointer['latestMetadataRefresh']['run']==1 and pointer['userAcceptance'] is False
    assert pointer['imageComparisonPolicy']['status']=='deferred_by_user'
    packet_path='priority-cities/济南/food-address-source-packet-01.json';packet=read(packet_path)
    assert hashlib.sha256((ROOT/packet_path).read_bytes()).hexdigest()=='23bc32bd7e3707dd1aff3c0eaa942e833c878ec8afc305429cf797c9b06882c7'
    photos=read('priority-cities/济南/food-address-photo-metadata-01.json')
    original=read(packet['originalSourceFile']);assert hashlib.sha256((ROOT/packet['originalSourceFile']).read_bytes()).hexdigest()==packet['originalSourceSha256']
    review_path='priority-cities/济南/food-address-source-review-01.json'
    paths=[f'all-cities/batch-51-{kind}.json' for kind in ['source','catalog','scope-decisions','decisions','export-expectations']]
    assert all(not (ROOT/p).exists() for p in [review_path,*paths])
    selected={};decisions=[];expected=[];reviews=[]
    try:
        async with SessionFactory() as session:
            await session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            cat=await load_mention_catalog(session,'济南');mentions=await load_mention_rows(session,'济南')
            for group in packet['groups']:
                entity=group['entity'];eid=entity['entity_id'];sid=entity['primary_place_id']
                assert entity==cat.catalog.entities[eid] and entity['revision']==1
                source=await session.get(CanonicalPlace,sid)
                assert source_fingerprint(source_input(source))==group['sources'][0]['sourceHash']
                assert cat.scope_for_source(sid) is None
                current=[m for m in mentions if scope_matches({'city':'济南','name_keys':group['nameKeys']},m)]
                assert {m['id']:mention_fingerprint(m) for m in current}=={m['id']:m['inputHash'] for m in packet['mentions'] if m['id'] in group['mentionIds']}
                assert len(current)==2 and all(m['raw_note_id']==2585 and not m['note_unavailable'] for m in current)
                assert all(m['reason']=='本地人推荐，有特色且味道好' and m['fact_value'] is None for m in current)
                address,quote,anchor,anchor_lng,anchor_lat=ADDRESS[sid]
                assert all(quote in m['note_desc'] for m in current)
                assert source.address=='' and source.place_type=='food' and source.amap_poi_id==''
                photo=next(r for r in photos['entities'] if r['entityId']==eid)
                assert photo['revision']==1 and photo['category']=='美食' and not photo['assignments'] and not photo['independentSources']
                assert all(v is None for v in photo['currentImageFields'].values())
                for m in current:selected[m['id']]=m
                evidence=[{'kind':'original_note_address','noteId':2585,'quote':quote,'file':review_path,
                    'conclusion':'原文分别列出店名和地址，12提及仅1篇独立来源；保留原名/ID/餐饮类别及原推荐文字，不据同篇相邻合并。'},
                    {'kind':'unsupported_location_cleared','file':'priority-cities/济南/food-address-geo-01.json',
                    'conclusion':'未匹配到原名与原文地址相符的门店POI；旧点远离原文所在街区参照，清空消费坐标但不采用参照点替代。'},
                    {'kind':'candidate_rejected','file':'priority-cities/济南/food-address-geo-02.json',
                    'conclusion':'裸名搜索未补齐本城门店依据；无锡同名炸鸡店不作济南门店身份或坐标证据。'}]
                decisions.append({'key':f'all-cities-20261009-batch-51-source-{sid}-address','city':'济南','entityId':eid,
                    'expectedRevisions':{eid:1},'mergeEntityIds':[],'canonicalName':entity['canonical_name'],'aliases':entity['aliases'],
                    'overrides':{'lat':None,'lng':None,'geoStatus':'unresolvable','address':address},'evidence':evidence})
                expected.append({'city':'济南','id':eid,'name':entity['canonical_name'],'revision':2,'verified':True})
                reviews.append({'entityId':eid,'sourceId':sid,'name':entity['canonical_name'],'mentionIds':group['mentionIds'],
                    'independentNotes':1,'noteId':2585,'address':address,'quote':quote,'category':'美食','xhsPlaceType':'food',
                    'priorPoint':{'lat':source.latitude,'lng':source.longitude},'landmarkReference':{'name':anchor,'lat':anchor_lat,'lng':anchor_lng},
                    'distanceToReferenceKm':round(km(source.longitude,source.latitude,anchor_lng,anchor_lat),2),
                    'referenceMeaning':'仅用于识别原文街区与旧点的明显不相容；不是门店位置、道路边界或自动拒绝距离阈值。',
                    'locationAction':'clear_unsupported_point_keep_original_address_text','preciseLocationResolved':False})
            images=[r for r in await load_image_rows(session,'济南') if r['source_place_id'] in ADDRESS];assert images==[]
            source={'readOnly':True,'capturedAt':datetime.now(timezone.utc).isoformat(),'city':'济南','groups':packet['groups'],
                'sources':[v for g in packet['groups'] for v in g['sources']], 'mentions':[{**m,'inputHash':mention_fingerprint(m)} for m in selected.values()],
                'notes':[n for n in original['notes'] if n['id']==2585],'images':images,'reviews':[],
                'originalSourceFile':packet['originalSourceFile'],'originalSourceSha256':packet['originalSourceSha256']}
        review={'batch':51,'city':'济南','sources':6,'mentions':12,'fullNotes':1,'rows':reviews,'fullOriginalTextRead':True,
            'noNewScopeNeeded':True,'originalFactsPreserved':True,'coordinatesCleared':6,'newPreciseLocations':0,'addressesAdded':6,
            'mapResultsMeaning':'geo01的matched表示返回候选，不能解读为主体匹配；51返回行含50个不匹配POI和1未命中。',
            'webStatus':'search01及沙箱外search02均超时；zhipu search03缺配置；没有已抓取网页可采用。',
            'streetQueryFailure':'429且旧探针未保存部分结果，不作证据；凭据轮换前暂停联网地图请求。',
            'imageComparison':'deferred_by_user','fullReviewPassed':False,'appliedAtFreeze':False}
        write(review_path,review)
        for p,v in zip(paths,[source,packet['catalog'],[],decisions,expected]):write(p,v)
        print(json.dumps({'batch':51,'sourceSha256':hashlib.sha256((ROOT/paths[0]).read_bytes()).hexdigest(),
            'decisions':6,'scopes':0,'coordinatesCleared':6,'addressesAdded':6,'references':[(r['name'],r['distanceToReferenceKm']) for r in reviews]},ensure_ascii=False))
    finally:await engine.dispose()

asyncio.run(main())
