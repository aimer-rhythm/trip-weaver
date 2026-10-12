"""第62批：街道/廊道类别、街道停留范围和未确认分店；有效负面意见不丢弃。"""
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
    pointer=read('cleaning-scope/current.json');assert pointer['latestAppliedEntityBatch']==61 and not pointer['userAcceptance']
    assert pointer['imageComparisonPolicy']['status']=='deferred_by_user'
    pp='priority-cities/济南/remaining-streets-source-packet-01.json';packet=read(pp)
    assert hashlib.sha256((root/pp).read_bytes()).hexdigest()=='bad993b7d5bd657fe860c149c3ea66db204f37f08f99813e0c79805d1e0691e3'
    rp='priority-cities/济南/remaining-streets-source-review-01.json';wp='priority-cities/济南/remaining-streets-web-review-01.json'
    paths=[f'all-cities/batch-62-{kind}.json' for kind in ['source','catalog','scope-decisions','decisions','export-expectations']]
    assert all(not (root/p).exists() for p in [rp,wp,*paths])
    photo=read('priority-cities/济南/remaining-streets-photo-metadata-01.json');assert len(photo['entities'])==5 and all(not p['independentSources'] and not p['assignments'] for p in photo['entities'])
    pre=read('priority-cities/济南/remaining-streets-photo-preflight-01.json');assert pre['existingPhotoConsumptionPreserved'] and pre['mockEnqueues']==5
    extra=read('priority-cities/济南/remaining-streets-mixed-tip-source-01.json');assert [n['noteId'] for n in extra['notes']]==[2568]
    assert any('别在芙蓉街买小吃，又贵又不正宗' in m['text'] for m in extra['notes'][0]['matchingText'])
    original=read(packet['originalSourceFile']);assert hashlib.sha256((root/packet['originalSourceFile']).read_bytes()).hexdigest()==packet['originalSourceSha256']
    reasons={5353:'历史商业街是公共街道主体，美食是街内活动，不是单一餐饮店。改为文化/other，完整继承第30批历下区地址与已纠正点位，不重新定位。30条全文中12904/2853及12948/2857实际描述未具名餐馆；另note2568现有图片文字确含作者负面意见。现协议完整scope会删除整条混合tips且没有已确认提及承接该意见，故本批不加scope，原两条负面提及、混合提示、现有事实均保持；两餐馆归属与提示净化登记未应用，不冒充已完成。',
      5393:'两篇正文明确以后宰门街为路线停留主体，拍墙是该次街道活动。note2570的16:00–16:30是独立街道停留，不是与曲水亭或百花洲合计时长，11460/12726同篇30分钟只算一个独立样本；12690保留第二篇簪花文字墙的限定看点。确认3条完整scope，改文化/other，不把街道改名墙面、不合并济南文字墙/济南墙；原点保持但未新定位。',
      5403:'原文独立写逛腊山河廊道吹晚风，公开全文支持腊山河城市滨河生态景观。只将文化改自然、保留attraction，保留原理由、名称/ID和原点，未确定具体廊道段或精确位置；不采用仅标题可见的南延工程内容，不合并整条河流。无需建立scope。',
      5382:'两篇全文三次提及只有裸名油旋张；公开2024食记分别写纬三路79号和另一个大观园店，现有note2548地图文字是宝鸡扯面检索中的顺带候选，不能证明本次到访分店。3条均待审，显式撤回旧单店消费，不创建候选、不标not_a_place，不采用营业时间/价格/传承人。',
      6002:'原文确写泉源之眼，不能凭另一笔记的泉城之眼或相似名字认定同体。搜索未取得同体正文；保持revision2及既有空点，不重命名、不合并、不重复清点。'}
    selected={};scopes=[];decisions=[];expectations=[];rows=[]
    try:
        async with SessionFactory() as s:
            await s.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            cat=await load_mention_catalog(s,'济南');mentions=await load_mention_rows(s,'济南')
            for g in packet['groups']:
                e=g['entity'];eid=e['entity_id'];sid=e['primary_place_id'];assert cat.catalog.entities[eid]==e and cat.scope_for_source(sid) is None
                current=[m for m in mentions if scope_matches({'city':'济南','name_keys':g['nameKeys']},m)]
                assert {m['id']:mention_fingerprint(m) for m in current}=={m['id']:m['inputHash'] for m in packet['mentions'] if m['id'] in g['mentionIds']}
                rows.append({'entityId':eid,'sourceId':sid,'name':e['canonical_name'],'mentionIds':g['mentionIds'],'action':'read_only_boundary_pending' if sid==6002 else 'scope_and_category' if sid==5393 else 'branch_withdrawal' if sid==5382 else 'category_only','conclusion':reasons[sid]})
                if sid==6002:continue
                for m in current:assert not m['note_unavailable'];selected[m['id']]=m
                revision=e['revision'];key=f'all-cities-20261009-batch-62-source-{sid}'
                if sid in [5393,5382]:
                    target=eid if sid==5393 else None
                    if sid==5393:
                        note=next(m for m in current if m['raw_note_id']==2570)['note_desc'];assert '16:00-16:30' in note and '后宰门街' in note
                    scopes.append({'key':key+'-scope','city':'济南','sourcePlaceId':sid,'expectedSourceHash':g['sources'][0]['sourceHash'],
                      'expectedScopeRevision':0,'expectedRevisions':{eid:revision},'assignments':[{'mentionId':m['id'],'inputHash':mention_fingerprint(m),'entityId':target} for m in current],
                      'evidence':[{'kind':'reviewed_full_text_street_and_branch_scope','file':rp,'mentionIds':g['mentionIds'],'conclusion':reasons[sid]}]});revision+=1
                if sid in [5353,5393,5403]:
                    overrides={**e['overrides'],'category':'自然' if sid==5403 else '文化','xhsPlaceType':'attraction' if sid==5403 else 'other'}
                    decisions.append({'key':key+'-category','city':'济南','entityId':eid,'expectedRevisions':{eid:revision},'mergeEntityIds':[],
                      'canonicalName':e['canonical_name'],'aliases':e['aliases'],'overrides':overrides,
                      'evidence':[{'kind':'reviewed_street_or_river_corridor_subject','file':rp,'publicEvidence':wp,'conclusion':reasons[sid]}]});revision+=1
                expectations.append({'city':'济南','id':eid,'name':e['canonical_name'],'revision':revision,'verified':sid!=5382,
                  **({'mentionIds':sorted(g['mentionIds'])} if sid==5393 else {'mentionIds':[],'candidateIds':[]} if sid==5382 else {})})
            images=[i for i in await load_image_rows(s,'济南') if i['source_place_id'] in [5353,5393,5403,5382]];assert images==[]
        groups=[g for g in packet['groups'] if g['entity']['primary_place_id']!=6002];ids={g['entity']['entity_id'] for g in groups};nids={m['raw_note_id'] for m in selected.values()}
        source={'readOnly':True,'capturedAt':datetime.now(timezone.utc).isoformat(),'city':'济南','groups':groups,'sources':[v for g in groups for v in g['sources']],
          'mentions':[{**m,'inputHash':mention_fingerprint(m)} for m in selected.values()],'notes':[n for n in original['notes'] if n['id'] in nids],
          'noteTimes':[t for t in packet['noteTimes'] if t['noteId'] in nids],'images':images,'reviews':packet['catalog']['reviews'],'originalSourceFile':packet['originalSourceFile'],'originalSourceSha256':packet['originalSourceSha256']}
        history={'entities':[e for e in packet['catalog']['entities'] if e['entity_id'] in ids],'members':[m for m in packet['catalog']['members'] if m['entity_id'] in ids],'reviews':packet['catalog']['reviews']}
        review={'city':'济南','batch':62,'sourcePacket':pp,'reviewedSources':5,'reviewedMentions':38,'fullNotes':28,'supplementalFullNotes':1,'appliedSources':4,'appliedMentions':6,'frozenMentions':len(source['mentions']),'frozenNotes':len(source['notes']),
          'confirmed':3,'pending':3,'withdrawals':1,'categoryDecisions':3,'newEntities':0,'rows':rows,'originalNotesReadInFull':True,'existingImageAnalysesRead':True,'noNotAPlaceExclusions':True,
          'furongUnapplied':{'sourceId':5353,'mentionIds':[12904,12948],'notes':[2853,2857],'mixedTipNoteId':2568,'reason':'完整scope将同时丢失已定位原文的有效作者负面意见，当前协议无已确认图片文字事实承接；本批保留现有消费，不作scope完成声明。'},
          'coordinatesExplicitlyCleared':0,'withdrawnCoordinatesRemoved':1,'newPreciseLocations':0,'imageComparison':'deferred_by_user','fullReviewPassed':False,'appliedAtFreeze':False}
        web={'batch':62,'references':[{'file':'remaining-streets-reference-01.json','use':'齐鲁网正文确认芙蓉街历史商业街主体，仅用于文化/other分类，不采纳沿街单店身份。'},
          {'file':'remaining-streets-reference-02.json','use':'百科正文支持腊山河滨河生态景观，仅用于自然类，不确认特定廊道段或坐标。'},
          {'file':'remaining-streets-reference-03.json','use':'2024食记明确纬三路79号及另一个大观园店，只作存在分店候选的补证。'},
          {'file':'remaining-streets-reference-04.json','use':'仅标题/导航，无正文，不采纳工程详情。'}],
          'searchesWithoutClaimEvidence':['remaining-streets-search-01.json','remaining-streets-search-05.json'],'noWebHoursPricesPersonsAdopted':True,'noImageViewed':True,'userAcceptance':False}
        write(rp,review);write(wp,web)
        for p,v in zip(paths,[source,history,scopes,decisions,expectations]):write(p,v)
        print(json.dumps({'batch':62,'sourceSha256':hashlib.sha256((root/paths[0]).read_bytes()).hexdigest(),'sources':len(groups),'mentions':len(source['mentions']),'notes':len(source['notes']),'scopes':len(scopes),'decisions':len(decisions)},ensure_ascii=False))
    finally:await engine.dispose()
asyncio.run(main())
