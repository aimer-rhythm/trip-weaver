"""环联夜市迁址后名称地址与旧导航提及隔离，保留原记录。"""
from pathlib import Path
from datetime import datetime,timezone
import asyncio,hashlib,json,sys
sys.dont_write_bytecode=True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0,'D:/Project/xhs-travel-pipeline')
from sqlalchemy import select,text
from app.db import SessionFactory,engine
from app.models import RawNote
from app.aggregate.mention_identity import load_mention_catalog,load_mention_rows
from app.aggregate.image_identity import load_image_rows
from app.clean.mention_identity import mention_fingerprint,scope_matches
root=Path(__file__).resolve().parent
def read(p):return json.loads((root/p).read_text(encoding='utf-8'))
def write(p,v):
    with (root/p).open('x',encoding='utf-8') as f:json.dump(v,f,ensure_ascii=False,indent=2)
async def main():
    pointer=read('cleaning-scope/current.json');assert pointer['latestAppliedEntityBatch']==58 and not pointer['userAcceptance']
    assert pointer['imageComparisonPolicy']['status']=='deferred_by_user'
    packet_path='priority-cities/济南/night-market-source-packet-01.json';packet=read(packet_path)
    assert hashlib.sha256((root/packet_path).read_bytes()).hexdigest()=='c9af695aff01170284e128bdaa75ebab36ed8ef1dc2094d67d6812b84a27550a'
    eid='7950bfadd891932d01be8636aba8b51a';sid=5358;group=packet['groups'][0];name='环联1904火车夜市'
    review_path='priority-cities/济南/night-market-source-review-01.json';paths=[f'all-cities/batch-59-{kind}.json' for kind in ['source','catalog','scope-decisions','decisions','export-expectations']]
    assert all(not (root/p).exists() for p in [review_path,*paths])
    refs=[read('priority-cities/济南/night-market-reference-'+n+'.json') for n in ['04','05']]
    assert all(r['ok'] and name in r['content'] and '祝舜路555号' in r['content'] for r in refs)
    photo=read('priority-cities/济南/night-market-photo-metadata-01.json')['entities'][0]
    assert photo['revision']==1 and len(photo['independentSources'])==10 and all(not s['eligible'] for s in photo['independentSources']) and not photo['assignments']
    preflight=read('priority-cities/济南/night-market-photo-preflight-01.json');assert preflight['existingPhotoConsumptionPreserved'] and preflight['mockEnqueues']==1
    original=read(packet['originalSourceFile']);assert hashlib.sha256((root/packet['originalSourceFile']).read_bytes()).hexdigest()==packet['originalSourceSha256']
    try:
        async with SessionFactory() as s:
            await s.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            cat=await load_mention_catalog(s,'济南');assert cat.catalog.entities[eid]==group['entity'] and cat.scope_for_source(sid) is None
            current=[m for m in await load_mention_rows(s,'济南') if scope_matches({'city':'济南','name_keys':group['nameKeys']},m)]
            assert {m['id']:mention_fingerprint(m) for m in current}=={m['id']:m['inputHash'] for m in packet['mentions']}
            assert {m['id'] for m in current}=={11464,11571,11607,12647,12825}
            for f in packet['noteTimes']:
                n=await s.get(RawNote,f['noteId']);assert n.publish_time.isoformat()==f['publishTime'] and n.created_at.isoformat()==f['collectedAt']
                assert hashlib.sha256(json.dumps(n.raw_json,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()==f['rawJsonSha256']
                assert int(n.publish_time.timestamp()*1000)==next(t['value'] for t in f['rawTimeFields'] if t['path']=='.note_card.time')
            assignments=[];rows=[]
            for m in current:
                assert not m['note_unavailable'];target=None if m['id']==11464 else eid
                if target is None:
                    quote='📍：济南市历城区祝舜路1469号';reason='身份可辨但正文和两条看点含迁址前门牌/交通导航；近期发表不能消除旧址事实冲突，整条待审，原正评保留。'
                else:
                    quote=next(line for line in m['note_desc'].splitlines() if '环联夜市' in line)
                    reason='近期原文明确同一持续运营市场，规模/拥挤/交通观点按原文保留；不据发布时间推断到访日或精确位置。'
                assert quote in m['note_desc'];assignments.append({'mentionId':m['id'],'inputHash':mention_fingerprint(m),'entityId':target})
                rows.append({'mentionId':m['id'],'noteId':m['raw_note_id'],'quote':quote,'reason':reason,'entityId':target,'status':'reviewed_market' if target else 'stale_navigation_facts_pending'})
            images=[i for i in await load_image_rows(s,'济南') if i['source_place_id']==sid];assert images==[]
            scope={'key':'all-cities-20261009-batch-59-source-5358-scope','city':'济南','sourcePlaceId':sid,'expectedSourceHash':group['sources'][0]['sourceHash'],
                'expectedScopeRevision':0,'expectedRevisions':{eid:1},'assignments':assignments,'evidence':[{'kind':'reviewed_relocated_market_scope','file':review_path,'mentionIds':group['mentionIds'],
                    'conclusion':'四条市场正负观点保留，11464旧导航事实整条待审；原始来源、评价与日期不改。'}]}
            decision={'key':'all-cities-20261009-batch-59-market-name-address','city':'济南','entityId':eid,'expectedRevisions':{eid:2},'mergeEntityIds':[],
                'canonicalName':name,'aliases':list(dict.fromkeys([*group['entity']['aliases'],name])),'overrides':{'address':'祝舜路555号'},
                'evidence':[{'kind':'published_market_relocation_and_rename','file':'priority-cities/济南/night-market-web-review-02.json',
                    'conclusion':'2023迁址开业公告与2025回顾确认同一运营市场更名迁址；保留稳定ID与旧名别名，只补新名和新门牌，原坐标未证明错误则保留待核。'}]}
            source={'readOnly':True,'capturedAt':datetime.now(timezone.utc).isoformat(),'city':'济南','groups':[group],'sources':group['sources'],
                'mentions':[{**m,'inputHash':mention_fingerprint(m)} for m in current],'notes':[n for n in original['notes'] if n['id'] in {m['raw_note_id'] for m in current}],
                'noteTimes':packet['noteTimes'],'images':images,'reviews':[],'originalSourceFile':packet['originalSourceFile'],'originalSourceSha256':packet['originalSourceSha256']}
        review={'city':'济南','batch':59,'sourcePacket':packet_path,'sources':1,'mentions':5,'fullNotes':4,'confirmed':4,'pending':1,'rows':rows,
            'originalNotesReadInFull':True,'existingImageAnalysesRead':True,'publicationTimesCheckedAgainstRawJson':True,'publicationDoesNotProveVisitTime':True,
            'locationStatus':'published_address_corrected_existing_point_preserved_not_newly_verified','newEntities':0,'positivePending':1,'negativeConfirmed':3,
            'independentSources':10,'eligibleIndependentSources':0,'imageComparison':'deferred_by_user','fullReviewPassed':False,'appliedAtFreeze':False}
        write(review_path,review)
        for p,v in zip(paths,[source,packet['catalog'],[scope],[decision],[{'city':'济南','id':eid,'name':name,'revision':3,'verified':True,'mentionIds':[11571,11607,12647,12825]}]]):write(p,v)
        print(json.dumps({'batch':59,'sourceSha256':hashlib.sha256((root/paths[0]).read_bytes()).hexdigest(),'confirmed':4,'pending':1},ensure_ascii=False))
    finally:await engine.dispose()
asyncio.run(main())
