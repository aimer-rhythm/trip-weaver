"""区分纪念馆与主题墙；纪念馆无scope，保留旧图库消费。"""
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
museum='6a111b28c08cc7853140187bfd852b16';wall='c5a3fae3d839ec359cb0521d957e56df'
def read(p):return json.loads((root/p).read_text(encoding='utf-8'))
def sha(p):return hashlib.sha256((root/p).read_bytes()).hexdigest()
def write(p,v):
    with (root/p).open('x',encoding='utf-8') as f:json.dump(v,f,ensure_ascii=False,indent=2)
async def main():
    pointer=read('cleaning-scope/current.json');assert pointer['latestAppliedEntityBatch']==54 and not pointer['userAcceptance']
    assert pointer['imageComparisonPolicy']['status']=='deferred_by_user'
    packet_path='priority-cities/济南/laoshe-source-packet-01.json';packet=read(packet_path)
    assert sha(packet_path)=='0e6805dfe255cbb6338ad89ae60dedc9d28f6de9cfe8261bf3f48762393a9df5'
    original=read(packet['originalSourceFile']);assert sha(packet['originalSourceFile'])==packet['originalSourceSha256']
    photos=read('priority-cities/济南/laoshe-photo-metadata-01.json');preflight=read('priority-cities/济南/laoshe-photo-preflight-01.json')
    assert preflight['museumScopeMustWaitForMedia'] and preflight['media'][0]['currentPhotos']==2 and preflight['media'][1]['currentPhotos']==0
    reference_path='priority-cities/济南/laoshe-reference-01.json';reference=read(reference_path)
    assert reference['ok'] and '南新街58号' in reference['content'] and '**济南老舍纪念馆**，又称**济南老舍故居**' in reference['content']
    supplemental=next(n for n in original['notes'] if n['id']==2570)
    wall_quote='🕥13:30-14:30📍西更道街（p4.10）\n📷5号拍老舍笔下的济南墙 1号拍簪花少女墙'
    assert wall_quote in supplemental['note_desc']
    review_path='priority-cities/济南/laoshe-source-review-01.json'
    paths=[f'all-cities/batch-55-{kind}.json' for kind in ['source','catalog','scope-decisions','decisions','export-expectations']]
    assert all(not (root/p).exists() for p in [review_path,*paths])
    selected={}
    try:
        async with SessionFactory() as s:
            await s.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            cat=await load_mention_catalog(s,'济南');all_mentions=await load_mention_rows(s,'济南')
            for g in packet['groups']:
                eid=g['entity']['entity_id'];sid=g['entity']['primary_place_id']
                assert cat.catalog.entities[eid]==g['entity'] and cat.scope_for_source(sid) is None
                current=[m for m in all_mentions if scope_matches({'city':'济南','name_keys':g['nameKeys']},m)]
                assert {m['id']:mention_fingerprint(m) for m in current}=={m['id']:m['inputHash'] for m in packet['mentions'] if m['id'] in g['mentionIds']}
                for m in current:assert not m['note_unavailable'];selected[m['id']]=m
            assert set(selected)=={11619,12807,12912,12694}
            m=selected[12694];assert m['raw_note_id']==2817 and '⑧老舍笔下的济南' in m['note_desc']
            image_text='\n'.join(i.get('text_content','') for i in m['note_images'] or [])
            assert '总得来趟 老舍笔下的济南' in image_text
            g=next(g for g in packet['groups'] if g['entity']['entity_id']==wall)
            scopes=[{'key':'all-cities-20261009-batch-55-source-5957-scope','city':'济南','sourcePlaceId':5957,
                'expectedSourceHash':g['sources'][0]['sourceHash'],'expectedScopeRevision':0,'expectedRevisions':{wall:1},
                'assignments':[{'mentionId':12694,'inputHash':mention_fingerprint(m),'entityId':wall}],
                'evidence':[{'kind':'reviewed_named_theme_wall','file':review_path,'conclusion':'2817为可打卡的实体主题墙，与2570西更道街5号正文及既有文字分析相互支持，不是文学概念或南新街纪念馆。'}]}]
            decisions=[{'key':'all-cities-20261009-batch-55-museum-name-address','city':'济南','entityId':museum,
                'expectedRevisions':{museum:1},'mergeEntityIds':[],'canonicalName':'济南老舍纪念馆','aliases':['老舍故居','老舍纪念馆','济南老舍纪念馆'],
                'overrides':{'address':'南新街58号'},'evidence':[{'kind':'museum_name_and_documented_address_only','file':review_path,
                'conclusion':'2810既有文字分析为老舍纪念馆，公开条目互证故居同体及南新街58号。保留原坐标但不新增定位结论；不加scope以保留实际2图，距离描述另记待处理。'}]},
                {'key':'all-cities-20261009-batch-55-wall-identity-location','city':'济南','entityId':wall,
                'expectedRevisions':{wall:2},'mergeEntityIds':[],'canonicalName':'老舍笔下的济南主题墙','aliases':['老舍笔下的济南','老舍笔下的济南主题墙'],
                'overrides':{'address':'西更道街5号','lat':None,'lng':None,'geoStatus':'unresolvable','xhsPlaceType':'photo_spot'},
                'evidence':[{'kind':'separate_wall_from_museum','file':review_path,'conclusion':'用明确原文墙面补主体后缀与地址；清除与南新街故居完全相同的旧点，不借街道或门店坐标。分类文化保持，细类型改photo_spot。'}]}]
            expectations=[{'city':'济南','id':wall,'name':'老舍笔下的济南主题墙','revision':3,'verified':True,'mentionIds':[12694]}]
            images=[i for i in await load_image_rows(s,'济南') if i['source_place_id'] in [5498,5957]];assert images==[]
            source={'readOnly':True,'capturedAt':datetime.now(timezone.utc).isoformat(),'city':'济南','groups':packet['groups'],
                'sources':[v for g in packet['groups'] for v in g['sources']],'mentions':[{**m,'inputHash':mention_fingerprint(m)} for m in selected.values()],
                'notes':[n for n in original['notes'] if n['id'] in {m['raw_note_id'] for m in selected.values()}],
                'supplementalNotes':[supplemental],'images':images,'reviews':[],'originalSourceFile':packet['originalSourceFile'],'originalSourceSha256':packet['originalSourceSha256']}
        review={'city':'济南','batch':55,'sourcePacket':packet_path,'sources':2,'mentions':4,'fullNotes':3,'supplementalFullNotes':1,
            'scopedMentions':1,'pendingAdded':0,'museumScopeApplied':False,'wallScopeApplied':True,'appliedAtFreeze':False,
            'rows':[{'entityId':museum,'sourceId':5498,'mentionIds':[11619,12807,12912],'identityConclusion':'12807同篇既有文字分析明确老舍纪念馆；公开文字支持南新街58号故居与纪念馆同体，不等于主题墙。',
                'locationConclusion':'补文字地址，原坐标保持但尚未新验证，不以和主题墙旧点相同推断纪念馆旧点也错。',
                'pendingFactFinding':{'mentionIds':[11619,12912],'noteId':2624,'originalReason':'从五龙潭南门出500米即到，可顺路参观。',
                    'quote':'第一站五龙潭，七点开园，一个小时就能逛完，西门进南门出，斜对过就是趵突泉啦，，，园子不小，里面有点东西，可以仔细逛一下呢。\n接着想去老舍故居就从南门出，500米就是老舍故居',
                    'conclusion':'原文南门前已引入趵突泉，抽取直接固化为五龙潭南门，起点并未可靠定位。只记录两描述待修，不伪造原文或补新距离。',
                    'status':'unapplied_description_scope_preserve_existing_photo_consumption'},'actualPhotos':2,'fullReviewPassed':False},
                {'entityId':wall,'sourceId':5957,'mentionIds':[12694],'identityConclusion':'2817及既有文字分析为实体主题墙；2570正文明确西更道街5号，与南新街58号纪念馆不同。',
                    'supplementalNoteId':2570,'quote':wall_quote,'newName':'老舍笔下的济南主题墙','address':'西更道街5号',
                    'locationConclusion':'清不匹配旧点，文字门牌不等于精确墙面坐标；不把西更道街1号簪花少女墙合并。','actualPhotos':0,'fullReviewPassed':False}],
            'externalReference':{'file':reference_path,'sha256':sha(reference_path),'url':reference['url'],'use':'故居/纪念馆名称与地址互证；不采纳其中同名展陈为室外主题墙。'},
            'primaryReferenceCaveat':'laoshe-reference-02济南日报成功抓取但无58号门牌；地址依据为已抓取百科正文，不能标记为官方门牌核验。',
            'originalNotesReadInFull':True,'existingImageAnalysesRead':True,'mapRequests':0,'imageComparison':'deferred_by_user','fullReviewPassed':False,
            'scopeBoundary':'1903 MIX/品忆香/fufuland/喜艾不在原济南107源重点冻结包；本轮不扩入主动治理。'}
        for row in review['rows']:
            if row.get('pendingFactFinding'):assert row['pendingFactFinding']['quote'] in selected[11619]['note_desc']
        write(review_path,review)
        for p,v in zip(paths,[source,packet['catalog'],scopes,decisions,expectations]):write(p,v)
        print(json.dumps({'batch':55,'sourceSha256':sha(paths[0]),'decisions':2,'scopes':1,'mentions':4,'newPending':0,'museumScopeDeferred':True},ensure_ascii=False))
    finally:await engine.dispose()
asyncio.run(main())
