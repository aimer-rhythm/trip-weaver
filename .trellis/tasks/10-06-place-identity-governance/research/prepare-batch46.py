"""从第45批后实库冻结红绿灯描述修正；不改原文、不查看图片。"""
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
from app.clean.mention_identity import mention_fingerprint,source_fingerprint,scope_matches,validate_fact_exclusions
root=Path(__file__).resolve().parent
def read(p):return json.loads((root/p).read_text(encoding='utf-8'))
def write(p,v):
    with (root/p).open('x',encoding='utf-8') as f:json.dump(v,f,ensure_ascii=False,indent=2)
async def main():
    pointer=read('cleaning-scope/current.json');assert pointer['latestAppliedEntityBatch']==45 and pointer['userAcceptance'] is False
    packet_path='priority-cities/济南/commercial-source-packet-01.json'
    assert hashlib.sha256((root/packet_path).read_bytes()).hexdigest()=='b238f038008e23be87e945b3f669782aea85f8c0f9b0b808e43d1b618bf43834'
    packet=read(packet_path);g=next(g for g in packet['groups'] if g['entity']['primary_place_id']==5970);eid=g['entity']['entity_id']
    original=read(packet['originalSourceFile']);assert hashlib.sha256((root/packet['originalSourceFile']).read_bytes()).hexdigest()==packet['originalSourceSha256']
    photo=read('priority-cities/济南/light-photo-metadata-01.json')['entities'][0]
    assert photo['entityId']==eid and photo['revision']==2 and not photo['independentSources'] and not photo['assignments']
    assert all(v is None for v in photo['currentImageFields'].values())
    review_path='priority-cities/济南/light-source-review-01.json'
    paths=[f'all-cities/batch-46-{kind}.json' for kind in ['source','catalog','scope-decisions','decisions','export-expectations']]
    assert all(not (root/p).exists() for p in [review_path,*paths])
    try:
        async with SessionFactory() as s:
            await s.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            cat=await load_mention_catalog(s,'济南');assert cat.catalog.entities[eid]==g['entity']
            sources=(await s.scalars(select(CanonicalPlace).where(CanonicalPlace.city=='济南'))).all()
            assert {p.id for p in sources if source_keys(p)&set(g['nameKeys'])}=={5970}
            src=next(p for p in sources if p.id==5970);assert source_fingerprint(source_input(src))==g['sources'][0]['sourceHash']
            assert cat.scope_for_source(5970) is None
            mentions=[m for m in await load_mention_rows(s,'济南') if scope_matches({'city':'济南','name_keys':g['nameKeys']},m)]
            assert len(mentions)==1 and mentions[0]['id']==12776
            m=mentions[0];assert mention_fingerprint(m)==next(m for m in packet['mentions'] if m['id']==12776)['inputHash']
            quote=next(line for line in m['note_desc'].splitlines() if '爱心红绿灯' in line)
            anchor={'kind':'qualified_heading','subject':'爱心红绿灯','qualifier':'经三路'}
            exclusions={field:{'reason':'subject_mismatch','quote':quote,'subjectAnchor':anchor} for field in ['reason','evidence_text','place_content']}
            assert validate_fact_exclusions(exclusions,m,eid)==exclusions
            images=[im for im in await load_image_rows(s,'济南') if im['source_place_id']==5970];assert images==[]
            source={'readOnly':True,'capturedAt':datetime.now(timezone.utc).isoformat(),'city':'济南','groups':[g],'sources':g['sources'],
                'mentions':[{**m,'inputHash':mention_fingerprint(m)}],'notes':[n for n in original['notes'] if n['id']==2797],'images':images,'reviews':[],
                'originalSourceFile':packet['originalSourceFile'],'originalSourceSha256':packet['originalSourceSha256']}
        history={k:[v for v in packet['catalog'][k] if v['entity_id']==eid] for k in ['entities','members']};history['reviews']=[]
        assert len(history['entities'])==1 and len(history['members'])==1
        scope={'key':'all-cities-20261009-batch-46-light-scope','city':'济南','sourcePlaceId':5970,'expectedSourceHash':g['sources'][0]['sourceHash'],
            'expectedScopeRevision':0,'expectedRevisions':{eid:2},'assignments':[{'mentionId':12776,'inputHash':m['inputHash'] if 'inputHash' in m else mention_fingerprint(m),'entityId':eid,'factExclusions':exclusions}],
            'evidence':[{'kind':'qualified_heading_text_review','file':review_path,'quote':quote,'conclusion':'灯为独立摄影主体；这里的夹心胡同属于经三路周边，不是灯本体所含景观。排除三错误描述字段，保留12776身份与原指纹。'}]}
        decision={'key':'all-cities-20261009-batch-46-light-subject','city':'济南','entityId':eid,'expectedRevisions':{eid:3},'mergeEntityIds':[],
            'canonicalName':g['entity']['canonical_name'],'aliases':g['entity']['aliases'],'overrides':{'category':'文化','xhsPlaceType':'photo_spot'},
            'evidence':[{'kind':'reviewed_primary_subject','file':review_path,'conclusion':'城市爱心红绿灯摄影主体，保持原稳定ID与此前清空错点的override，不借整路或爱心斑马线路口位置。'}]}
        review={'city':'济南','batch':46,'sourcePacket':packet_path,'sourceId':5970,'entityId':eid,'mentionId':12776,'noteId':2797,
            'inputHash':mention_fingerprint(m),'quote':quote,'subjectAnchor':anchor,'factExclusions':exclusions,
            'conclusion':'明确红绿灯主体与稳定名保持，删除把周边夹心胡同投到灯本体的三描述字段；空内容不回填街区或道路资料。',
            'rawFactValue':m['fact_value'],'originalNoteReadInFull':True,'identityConfirmed':True,'locationPending':True,
            'imageComparison':'deferred_by_user','fullReviewPassed':False,'appliedAtFreeze':False}
        write(review_path,review)
        for p,v in zip(paths,[source,history,[scope],[decision],[{'city':'济南','id':eid,'name':g['entity']['canonical_name'],'revision':4,'verified':True,'mentionIds':[12776]}]]):write(p,v)
        print(json.dumps({'batch':46,'sourceSha256':hashlib.sha256((root/paths[0]).read_bytes()).hexdigest(),'mentions':1,'fieldsExcluded':3},ensure_ascii=False))
    finally:await engine.dispose()
asyncio.run(main())
