"""冻结鹤鸣茶社六提及与跨行原评价，生成完整scope；不应用业务修改。"""
from pathlib import Path
from datetime import datetime,timezone
import asyncio,hashlib,json,sys
sys.dont_write_bytecode=True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0,'D:/Project/xhs-travel-pipeline')
from sqlalchemy import select,text
from app.db import SessionFactory,engine
from app.models import RawNote,CanonicalPlace
from app.aggregate.mention_identity import load_mention_catalog,load_mention_rows,source_input
from app.aggregate.note_text_warnings import load_warning_notes
from app.aggregate.image_identity import load_image_rows
from app.clean.mention_identity import mention_fingerprint,source_fingerprint,scope_matches
from app.clean.note_text_warnings import warning_input,validate_text_warnings
root=Path(__file__).resolve().parent
def read(p):return json.loads((root/p).read_text(encoding='utf-8'))
def sha(p):return hashlib.sha256((root/p).read_bytes()).hexdigest()
def digest(v):return hashlib.sha256(json.dumps(v,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def write(p,v):
    with (root/p).open('x',encoding='utf-8') as f:json.dump(v,f,ensure_ascii=False,indent=2);f.write('\n')
async def main():
    pointer=read('cleaning-scope/current.json');assert pointer['latestAppliedEntityBatch']==68 and pointer['pendingVerification']==[] and not pointer['userAcceptance']
    assert pointer['imageComparisonPolicy']['status']=='deferred_by_user'
    original='all-cities/batch-68-source.json';assert sha(original)=='c78061c733a251c204053588d4c56a86639f3e01d79cf77b0f58a311d7755125'
    packet=read(original);g=next(g for g in packet['groups'] if g['entity']['primary_place_id']==1847);eid=g['entity']['entity_id']
    frozen_mentions=[m for m in packet['mentions'] if m['id'] in g['mentionIds']]
    notes=[n for n in packet['noteDetails'] if n['id']==877 or any(m['raw_note_id']==n['id'] for m in frozen_mentions)]
    sources=[s for s in packet['sources'] if s['source']['id']==1847]
    assert len(frozen_mentions)==6 and len(notes)==6 and len(sources)==1
    pre=read('priority-cities/成都/heming-photo-preflight-01.json');assert pre['existingPhotoConsumptionPreserved'] and pre['teaFactImages']==0 and pre['teaLookupImages']==0
    metadata=read('priority-cities/成都/heming-photo-metadata-01.json');assert not metadata['entities'][0]['independentSources'] and not metadata['entities'][0]['assignments']
    rp='priority-cities/成都/heming-source-review-01.json'
    try:
        async with SessionFactory() as s:
            await s.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            cat=await load_mention_catalog(s,'成都');assert cat.catalog.entities[eid]==g['entity'] and cat.scope_for_source(1847) is None
            p=await s.get(CanonicalPlace,1847);assert source_fingerprint(source_input(p))==sources[0]['sourceHash']
            for k,v in {**sources[0]['source'],**sources[0]['derivedBefore'],**sources[0]['supplement']}.items():assert getattr(p,k)==v
            rows=[m for m in await load_mention_rows(s,'成都') if scope_matches({'city':'成都','name_keys':g['nameKeys']},m)]
            assert {m['id']:mention_fingerprint(m) for m in rows}=={m['id']:m['inputHash'] for m in frozen_mentions}
            for n in notes:
                actual=await s.get(RawNote,n['id'])
                for k in ['city','title','desc','status']:assert getattr(actual,k)==n[k]
                assert actual.img_analysis==n['images'] and digest(actual.raw_json)==n['rawJsonSha256']
                assert actual.source_url==n['sourceUrl'] and actual.created_at.isoformat()==n['observedAt']
                assert (actual.publish_time.isoformat() if actual.publish_time else None)==n['publishedAt']
            warning_notes=await load_warning_notes(s,[{'noteId':877,'imageIndex':0}]);n=warning_notes[877]
            quote='可以不去\n鹤鸣茶社';text_content=n['images'][0]['text_content'];start=text_content.index(quote)
            warning={**warning_input(877,0,n),'start':start,'end':start+len(quote),'quote':quote,'entityId':eid}
            validate_text_warnings([warning],city='成都',notes=warning_notes,entities=cat.catalog.entities,confirmed_ids={eid})
            images=[i for i in await load_image_rows(s,'成都') if i['source_place_id']==1847];assert images==[]
        assignments=[{'mentionId':m['id'],'inputHash':m['inputHash'],'entityId':eid} for m in frozen_mentions]
        scope={'key':'all-cities-20261009-batch-69-heming-scope','city':'成都','sourcePlaceId':1847,'expectedSourceHash':sources[0]['sourceHash'],
            'expectedScopeRevision':0,'expectedRevisions':{eid:1},'assignments':assignments,'textWarnings':[warning],
            'evidence':[{'kind':'reviewed_full_original_and_exact_multiline_opinion','file':rp,'noteId':877,'quote':quote,
                'conclusion':'茶社六条提及身份明确，四条正面、两条负面保留；跨行可不去意见逐字保全，停止其他景点混合提示。公园与茶社独立，不继承合游时长、免费门票或公园营业。'}]}
        catalog={'entities':[g['entity']],'members':[m for m in packet['catalog']['members'] if m['place_id']==1847],'reviews':[]}
        source={'readOnly':True,'capturedAt':datetime.now(timezone.utc).isoformat(),'city':'成都','entityBatch':68,'originalSourceFile':original,'originalSourceSha256':sha(original),
            'groups':[g],'sources':sources,'mentions':frozen_mentions,'noteDetails':notes,'notes':[{'id':n['id'],'city':n['city'],'title':n['title'],'desc':n['desc']} for n in notes],
            'catalog':catalog,'reviews':[],'images':[],'imageComparison':'deferred_by_user','businessMutations':False}
        old_review=read('priority-cities/成都/renmin-heming-source-review-01.json')
        review={'batch':69,'city':'成都','state':'prepared_not_applied','sourceFile':'all-cities/batch-69-source.json','sourcesRead':1,'sourcesGoverned':1,'mentionsRead':6,
            'fullNotes':5,'supplementalFullNotes':1,'confirmed':6,'pendingAdded':0,'scopeChanges':1,'assignmentChanges':6,'newEntities':0,'merges':0,'withdrawals':0,
            'rows':[dict(r,scopeActionApplied=False,decision='confirm') for r in old_review['rows'] if r['mentionId'] in g['mentionIds']],
            'textWarnings':[warning],'opinionPolicy':'四条正面看点、两条原警示及原日期保持；note877跨行意见仅作为该作者观点，不视为官方结论，也不以note936另篇批评替换。',
            'durationPolicy':'独立茶社分钟数未知；note957的公园/茶社/博物馆合计2小时、note895的公园站90分钟均不复制。',
            'hoursPolicy':'旧unknown保持，note929社区08:30–18:00尚未有当前运营依据，本批不据夜景评价推定延长营业。',
            'categoryAndPositionPolicy':'美食/cafe保持；原坐标、地址及adcode未新核，不以完整scope宣称精确定位已通过。',
            'parentPolicy':'人民公园在68批的自然类别、网页简介、旧图片及原消费只读保持，公园自身scope仍未应用。',
            'publicEvidenceRevalidated':False,'imageComparison':'deferred_by_user','newImageViews':0,'fullReviewPassed':False,'userAcceptance':False}
        for path,value in [(rp,review),('all-cities/batch-69-source.json',source),('all-cities/batch-69-catalog.json',catalog),('all-cities/batch-69-decisions.json',[]),
            ('all-cities/batch-69-scope-decisions.json',[scope]),('all-cities/batch-69-export-expectations.json',[{'city':'成都','id':eid,'name':'鹤鸣茶社','revision':2,'verified':True,'mentionIds':sorted(g['mentionIds'])}])]:write(path,value)
        print(json.dumps({'batch':69,'prepared':True,'applied':False,'sources':1,'mentions':6,'notes':6,'scopeChanges':1,'textWarnings':1,'sourceSha256':sha('all-cities/batch-69-source.json')},ensure_ascii=False))
    finally:await engine.dispose()
asyncio.run(main())
