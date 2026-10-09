"""只读核验原资料并冻结两处描述字段治理；本批不进行图片比对。"""
from pathlib import Path
import asyncio
import hashlib
import json
import sys
from datetime import datetime, timezone

sys.dont_write_bytecode = True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, 'D:/Project/xhs-travel-pipeline')
from sqlalchemy import select, text
from app.db import SessionFactory, engine
from app.models import CanonicalPlace, PlaceSummary
from app.aggregate.mention_identity import load_mention_catalog, load_mention_rows, source_input, source_keys
from app.aggregate.image_identity import load_image_rows
from app.clean.mention_identity import mention_fingerprint, source_fingerprint, scope_matches, validate_fact_exclusions

root = Path(__file__).resolve().parent
read = lambda p: json.loads((root/p).read_text(encoding='utf-8'))
sha = lambda p: hashlib.sha256((root/p).read_bytes()).hexdigest()
source_file = 'priority-cities/济南/run-1791385235272324900/sources.json'
specs = [
    (5481, '明水古城', '69b816cda273f29ed9296314fbe6f52d', [11508,12581,12786]),
    (5974, '济南野生动物园', 'abc624edea07111dc19aa79dfbb18289', [12787]),
]
quotes = {
    12581: '明水古城，沉醉不知归路。济南是一座“慢得恰好”的城市——泉水泡茶可品闲适，登高怀古可抒豪情，市井烟火中藏着千年文脉。',
    12787: '9️⃣济南野生动物园',
}
fields = {12581: ['reason','evidence_text','place_content'], 12787: ['reason']}

def write_new(p, value):
    with (root/p).open('x',encoding='utf-8',newline='\n') as out:
        out.write(json.dumps(value,ensure_ascii=False,indent=2)+'\n')

