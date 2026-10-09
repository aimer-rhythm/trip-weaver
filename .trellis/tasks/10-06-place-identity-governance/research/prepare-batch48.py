"""珍珠泉与大院完整scope及逐条看点排除；保留原名称、位置与原资料。"""
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
    pointer=read('cleaning-scope/current.json')
    assert pointer['latestAppliedEntityBatch']==47 and pointer['userAcceptance'] is False
    assert pointer['imageComparisonPolicy']['status']=='deferred_by_user'
    packet_path='priority-cities/济南/pearl-source-packet-01.json';packet=read(packet_path)
    packet_hash=hashlib.sha256((root/packet_path).read_bytes()).hexdigest()
    assert packet_hash=='a4a7b8e03ffc35bb5430cf044021ec3f800b6e6740db6120154de7a5bd576ff6'
    original=read(packet['originalSourceFile'])
    assert hashlib.sha256((root/packet['originalSourceFile']).read_bytes()).hexdigest()==packet['originalSourceSha256']
    photos=read('priority-cities/济南/pearl-photo-metadata-01.json')
    review_path='priority-cities/济南/pearl-source-review-01.json'
    paths=[f'all-cities/batch-48-{kind}.json' for kind in ['source','catalog','scope-decisions','decisions','export-expectations']]
    assert all(not (root/p).exists() for p in [review_path,*paths])
    rules={11338:'独立珍珠泉条目明确游玩1h，非黑虎泉+解放阁或曲水亭街+百花洲组合时长，保留60分钟。',
        12566:'同篇独立60分钟重复提及保留原身份，时长聚合按笔记去重，只计一篇。',
        11400:'完整路线将珍珠泉作为独立站点，免费为同篇景点说明，不变成当前官方政策。',
        11414:'第二天独立珍珠泉路线站点，非附近住宿主体。',
        12680:'同篇第二次抽取路线仍为独立泉点，保留原提及，不重复独立来源数。',
        12592:'进省人大大门后按指示到珍珠泉，泉水气泡看点支持本体；公园园林树木评价属于周围大院，排除reason/evidence_text及看点1，保留看点0。',
        12669:'珍珠泉条目明确泉水细碎气泡，保留泉池本体描述。',
        12696:'完整一小时路线的终点为珍珠泉，原记录无minutes，不借全线时长为泉点补值。',
        12940:'独立珍珠泉条目明确0.5h，进大院是抵达指引；保留30分钟及泉池气泡看点，不取前一段黑虎泉群90分钟。',
        12582:'正文明确大院内多泉，主体不是单个泉池；排除把大院称为三大名泉之一的reason/evidence_text及看点0，保留院内泉名单看点1。'}
    try:
        async with SessionFactory() as s:
            await s.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            cat=await load_mention_catalog(s,'济南')
            sources=(await s.scalars(select(CanonicalPlace).where(CanonicalPlace.city=='济南'))).all()
            mentions=await load_mention_rows(s,'济南');selected={};scopes=[];decisions=[];expectations=[];reviewed=[]
            for g in packet['groups']:
                eid=g['entity']['entity_id'];sid=g['entity']['primary_place_id'];assert cat.catalog.entities[eid]==g['entity']
                photo=next(e for e in photos['entities'] if e['entityId']==eid)
                assert photo['revision']==1 and not photo['independentSources'] and not photo['assignments']
                assert all(v is None for v in photo['currentImageFields'].values())
                assert {p.id for p in sources if source_keys(p)&set(g['nameKeys'])}=={sid}
                src=next(p for p in sources if p.id==sid)
                assert source_fingerprint(source_input(src))==g['sources'][0]['sourceHash'] and cat.scope_for_source(sid) is None
                current=[m for m in mentions if scope_matches({'city':'济南','name_keys':g['nameKeys']},m)]
                assert {m['id']:mention_fingerprint(m) for m in current}=={m['id']:m['inputHash'] for m in packet['mentions'] if m['id'] in g['mentionIds']}
                assignments=[]
                for m in current:
                    assert not m['note_unavailable'];selected[m['id']]=m
                    quote=next(line for line in m['note_desc'].splitlines() if m['name'] in line)
                    a={'mentionId':m['id'],'inputHash':mention_fingerprint(m),'entityId':eid}
                    if m['id'] in [12592,12582]:
                        phrase='顺着护城河边看各种泉边走到' if m['id']==12592 else '珍珠泉大院（'
                        quote=next(line for line in m['note_desc'].splitlines() if line.startswith(phrase))
                        excluded={field:{'reason':'subject_mismatch','quote':quote} for field in ['reason','evidence_text','place_content']}
                        excluded['place_content']['highlightIndexes']=[1 if m['id']==12592 else 0]
                        assert validate_fact_exclusions(excluded,m,eid)==excluded;a['factExclusions']=excluded
                    assignments.append(a)
                    reviewed.append({'mentionId':m['id'],'noteId':m['raw_note_id'],'inputHash':mention_fingerprint(m),'entityId':eid,
                        'quote':quote,'reason':rules[m['id']],'factExclusions':a.get('factExclusions'),'status':'reviewed_target'})
                key=f'all-cities-20261009-batch-48-source-{sid}'
                scopes.append({'key':key+'-scope','city':'济南','sourcePlaceId':sid,'expectedSourceHash':g['sources'][0]['sourceHash'],
                    'expectedScopeRevision':0,'expectedRevisions':{eid:1},'assignments':assignments,
                    'evidence':[{'kind':'reviewed_full_text_scope','file':review_path,'mentionIds':g['mentionIds'],
                        'conclusion':'全文区分泉池与容纳多泉的大院；两条混合看点逐项删错留真，完整提及身份保持，不扩展到整个珍珠泉泉群。'}]})
                decisions.append({'key':key+'-subject','city':'济南','entityId':eid,'expectedRevisions':{eid:2},'mergeEntityIds':[],
                    'canonicalName':g['entity']['canonical_name'],'aliases':g['entity']['aliases'],
                    'overrides':{'category':'自然' if sid==5363 else '文化','xhsPlaceType':'attraction'},
                    'evidence':[{'kind':'reviewed_primary_subject','file':review_path,
                        'conclusion':'珍珠泉为自然泉池，大院为容纳多泉的庭院景观；两者独立保留原ID、名称、坐标。大院不是泉本体，也不是餐饮店；未新验精确位置。'}]})
                expectations.append({'city':'济南','id':eid,'name':g['entity']['canonical_name'],'revision':3,'verified':True,
                    'mentionIds':sorted(a['mentionId'] for a in assignments)})
            assert set(selected)==set(rules)
            images=[im for im in await load_image_rows(s,'济南') if im['source_place_id'] in [5363,5947]];assert images==[]
            source={'readOnly':True,'capturedAt':datetime.now(timezone.utc).isoformat(),'city':'济南','groups':packet['groups'],
                'sources':[v for g in packet['groups'] for v in g['sources']],'mentions':[{**m,'inputHash':mention_fingerprint(m)} for m in selected.values()],
                'notes':[n for n in original['notes'] if n['id'] in {m['raw_note_id'] for m in selected.values()}],
                'images':images,'reviews':[],'originalSourceFile':packet['originalSourceFile'],'originalSourceSha256':packet['originalSourceSha256']}
        report={'city':'济南','batch':48,'sourcePacket':packet_path,'sourcePacketSha256':packet_hash,'roots':2,'sources':2,'mentions':10,'fullNotes':8,
            'confirmed':10,'pending':0,'originalNotesReadInFull':True,'partialHighlightExclusions':2,'descriptionFieldExclusions':4,
            'durationSamples':{'note2545':60,'note2837':30,'median':60},'locationStatus':'existing_points_preserved_not_newly_verified',
            'imageComparison':'deferred_by_user','fullReviewPassed':False,'appliedAtFreeze':False,'rows':reviewed}
        write(review_path,report)
        for p,v in zip(paths,[source,packet['catalog'],scopes,decisions,expectations]):write(p,v)
        print(json.dumps({'batch':48,'sourceSha256':hashlib.sha256((root/paths[0]).read_bytes()).hexdigest(),'confirmed':10,'pending':0},ensure_ascii=False))
    finally:await engine.dispose()
asyncio.run(main())
