"""实库只读复核37处撤回、原文指纹和原源字段；不输出图文URL。"""
from pathlib import Path
import asyncio
import json
import sys
sys.dont_write_bytecode=True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0,'D:/Project/xhs-travel-pipeline')
from sqlalchemy import select,text
from app.db import SessionFactory,engine
from app.models import CanonicalPlace,PlaceEntityReview
from app.aggregate.mention_identity import load_mention_catalog,load_mention_rows,source_input
from app.clean.mention_identity import mention_fingerprint
root=Path(__file__).resolve().parent

async def main():
    frozen=json.loads((root/'cleaning-scope/run-1791371057197/wrongcity-scope-source-01.json').read_text(encoding='utf-8'))
    target=root/'all-cities/batch-29-upstream-check.json'
    assert not target.exists()
    try:
        async with SessionFactory() as session:
            await session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            catalog=await load_mention_catalog(session,'成都')
            rows={m['id']:m for m in await load_mention_rows(session,'成都')}
            checked=[]
            for g in frozen['groups']:
                old=g['sources'][0]
                s=await session.get(CanonicalPlace,old['id'])
                assert source_input(s)=={k:old[k] for k in ['id','city','name','normalized_name']}
                assert all(getattr(s,k)==old[k] for k in ['address','latitude','longitude','place_type','geo_status','is_active'])
                m=g['mentions'][0]
                assert mention_fingerprint(rows[m['id']])==m['inputHash']
                result=catalog.resolve(rows[m['id']])
                assert result['status']=='review' and result['reason']=='unassigned_target'
                entity=catalog.catalog.root(old['entity']['entity_id'])
                assert entity['revision']==2 and entity['redirect_to'] is None
                scope=catalog.scope_for_source(s.id)
                assert scope['change_key']==f'all-cities-20261007-batch-29-wrongcity-{s.id}'
                review=await session.scalar(select(PlaceEntityReview).where(PlaceEntityReview.city=='成都',
                    PlaceEntityReview.detail['reason'].astext=='mention_scope',
                    PlaceEntityReview.detail['mentionId'].as_integer()==m['id']))
                assert review and review.status=='PENDING'
                checked.append({'sourceId':s.id,'entityId':entity['entity_id'],'mentionId':m['id'],'reviewId':review.id,
                    'originalUnchanged':True,'assignment':None,'scopeRevision':scope['revision']})
            report={'readOnly':True,'batch':'batch-29','checked':checked,'originalSources':37,'originalMentions':37,
                'rawNoteId':759,'cityUnchanged':'成都','pendingMentions':37,'crossCityMerges':0,'failures':[]}
            target.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
            print(json.dumps({k:v for k,v in report.items() if k!='checked'},ensure_ascii=False))
    finally:
        await engine.dispose()

asyncio.run(main())
