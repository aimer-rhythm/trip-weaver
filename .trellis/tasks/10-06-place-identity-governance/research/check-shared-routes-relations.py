"""只读核对第44批关系降级的原始位置障碍，不发布新版本。"""
from pathlib import Path
import asyncio,json,sys
sys.dont_write_bytecode=True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0,'D:/Project/xhs-travel-pipeline')
from sqlalchemy import select,text
from app.db import SessionFactory,engine
from app.models import PlaceRelationSnapshot
root=Path(__file__).resolve().parent
def read(p):return json.loads((root/p).read_text(encoding='utf-8'))
async def main():
    target=root/'priority-cities/济南/shared-routes-relation-check-01.json';assert not target.exists()
    old=read('all-cities/batch-44/sync-01/preview-济南/library-before.json')['tables']['place_relation_snapshots'][0]
    new=read('all-cities/batch-44/sync-01/xhs-place-relations-济南.json')
    try:
        async with SessionFactory() as s:
            await s.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            current=(await s.scalar(select(PlaceRelationSnapshot).where(PlaceRelationSnapshot.city=='济南'))).payload
            assert current['revision']==18 and current['relations']==new['relations']
            assert current['sourceHash']==new['relationIdentity']['sourceHash']
            changes=[]
            for a in old['relations']:
                b=next((b for b in new['relations'] if (a['fromEntityId'],a['toEntityId'])==(b['fromEntityId'],b['toEntityId'])),None)
                if b and a['strength']==b['strength']:continue
                retained={e['noteId'] for e in b['evidence']} if b else set()
                lost=[]
                for e in a['evidence']:
                    if e['noteId'] in retained:continue
                    blocks=[]
                    for side in ['from','to']:
                        p=e[side]
                        found=[u for u in current['unresolved'] if u['noteId']==e['noteId'] and u.get('start')==p['start'] and u.get('end')==p['end']]
                        blocks.extend(found)
                    assert blocks,(a['from'],a['to'],e['noteId'])
                    lost.append({'noteId':e['noteId'],'quote':e['quote'],'positionBarriers':blocks})
                changes.append({'from':a['from'],'to':a['to'],'before':a['strength'],'after':b['strength'] if b else 'removed',
                    'notesBefore':a['noteCount'],'notesAfter':b['noteCount'] if b else 0,'lostEvidence':lost})
            assert len(changes)==5 and sum(c['after']=='removed' for c in changes)==2
            report={'batch':44,'readOnly':True,'revision':18,'graphBefore':20,'graphAfter':18,'directBefore':6,'directAfter':3,
                'changes':changes,'interpretation':'本批受控后同篇多处同名必须绑定具体位置；确认实体不代表旧任意同名位置可继续作关系端点。','failures':[]}
            with target.open('x',encoding='utf-8') as f:json.dump(report,f,ensure_ascii=False,indent=2)
            print(json.dumps(report,ensure_ascii=False))
    finally:await engine.dispose()
asyncio.run(main())
