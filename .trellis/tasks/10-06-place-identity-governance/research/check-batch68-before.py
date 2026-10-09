"""正式应用前只读验证两源、25提及、22全文以及历史ID可认领性。"""
from pathlib import Path
import asyncio,hashlib,json,sys
sys.dont_write_bytecode=True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0,'D:/Project/xhs-travel-pipeline')
from sqlalchemy import select,text
from app.db import SessionFactory,engine
from app.models import CanonicalPlace,RawNote,PlaceEntity,PlaceEntityChange
from app.aggregate.mention_identity import load_mention_catalog,load_mention_rows,source_input
from app.aggregate.place_identity import can_claim_id
from app.clean.mention_identity import mention_fingerprint,source_fingerprint
from app.clean.identity import legacy_id
root=Path(__file__).resolve().parent
def read(p):return json.loads((root/p).read_text(encoding='utf-8'))
def digest(v):return hashlib.sha256(json.dumps(v,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
async def main():
    packet=read('all-cities/batch-68-source.json');assert read('cleaning-scope/current.json')['latestAppliedEntityBatch']==67
    preview=read('all-cities/batch-68-preview.json');assert preview['apply'] is False and len(preview['changes'])==1
    try:
        async with SessionFactory() as s:
            await s.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            cat=await load_mention_catalog(s,'成都');rows={m['id']:m for m in await load_mention_rows(s,'成都')}
            for g in packet['groups']:
                assert cat.catalog.entities[g['entity']['entity_id']]==g['entity']
                assert cat.scope_for_source(g['entity']['primary_place_id']) is None
            for r in packet['sources']:
                p=await s.get(CanonicalPlace,r['source']['id']);assert source_fingerprint(source_input(p))==r['sourceHash']
                for k,v in {**r['source'],**r['derivedBefore'],**r['supplement']}.items():assert getattr(p,k)==v
            for m in packet['mentions']:assert mention_fingerprint(rows[m['id']])==m['inputHash']
            for n in packet['noteDetails']:
                r=await s.get(RawNote,n['id'])
                for k in ['city','title','desc','status']:assert getattr(r,k)==n[k]
                assert r.img_analysis==n['images'] and digest(r.raw_json)==n['rawJsonSha256']
                assert r.source_url==n['sourceUrl'] and r.created_at.isoformat()==n['observedAt']
                assert (r.publish_time.isoformat() if r.publish_time else None)==n['publishedAt']
            claims=[]
            park=next(g['entity'] for g in packet['groups'] if g['entity']['primary_place_id']==1687)
            for name in park['aliases']:
                candidate=legacy_id('成都',name)
                if candidate in park['legacy_ids']:continue
                assert await can_claim_id(s,candidate,cat.catalog,{park['entity_id']})
                assert await s.scalar(select(PlaceEntity).where(PlaceEntity.entity_id==candidate)) is None
                assert not (await s.scalars(select(PlaceEntity).where(PlaceEntity.legacy_ids.contains([candidate])))).all()
                assert await s.scalar(select(PlaceEntityChange.id).where(PlaceEntityChange.request['newEntities'].contains([{'entityId':candidate}])).limit(1)) is None
                claims.append({'existingAlias':name,'legacyId':candidate,'unoccupied':True})
            assert len(claims)==2
        report={'batch':68,'readOnly':True,'sources':2,'mentions':25,'notes':22,'revisionsAndInputHashesMatched':True,'existingAliasClaims':claims,'newAliases':0,'noScopeChanges':True,'failures':[]}
        with (root/'priority-cities/成都/renmin-category-preapply-01.json').open('x',encoding='utf-8') as f:json.dump(report,f,ensure_ascii=False,indent=2)
        print(json.dumps(report,ensure_ascii=False))
    finally:await engine.dispose()
asyncio.run(main())
