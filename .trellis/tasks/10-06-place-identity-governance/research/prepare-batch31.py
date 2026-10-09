"""只读核验四个菜品主体的完整来源与提及，冻结真实原文及明确排除请求。"""
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
from app.db import engine, SessionFactory
from app.models import CanonicalPlace, PlaceSummary
from app.aggregate.mention_identity import load_mention_catalog, load_mention_rows, source_input, source_keys
from app.aggregate.image_identity import load_image_rows
from app.clean.mention_identity import mention_fingerprint, source_fingerprint, scope_matches

root = Path(__file__).resolve().parent
source_file = 'priority-cities/济南/run-1791385235272324900/sources.json'
source_hash = '9aa559e894e1cfbcdf74db2214c8eeb6614739064a96967780c6b32af59a889b'
baseline_hash = '4d56f319dde37c90b13b70d840b2fb97a80bd004e9b043dd95616cad61afe243'
targets = {
    '九转大肠': ('9ffce5f7ef87be0f7ac37aa2a74ed417', [11483,12743], '九转大肠（鲁菜经典，酸甜咸辣香五味俱全）'),
    '济南锅贴': ('a72490fe56f5990e94cccd78ec58824b', [11485,12745], '济南锅贴（底部焦脆，三鲜馅爆汁）'),
    '甜沫儿': ('033a692df5218d571ddd2cca8a8c91e3', [11479,12739], '甜沫儿（名字甜实际咸香，小米面熬的暖乎乎）'),
    '老济南烧烤': ('a75779b7778aa9751bcfa97528fc877f', [11482,12742], '老济南烧烤（羊肉串配扎啤，深夜烟火气）'),
}


async def main():
    assert hashlib.sha256((root/source_file).read_bytes()).hexdigest() == source_hash
    assert hashlib.sha256((root/'all-cities/batch-31-baseline.json').read_bytes()).hexdigest() == baseline_hash
    frozen = json.loads((root/source_file).read_text(encoding='utf-8'))
    note = next(n for n in frozen['notes'] if n['id'] == 2560)
    assert note['note_city'] == '济南' and not note['note_unavailable']
    outputs = ['batch-31-source.json', 'batch-31-decisions.json', 'batch-31-scope-decisions.json', 'batch-31-export-expectations.json']
    assert all(not (root/'all-cities'/p).exists() for p in outputs)
    groups, decisions, expectations = [], [], []
    try:
        async with SessionFactory() as session:
            await session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            catalog = await load_mention_catalog(session, '济南')
            all_sources = (await session.scalars(select(CanonicalPlace).where(CanonicalPlace.city=='济南'))).all()
            all_rows = await load_mention_rows(session, '济南')
            images = await load_image_rows(session, '济南')
            for name,(eid,mids,quote) in targets.items():
                old_group = next(g for g in frozen['groups'] if g['entity']['entity_id']==eid)
                entity = catalog.catalog.root(eid)
                assert entity == old_group['entity'] and entity['revision'] == 1
                sources = [s for s in all_sources if (catalog.catalog.resolve(place_id=s.id) or {}).get('entity_id')==eid]
                assert len(sources)==1 and [s.id for s in sources]==old_group['sourceIds']
                source = sources[0]
                keys = source_keys(source)
                assert [s.id for s in all_sources if keys & source_keys(s)] == [source.id]
                assert catalog.scope_for_source(source.id) is None
                rows = [m for m in all_rows if scope_matches({'city':'济南','name_keys':keys},m)]
                assert sorted(m['id'] for m in rows)==sorted(mids)
                assert quote in note['note_desc']
                for row in rows:
                    old = next(m for m in frozen['mentions'] if m['id']==row['id'])
                    assert row['raw_note_id']==2560 and mention_fingerprint(row)==old['inputHash']
                    assert catalog.resolve(row)['entity']['entity_id']==eid
                assert not [i for i in images if i['source_place_id']==source.id or i['raw_note_id']==2560]
                original_source = next(s for s in frozen['sources'] if s['id']==source.id)
                fields = ['id','city','name','normalized_name','address','latitude','longitude','place_type',
                    'geo_status','amap_poi_id','is_active','quality_score']
                actual_source = {k:getattr(source,k) for k in fields}
                assert actual_source == {k:original_source[k] for k in fields}
                summary = await session.scalar(select(PlaceSummary).where(PlaceSummary.canonical_place_id==source.id))
                summary_fields = ['canonical_place_id','mention_count_30d','recommend_score']
                groups.append({'entity':entity,'source':actual_source,'sourceHash':source_fingerprint(source_input(source)),
                    'summary':{k:getattr(summary,k) for k in summary_fields},
                    'mentions':[{**row,'inputHash':mention_fingerprint(row)} for row in rows]})
                decisions.append({'key':f'all-cities-20261008-batch-31-non-place-{source.id}', 'city':'济南',
                    'sourcePlaceId':source.id,'expectedSourceHash':source_fingerprint(source_input(source)),
                    'expectedScopeRevision':0,'expectedRevisions':{eid:1},
                    'assignments':[{'mentionId':row['id'],'inputHash':mention_fingerprint(row),'entityId':None,
                        'exclusion':{'reason':'not_a_place','quote':quote}} for row in rows],
                    'evidence':[{'kind':'reviewed_non_place','file':source_file,'sha256':source_hash,'noteId':2560,
                        'sourcePlaceIds':[source.id],'mentionIds':mids,'quote':quote,
                        'conclusion':'原文吃过的美食列表仅描述菜品或品类，未指向具体门店。明确排除这两次提取的地点身份，保留原文、源地点与历史ID；不将正文其他品牌一并排除。'}]})
                expectations.append({'city':'济南','id':eid,'name':name,'revision':2,'verified':False,'mentionIds':[],'candidateIds':[]})
        payloads = [
            {'readOnly':True,'city':'济南','capturedAt':datetime.now(timezone.utc).isoformat(),
                'originalSourceFile':source_file,'originalSourceSha256':source_hash,'baselineSha256':baseline_hash,
                'groups':groups,'notes':[note],'images':[]}, [], decisions, expectations]
        for filename,payload in zip(outputs,payloads):
            path=root/'all-cities'/filename
            with path.open('x',encoding='utf-8',newline='\n') as output:
                output.write(json.dumps(payload,ensure_ascii=False,indent=2)+'\n')
        print(json.dumps({'files':outputs,'entities':len(groups),'mentions':sum(len(g['mentions']) for g in groups),
            'notes':1,'images':0,'sourceSha256':hashlib.sha256((root/'all-cities/batch-31-source.json').read_bytes()).hexdigest()},ensure_ascii=False))
    finally:
        await engine.dispose()


asyncio.run(main())
