"""第56批：环城公园合计时长、四窟万象坏点、关帝庙具体名称；原文与图片保持。"""
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
park='69ab8bb674e8f0eea31c34c936bddf23';cave='7ac1b9fdfb96a01db695da65d8e81830';temple='c93e3216e2e3cc1b75d07097f2c78367'
def read(p):return json.loads((root/p).read_text(encoding='utf-8'))
def sha(p):return hashlib.sha256((root/p).read_bytes()).hexdigest()
def write(p,v):
    with (root/p).open('x',encoding='utf-8') as f:json.dump(v,f,ensure_ascii=False,indent=2)
async def main():
    pointer=read('cleaning-scope/current.json');assert pointer['latestAppliedEntityBatch']==55 and not pointer['userAcceptance']
    assert pointer['imageComparisonPolicy']['status']=='deferred_by_user'
    packet_path='priority-cities/济南/park-culture-source-packet-01.json';packet=read(packet_path)
    assert sha(packet_path)=='fc1d52df872c1a50e09dcb9d0014a260fad59c636531a9b666304959d6e75880'
    original=read(packet['originalSourceFile']);assert sha(packet['originalSourceFile'])==packet['originalSourceSha256']
    preflight=read('priority-cities/济南/park-culture-photo-preflight-01.json')
    assert preflight['existingPhotoConsumptionPreserved'] and all(m['currentPhotos']==0 for m in preflight['media'])
    cave_reference=read('priority-cities/济南/park-culture-reference-01.json');temple_reference=read('priority-cities/济南/park-culture-reference-02.json')
    assert cave_reference['ok'] and '四窟萬像位於千佛山北麓' in cave_reference['content']
    assert temple_reference['ok'] and '**共青团路关帝庙**' in temple_reference['content'] and '南门西侧' in temple_reference['content'] and '**西蜜脂泉**' in temple_reference['content']
    quote='是济南环城公园(黑虎泉所在）和珍珠泉\n路线放在最后一图，是这次去济南之行中最快乐的两个小时'
    review_path='priority-cities/济南/park-culture-source-review-01.json'
    paths=[f'all-cities/batch-56-{kind}.json' for kind in ['source','catalog','scope-decisions','decisions','export-expectations']]
    assert all(not (root/p).exists() for p in [review_path,*paths])
    try:
        async with SessionFactory() as s:
            await s.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            cat=await load_mention_catalog(s,'济南');rows=await load_mention_rows(s,'济南');selected={};scopes=[]
            for g in packet['groups']:
                eid=g['entity']['entity_id'];sid=g['entity']['primary_place_id'];revision=g['entity']['revision']
                assert cat.catalog.entities[eid]==g['entity'] and cat.scope_for_source(sid) is None
                current=[m for m in rows if scope_matches({'city':'济南','name_keys':g['nameKeys']},m)]
                assert {m['id']:mention_fingerprint(m) for m in current}=={m['id']:m['inputHash'] for m in packet['mentions'] if m['id'] in g['mentionIds']}
                assignments=[]
                for m in current:
                    assert not m['note_unavailable'];selected[m['id']]=m
                    a={'mentionId':m['id'],'inputHash':mention_fingerprint(m),'entityId':eid}
                    if eid==park:
                        assert m['id']==12591 and m['fact_value']['minutes']==120 and quote in m['note_desc']
                        a['factExclusions']={'visit_duration':{'reason':'group_duration','quote':quote}}
                    assignments.append(a)
                scopes.append({'key':f'all-cities-20261009-batch-56-source-{sid}-scope','city':'济南','sourcePlaceId':sid,
                    'expectedSourceHash':g['sources'][0]['sourceHash'],'expectedScopeRevision':0,'expectedRevisions':{eid:revision},
                    'assignments':assignments,'evidence':[{'kind':'reviewed_full_originals','file':review_path,'conclusion':'逐提及明确主体；环城公园排除跨珍珠泉路线合计分钟，四窟万象正负评价同等保留，关帝庙与泉眼/其他同名庙独立。'}]})
            assert set(selected)=={12591,11492,12777,12964}
            assert '千佛山（四窟万象）' in selected[11492]['note_desc'] and selected[11492]['sentiment']=='negative'
            assert '五龙潭南门西侧的关帝庙' in selected[12964]['note_desc']
            decisions=[{'key':'all-cities-20261009-batch-56-cave-location','city':'济南','entityId':cave,'expectedRevisions':{cave:2},'mergeEntityIds':[],
                'canonicalName':'四窟万象','aliases':['四窟万象'],'overrides':{'address':'千佛山景区内','lat':None,'lng':None,'geoStatus':'unresolvable'},
                'evidence':[{'kind':'wrong_point_and_original_area','file':review_path,'conclusion':'原2551明确千佛山（四窟万象），抓取文字互证景区北麓；旧点在城西不匹配。仅写景区内，精确洞口待核，不借千佛山中心点。'}]},
                {'key':'all-cities-20261009-batch-56-temple-qualified-name','city':'济南','entityId':temple,'expectedRevisions':{temple:3},'mergeEntityIds':[],
                'canonicalName':'共青团路关帝庙','aliases':['关帝庙','共青团路关帝庙'],'overrides':{},
                'evidence':[{'kind':'specific_temple_name','file':review_path,'conclusion':'2841五龙潭南门西侧/西蜜脂泉与已抓取共青团路关帝庙正文互证；保留第30批已纠正的筐市街18-3地址及点位，不计为本批定位。'}]}]
            expectations=[{'city':'济南','id':g['entity']['entity_id'],'name':next((d['canonicalName'] for d in decisions if d['entityId']==g['entity']['entity_id']),g['entity']['canonical_name']),
                'revision':g['entity']['revision']+1+(g['entity']['entity_id']!=park),'verified':True,'mentionIds':g['mentionIds']} for g in packet['groups']]
            images=[i for i in await load_image_rows(s,'济南') if i['source_place_id'] in [5952,5480,5994]];assert images==[]
            source={'readOnly':True,'capturedAt':datetime.now(timezone.utc).isoformat(),'city':'济南','groups':packet['groups'],'sources':[v for g in packet['groups'] for v in g['sources']],
                'mentions':[{**m,'inputHash':mention_fingerprint(m)} for m in selected.values()],
                'notes':[n for n in original['notes'] if n['id'] in {m['raw_note_id'] for m in selected.values()}],
                'images':images,'reviews':packet['catalog']['reviews'],'originalSourceFile':packet['originalSourceFile'],'originalSourceSha256':packet['originalSourceSha256']}
        review={'city':'济南','batch':56,'sourcePacket':packet_path,'sources':3,'mentions':4,'fullNotes':4,'scopedMentions':4,'pendingAdded':0,'appliedAtFreeze':False,
            'rows':[{'entityId':park,'sourceId':5952,'mentionIds':[12591],'quote':quote,'conclusion':'120分钟是环城公园与珍珠泉共同路线，不属于环城公园独立停留；排除分钟，保留观泉/接水/蔷薇描述，现行位置不改。','fullReviewPassed':False},
                {'entityId':cave,'sourceId':5480,'mentionIds':[11492,12777],'quote':'千佛山（四窟万象）','conclusion':'两篇原文明确仿制石窟，正负评价均归原主体，不合并四大原址或千佛山；城西旧点不符，只补千佛山景区内并清点，精确洞口待核。','fullReviewPassed':False},
                {'entityId':temple,'sourceId':5994,'mentionIds':[12964],'quote':'五龙潭南门西侧的关帝庙可以顺便看看（免费，院内有西蜜脂泉）','conclusion':'特指共青团路关帝庙；第30批已纠正位置，保持其点位/地址。本批补主名、旧裸名兼容和完整scope，不合并芙蓉街/县西巷/仲宫庙或西蜜脂泉。','fullReviewPassed':False}],
            'ledgerCorrection':{'entityId':temple,'ledgerRevision':1,'actualBeforeRevision':2,'positionCorrectedByBatch':30,'meaning':'台账未同步显示历史已应用版本；不得拿原始源仲宫坐标覆盖现行正确点位。'},
            'externalReferences':[{'file':f'priority-cities/济南/park-culture-reference-0{i}.json','sha256':sha(f'priority-cities/济南/park-culture-reference-0{i}.json'),'url':v['url']} for i,v in [(1,cave_reference),(2,temple_reference)]],
            'webCaveat':'search01/02/03主回答均为计划文字，补充来源经fetch后才使用；官方园林页reference03提取为空，不计为官方验证。Trip页面万像/万象及万佛洞沿革不在本批新增别名，开放时间/票价不扩入。',
            'originalNotesReadInFull':True,'existingImageAnalysesRead':True,'mapRequests':0,'imageComparison':'deferred_by_user','fullReviewPassed':False}
        write(review_path,review)
        for p,v in zip(paths,[source,packet['catalog'],scopes,decisions,expectations]):write(p,v)
        print(json.dumps({'batch':56,'sourceSha256':sha(paths[0]),'decisions':2,'scopes':3,'mentions':4,'newPending':0,'changes':5},ensure_ascii=False))
    finally:await engine.dispose()
asyncio.run(main())
