"""第60批：未定位品牌停止代指单店，保留济南西明确提及，陈氏只读核查。"""
from pathlib import Path
from datetime import datetime,timezone
import asyncio,hashlib,json,sys
sys.dont_write_bytecode=True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0,'D:/Project/xhs-travel-pipeline')
from sqlalchemy import text
from app.db import SessionFactory,engine
from app.aggregate.mention_identity import load_mention_catalog,load_mention_rows
from app.aggregate.image_identity import load_image_rows
from app.clean.mention_identity import mention_fingerprint,scope_matches
root=Path(__file__).resolve().parent
def read(p):return json.loads((root/p).read_text(encoding='utf-8'))
def write(p,v):
    with (root/p).open('x',encoding='utf-8') as f:json.dump(v,f,ensure_ascii=False,indent=2)
async def main():
    pointer=read('cleaning-scope/current.json');assert pointer['latestAppliedEntityBatch']==59 and not pointer['userAcceptance']
    assert pointer['imageComparisonPolicy']['status']=='deferred_by_user'
    packet_path='priority-cities/济南/remaining-food-source-packet-01.json';packet=read(packet_path)
    assert hashlib.sha256((root/packet_path).read_bytes()).hexdigest()=='48e8753038a64bdc397fb19083b4bf5cc2645f52eb8677815119caa573f6bfe4'
    review_path='priority-cities/济南/remaining-food-source-review-01.json';web_path='priority-cities/济南/remaining-food-web-review-01.json'
    paths=[f'all-cities/batch-60-{kind}.json' for kind in ['source','catalog','scope-decisions','decisions','export-expectations']]
    assert all(not (root/p).exists() for p in [review_path,web_path,*paths])
    refs={n:read('priority-cities/济南/remaining-food-reference-'+n+'.json') for n in ['02','03','05','06','07','10','11']}
    assert all(r['ok'] for r in refs.values())
    assert '铜元局后街28号' in refs['02']['content'] and '花店街25号' in refs['11']['content']
    assert '280+' in refs['07']['content'] and '连锁' in refs['07']['content']
    assert '草包包子铺(普利街总店)' in refs['10']['content'] and '经七路423-2号' in refs['05']['content']
    photos=read('priority-cities/济南/remaining-food-photo-metadata-01.json')
    assert len(photos['entities'])==5 and all(not p['independentSources'] and not p['assignments'] for p in photos['entities'])
    preflight=read('priority-cities/济南/remaining-food-photo-preflight-01.json');assert preflight['existingPhotoConsumptionPreserved'] and preflight['mockEnqueues']==5
    original=read(packet['originalSourceFile']);assert hashlib.sha256((root/packet['originalSourceFile']).read_bytes()).hexdigest()==packet['originalSourceSha256']
    reasons={5378:'三篇全文仅推荐连锁品牌/把子肉，无黑虎泉西路门店限定。公开正文证实济南多门店；不能按旧点选择分店，4条待审。',
        5377:'两篇均未给完整分店名；最近一家不唯一，图片文字是宝鸡扯面搜索地图，露出大明湖标签但未指明就餐目的地。公开正文证实大明湖与五龙潭公园两店，不能按邻近代选。',
        5384:'同篇重复抽取仅说草包包子与口味，未给分店；公开普利街总店与旧千佛山东路地址不能据裸名判等。全条待审，品牌/食品存在不等于非地点。',
        5401:'11375全文明确济南西旁边并给菜品，可归该西部店铺主体；12806只有裸名和同类菜单，菜单相似不证明同店，继续待审。旧梁庄地址/点无原文支持，改原文概略济南西周边、清坐标，不指定潍坊路门牌。'}
    rows=[];scopes=[];decisions=[];expected=[];selected={}
    try:
        async with SessionFactory() as s:
            await s.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            cat=await load_mention_catalog(s,'济南');all_mentions=await load_mention_rows(s,'济南')
            for group in packet['groups']:
                entity=group['entity'];eid=entity['entity_id'];sid=entity['primary_place_id']
                assert cat.catalog.entities[eid]==entity and cat.scope_for_source(sid) is None
                current=[m for m in all_mentions if scope_matches({'city':'济南','name_keys':group['nameKeys']},m)]
                assert {m['id']:mention_fingerprint(m) for m in current}=={m['id']:m['inputHash'] for m in packet['mentions'] if m['id'] in group['mentionIds']}
                if sid==5485:
                    rows.append({'entityId':eid,'sourceId':sid,'name':entity['canonical_name'],'mentionIds':group['mentionIds'],'action':'read_only_identity_facts_reviewed_location_media_pending',
                        'conclusion':'两篇正文分别为餐饮体验和名单推荐，保留现行消费；2018公开正文支持现有经七路423-2号历史门牌，不证明2026精确点或不存在分店。不把陈氏鲁菜当别名，不为统计添加scope。'})
                    continue
                assignments=[]
                for m in current:
                    assert not m['note_unavailable'];selected[m['id']]=m
                    target=eid if m['id']==11375 else None
                    assignments.append({'mentionId':m['id'],'inputHash':mention_fingerprint(m),'entityId':target})
                    quote=next(line for line in m['note_desc'].splitlines() if entity['canonical_name'] in line)
                    rows.append({'entityId':eid,'sourceId':sid,'name':entity['canonical_name'],'mentionId':m['id'],'noteId':m['raw_note_id'],'quote':quote,'targetEntityId':target,
                        'action':'confirmed_west_jinan_restaurant' if target else 'specific_branch_unresolved','conclusion':reasons[sid]})
                scopes.append({'key':f'all-cities-20261009-batch-60-source-{sid}-scope','city':'济南','sourcePlaceId':sid,'expectedSourceHash':group['sources'][0]['sourceHash'],
                    'expectedScopeRevision':0,'expectedRevisions':{eid:1},'assignments':assignments,'evidence':[{'kind':'reviewed_restaurant_branch_scope','file':review_path,'mentionIds':group['mentionIds'],'conclusion':reasons[sid]}]})
                approved=sid==5401
                expected.append({'city':'济南','id':eid,'name':entity['canonical_name'],'revision':3 if approved else 2,'verified':approved,'mentionIds':[11375] if approved else [],**({} if approved else {'candidateIds':[]})})
                if approved:
                    assert '就在济南西旁边' in current[0]['note_desc'] and '济南西周边一日旅游' in current[0]['note_desc']
                    decisions.append({'key':'all-cities-20261009-batch-60-west-restaurant-location','city':'济南','entityId':eid,'expectedRevisions':{eid:2},'mergeEntityIds':[],
                        'canonicalName':entity['canonical_name'],'aliases':entity['aliases'],'overrides':{'address':'济南西周边','lat':None,'lng':None,'geoStatus':'unresolvable'},
                        'evidence':[{'kind':'original_note_location_boundary','file':review_path,'quote':'就在济南西旁边','conclusion':'保留原文西部位置限定，旧梁庄门牌与点位不继承；不伪造官方分店名，精确位置继续待核。'}]})
            images=[i for i in await load_image_rows(s,'济南') if i['source_place_id'] in [5378,5377,5384,5401]];assert images==[]
        groups=[g for g in packet['groups'] if g['entity']['primary_place_id']!=5485];ids={g['entity']['entity_id'] for g in groups};nids={m['raw_note_id'] for m in selected.values()}
        source={'readOnly':True,'capturedAt':datetime.now(timezone.utc).isoformat(),'city':'济南','groups':groups,'sources':[v for g in groups for v in g['sources']],
            'mentions':[{**m,'inputHash':mention_fingerprint(m)} for m in selected.values()],'notes':[n for n in original['notes'] if n['id'] in nids],
            'noteTimes':[t for t in packet['noteTimes'] if t['noteId'] in nids],'images':images,'reviews':[], 'originalSourceFile':packet['originalSourceFile'],'originalSourceSha256':packet['originalSourceSha256']}
        history={'entities':[e for e in packet['catalog']['entities'] if e['entity_id'] in ids],'members':[m for m in packet['catalog']['members'] if m['entity_id'] in ids],'reviews':[]}
        assert len(source['mentions'])==10 and len(source['notes'])==5
        web={'readOnly':True,'businessMutations':False,'adoptedReferences':['remaining-food-reference-'+n+'.json' for n in refs],
            'findings':{'超意兴':'界面转载正文明确连锁及济南多个门店，仅证实多门店，不将文中数量当2026现状。官网fetch空。',
                '春水锅贴':'360与中新网正文支持大明湖店铜元局后街28号，携程正文支持五龙潭公园店花店街25号；两店均为候选，不借图中文字或最近一词选店。地图导航坐标未采用。',
                '草包包子':'旅行站正文仅支持普利街总店候选，与旧千佛山东路没有同体证据。百科1937仅搜索摘要、fetch失败，不据此裁定百年说法真伪。',
                '天天过年':'原始全文明确济南西旁边；点评地址fetch空，搜索主回答曾把济南西与梁庄混作一处，不采用。临沂同名火锅店、公交站不作门店依据。',
                '陈氏肥蛤':'2018微博正文经七路423-2号支持历史门牌，2016餐饮文章支持店名/餐品；不把历史文本当现时营业、价格或精确坐标证明。'},
            'failedSearches':['remaining-food-search-03.json','remaining-food-search-05.json'],'failedFetches':['01','04','08','09'],
            'imageComparison':'deferred_by_user','fullReviewPassed':False}
        review={'city':'济南','batch':60,'sourcePacket':packet_path,'reviewedSources':5,'reviewedMentions':12,'fullNotes':7,'appliedSources':4,'appliedMentions':10,'confirmed':1,'pending':9,'withdrawals':3,'newEntities':0,
            'rows':rows,'originalNotesReadInFull':True,'existingImageAnalysesRead':True,'noNotAPlaceExclusions':True,'ordinaryReviewed':1,'coordinatesExplicitlyCleared':1,
            'withdrawnCoordinatesRemoved':3,'newPreciseLocations':0,'imageComparison':'deferred_by_user','fullReviewPassed':False,'appliedAtFreeze':False}
        write(web_path,web);write(review_path,review)
        for p,v in zip(paths,[source,history,scopes,decisions,expected]):write(p,v)
        print(json.dumps({'batch':60,'sourceSha256':hashlib.sha256((root/paths[0]).read_bytes()).hexdigest(),'confirmed':1,'pending':9,'withdrawals':3,'readOnlySubjects':1},ensure_ascii=False))
    finally:await engine.dispose()
asyncio.run(main())
