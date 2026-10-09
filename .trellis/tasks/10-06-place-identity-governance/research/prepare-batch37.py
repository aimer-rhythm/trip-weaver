"""五泉仅按已读来源修订活动类别；保留实体、位置和既有字段/待审分配。"""
from pathlib import Path
import asyncio
import hashlib
import json
import sys
from datetime import datetime, timezone
sys.dont_write_bytecode = True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0,'D:/Project/xhs-travel-pipeline')
from sqlalchemy import select, text
from app.db import SessionFactory, engine
from app.models import CanonicalPlace, PlaceSummary
from app.aggregate.mention_identity import load_mention_catalog, load_mention_rows
from app.clean.mention_identity import mention_fingerprint
root=Path(__file__).resolve().parent
def read(f): return json.loads((root/f).read_bytes())
def digest(f): return hashlib.sha256((root/f).read_bytes()).hexdigest()
def write(f,value):
    with (root/f).open('x',encoding='utf-8') as out: json.dump(value,out,ensure_ascii=False,indent=2)
evidence_file='priority-cities/济南/spring-category-review-01.json'
check_file='priority-cities/济南/spring-upstream-check-01.json'
quotes={
    '王府池子':(2813,'王府池子（隐藏在老城区的宝藏泉水濯缨泉）','以池中泉水为当前游览对象；街道、院落及小王府池子不进入身份范围。'),
    '腾蛟泉':(2813,'腾蛟泉（王府池子出来往北走的一个岔路口）','全文以泉水walk串联明确泉体；原美食主题来自整篇标签，不属于该泉体活动类别。'),
    '起凤泉':(2837,'5️⃣王府池子、腾蛟泉、起凤泉、刘氏泉（p16）','泉水citywalk全文明确街巷泉水为游览对象；保留起凤泉独立主体与唯一来源，不认领起凤桥或院内商户。'),
    '刘氏泉':(2813,'刘氏泉（西更道走到头就能看到一条细长的水流）','当前确认提及指泉体及水流，按自然体验分类；12692的簪花摄影主体继续null，未完成整组身份自查。'),
    '玛瑙泉':(2797,'1️⃣0️⃣玛瑙泉：小石潭记在这里具象化，泉水清澈，鱼儿就像在空中游动；','原文描述泉水与游鱼，没有另给泉外摄影点的站位范围；按泉体自然景观分类，不因引用小石潭记归文化。'),
}
async def main():
    pointer=read('cleaning-scope/current.json');assert pointer['latestAppliedEntityBatch']==36
    assert '济南' not in pointer['policy']['excludedCities']
    assert digest('all-cities/batch-37-baseline.json')=='36d6f1b860980407b4115f2b6a9f8ec90b55e830b06074a01d6284b3955bcb26'
    baseline=read('all-cities/batch-37-baseline.json');check=read(check_file)
    output=[evidence_file,'all-cities/batch-37-source.json','all-cities/batch-37-decisions.json','all-cities/batch-37-export-expectations.json']
    assert all(not (root/f).exists() for f in output)
    groups=[]
    try:
        async with SessionFactory() as session:
            await session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            catalog=await load_mention_catalog(session,'济南');mentions={m['id']:m for m in await load_mention_rows(session,'济南')}
            for g in check['groups']:
                eid=g['entity']['entity_id'];entity=catalog.catalog.root(eid)
                assert entity==g['entity']
                frozen=next(e for e in baseline['entities'] if e['entity_id']==eid)
                assert entity=={k:v for k,v in frozen.items() if k!='places'}
                p=await session.get(CanonicalPlace,g['sourceIds'][0])
                fields=['id','city','name','normalized_name','address','latitude','longitude','place_type','geo_status','amap_poi_id','is_active','quality_score']
                summary=await session.scalar(select(PlaceSummary).where(PlaceSummary.canonical_place_id==p.id));assert summary
                rows=[]
                for mid in g['mentionIds']:
                    m=mentions[mid];old=next(m for m in check['mentions'] if m['id']==mid)
                    assert mention_fingerprint(m)==old['inputHash']
                    resolution=catalog.resolve(m);assert resolution['status']==old['resolutionStatus']
                    assert resolution.get('factExclusions')==old['factExclusions']
                    rows.append({**m,'inputHash':old['inputHash']})
                groups.append({'entity':entity,'source':{k:getattr(p,k) for k in fields},
                    'sourceDerived':{'theme_tags':p.theme_tags,'typical_visit_minutes':p.typical_visit_minutes,'typical_visit_source':p.typical_visit_source},
                    'summary':{k:getattr(summary,k) for k in ['canonical_place_id','mention_count_30d','recommend_score']},'mentions':rows})
        review=[]
        for g in groups:
            name=g['entity']['canonical_name'];note_id,quote,reason=quotes[name]
            note=next(n for n in check['notes'] if n['id']==note_id);assert quote in note['note_desc']
            mids=[m['id'] for m in g['mentions'] if m['raw_note_id']==note_id];assert mids
            review.append({'entityId':g['entity']['entity_id'],'name':name,'oldCategory':'文化','category':'自然','noteId':note_id,
                'quote':quote,'mentionIds':mids,'reason':reason,'position':'reviewed_named_spring_reference_point',
                'media':'no_matching_upstream_imported_or_independent_images','fullReviewPassed':False})
        write(evidence_file,{'city':'济南','batch':'batch-37','sourceEvidence':check_file,'sourceSha256':digest(check_file),
            'mapEvidence':'priority-cities/济南/spring-map-reference-check-01.json','rows':review,
            'notes':'自然是本轮游览活动类别，不否认泉体人文价值；不增加别名、改坐标或变动原始主题。刘氏泉摄影提及仍待审。'})
        decisions=[];expectations=[]
        for g in groups:
            e=g['entity'];r=next(r for r in review if r['entityId']==e['entity_id'])
            decisions.append({'key':f"all-cities-20261008-batch-37-category-{g['source']['id']}",'city':'济南',
                'entityId':e['entity_id'],'canonicalName':e['canonical_name'],'aliases':[],'mergeEntityIds':[],
                'expectedRevisions':{e['entity_id']:e['revision']},'overrides':{'category':'自然'},
                'evidence':[{'kind':'reviewed_spring_activity_category','file':evidence_file,'sha256':digest(evidence_file),
                    'sourcePlaceId':g['source']['id'],'noteId':r['noteId'],'quote':r['quote'],'mentionIds':r['mentionIds'],'conclusion':r['reason']}]})
            expectation={'city':'济南','id':e['entity_id'],'name':e['canonical_name'],'revision':e['revision']+1,'verified':True}
            if e['canonical_name']!='玛瑙泉':expectation['mentionIds']=sorted(m['id'] for m in g['mentions'] if m['id']!=12692)
            expectations.append(expectation)
        write(output[1],{'readOnly':True,'city':'济南','capturedAt':datetime.now(timezone.utc).isoformat(),'groups':groups,'notes':check['notes'],
            'baselineSha256':digest('all-cities/batch-37-baseline.json'),'previousScopes':'all-cities/batch-36-scope-decisions.json'})
        write(output[2],decisions);write(output[3],expectations)
        print(json.dumps({'batch':'batch-37','categoryCorrections':5,'merges':0,'scopeChanges':0,'sourceSha256':digest(output[1])},ensure_ascii=False))
    finally:await engine.dispose()
asyncio.run(main())