async def main():
    pointer = read('cleaning-scope/current.json')
    assert pointer['latestAppliedEntityBatch']==39 and pointer['latestIndependentPhotoBatch']==3
    assert sha(source_file)=='9aa559e894e1cfbcdf74db2214c8eeb6614739064a96967780c6b32af59a889b'
    paths = [f'all-cities/batch-40-{x}.json' for x in ['baseline','source','decisions','scope-decisions','export-expectations']]
    ledger_file = 'priority-cities/济南/description-source-review-01.json'
    assert all(not (root/p).exists() for p in [*paths,ledger_file])
    frozen = read(source_file)
    old_mentions = {m['id']:m for m in frozen['mentions']}
    exported = read('all-cities/batch-39/sync-01/xhs-places-济南.json')['places']
    try:
        async with SessionFactory() as session:
            await session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            await session.execute(text("SET LOCAL statement_timeout='30s'"))
            cat = await load_mention_catalog(session,'济南')
            sources = (await session.scalars(select(CanonicalPlace).where(CanonicalPlace.city=='济南'))).all()
            by_source = {s.id:s for s in sources}
            rows = await load_mention_rows(session,'济南')
            by_row = {m['id']:m for m in rows}
            for old in frozen['sources']:
                s = by_source[old['id']]
                assert source_fingerprint(source_input(s))==old['sourceHash']
                for k in ['name','normalized_name','city','address','latitude','longitude','place_type','geo_status','amap_poi_id','is_active','quality_score']:
                    assert getattr(s,k)==old[k],(s.id,k)
            for old in frozen['mentions']:
                assert mention_fingerprint(by_row[old['id']])==old['inputHash']
            baseline = {'readOnly':True,'city':'济南','capturedAt':datetime.now(timezone.utc).isoformat(),
                'entities':list(cat.catalog.entities.values()),'members':cat.catalog.members,
                'rawSourcesUnchanged':len(frozen['sources']),'originalMentionsUnchanged':len(frozen['mentions'])}
            groups,scopes,decisions,expectations = [],[],[],[]
            for pid,name,eid,ids in specs:
                selected = [s for s in sources if name in source_keys(s)]
                assert [s.id for s in selected]==[pid]
                s = selected[0]
                entity = cat.catalog.resolve(place_id=pid)
                assert entity['entity_id']==eid and entity['revision']==1 and entity['status']=='ACTIVE'
                assert cat.scope_for_source(pid) is None
                mentions = [m for m in rows if scope_matches({'city':'济南','name_keys':{name}},m)]
                assert sorted(m['id'] for m in mentions)==ids
                assignments = []
                for m in mentions:
                    a = {'mentionId':m['id'],'inputHash':mention_fingerprint(m),'entityId':eid}
                    if m['id'] in fields:
                        a['factExclusions'] = {f:{'reason':'subject_mismatch','quote':quotes[m['id']]} for f in fields[m['id']]}
                        validate_fact_exclusions(a['factExclusions'],m,eid)
                    assignments.append(a)
                summary = await session.scalar(select(PlaceSummary).where(PlaceSummary.canonical_place_id==pid))
                groups.append({'entity':entity,'source':{k:getattr(s,k) for k in ['id','city','name','normalized_name','address',
                    'latitude','longitude','place_type','geo_status','amap_poi_id','is_active','quality_score']},
                    'derivedBefore':{k:getattr(s,k) for k in ['typical_visit_minutes','typical_visit_source','theme_tags','content_profile']},
                    'summary':{k:getattr(summary,k) for k in ['canonical_place_id','mention_count_30d','recommend_score']},
                    'mentions':[{**m,'inputHash':mention_fingerprint(m)} for m in mentions]})
                scopes.append({'key':f'all-cities-20261009-batch-40-description-{pid}','city':'济南','sourcePlaceId':pid,
                    'expectedSourceHash':source_fingerprint(source_input(s)),'expectedScopeRevision':0,
                    'expectedRevisions':{eid:1},'assignments':assignments})
                # 本批只清描述；显式保持既有类别，完整类别与位置核查继续单列。
                category = next(p['category'] for p in exported if p['id']==eid)
                decisions.append({'key':f'all-cities-20261009-batch-40-retain-category-{pid}','city':'济南','entityId':eid,
                    'mergeEntityIds':[],'canonicalName':name,'expectedRevisions':{eid:2},'overrides':{'category':category}})
                expectations.append({'city':'济南','id':eid,'name':name,'revision':3,'verified':True,'mentionIds':ids})
            images = await load_image_rows(session,'济南')
            matched = [im for im in images if im['source_place_id'] in [5481,5974]]
            assert not matched, '现有受控媒体须另行核实，不能随本批改动'
            ledger = {'city':'济南','batch':'batch-40','sourceFile':source_file,'sourceSha256':sha(source_file),
                'textReviewedNoteIds':[2616,2798,2803],'mentionIds':[11508,12581,12786,12787],
                'fieldDecisions':[{'mentionId':mid,'fields':fs,'quote':quotes[mid]} for mid,fs in fields.items()],
                'conclusions':[
                    '12581正文先点名明水古城，再明确改以济南为主语；仅后面的全市概述被错提为古城看点，保留地点提及。',
                    '12787正文和证据均为济南野生动物园；reason却丢失野生，不能作为另一个园区名称的介绍。保留唯一有效提及和evidence_text。',
                    '11508无具体理由的占位描述和12786拍照语境仍保留，后续内容质量另核；本批不扩大到新字段判断。'],
                'imageComparison':'deferred_by_user','fullReviewPassed':False,'pending':['图片比对','类别复核','位置及园区边界复核'],
                'rawSourcesUnchanged':107,'originalMentionsUnchanged':662,'appliedAtFreeze':False}
        write_new(ledger_file,ledger)
        evidence = [{'kind':'reviewed_text_subject_mismatch','file':ledger_file,'sha256':sha(ledger_file),
            'conclusion':'有效地点提及保留，只排除已确认主语错误字段；图片比对暂缓，完整自查未通过。'}]
        for d in [*scopes,*decisions]: d['evidence']=evidence
        notes = [n for n in frozen['notes'] if n['id'] in {m['raw_note_id'] for g in groups for m in g['mentions']}]
        source = {'readOnly':True,'city':'济南','capturedAt':baseline['capturedAt'],'originalSourceFile':source_file,
            'originalSourceSha256':sha(source_file),'groups':groups,'notes':notes,'images':[],'reviews':[]}
        for p,value in zip(paths,[baseline,source,decisions,scopes,expectations]): write_new(p,value)
        print(json.dumps({'batch':'batch-40','scopes':2,'mentions':4,'excludedFields':4,'notes':len(notes),
            'sourceSha256':sha(paths[1]),'imageComparison':'deferred_by_user'},ensure_ascii=False))
    finally: await engine.dispose()

asyncio.run(main())
