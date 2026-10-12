"""核对两组济南名称的全部真实来源，再生成第32批同体决策。"""
from pathlib import Path
import asyncio
import hashlib
import json
import sys
from datetime import datetime, timezone
sys.dont_write_bytecode=True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0,'D:/Project/xhs-travel-pipeline')
from sqlalchemy import select, text
from app.db import SessionFactory, engine
from app.models import CanonicalPlace
from app.aggregate.mention_identity import load_mention_catalog, load_mention_rows, source_keys
from app.aggregate.image_identity import load_image_rows
from app.clean.mention_identity import mention_fingerprint, scope_matches

root=Path(__file__).resolve().parent
source_file='priority-cities/济南/run-1791385235272324900/sources.json'
source_hash='9aa559e894e1cfbcdf74db2214c8eeb6614739064a96967780c6b32af59a889b'
plans=[
    ('超然楼','d4a51a5df56f78c9de0713d86ea8c00c','ef9937ce2185cc51d0870a6c8ce9feaa',{},
     [(2546,'3.大明湖超然楼：出了百花洲，沿着大明湖畔而行到超然楼'),
      (2553,'超然楼是济南的地标建筑之一，登楼俯瞰大明湖和整个济南市区'),
      (2830,'📍超然楼：大明湖地标')],
     '完整24条提及均以超然楼建筑或其亮灯为描述对象。2546同一段用大明湖超然楼和超然楼指向同一楼体。2620、2795、2797的远处机位是拍摄位置说明，不把码头、茶馆平台、桥或大明湖整体并成楼体；只合并两个楼体名称。保留主源5368地图楼体参考点，不使用5365的西侧旧点。'),
    ('宽厚里','bc2769d509f6d8d42166e81b8db8131b','fda8cc53ff6acf76aeefe23e61b75427',{'address':''},
     [(2545,'▪️宽厚里美食街\n游玩1h｜吃喝休整'),
      (2782,'解放阁马路对过就是宽厚里，一条小吃街'),
      (2851,'3. 宽厚里：仿古街区，比芙蓉街新也大')],
     '完整32条提及均指解放阁与黑虎泉旁的宽厚里商业街区。2545美食街用法为泉城广场与黑虎泉之间整段逛吃目的地，其他来源交叉确认同一小吃商业街，不存在另一独立店铺或另名路段。保留已匹配济南宽厚里本体的原坐标；清空地图异常返回的趵突泉南路1地址，不把周边具体门店或公交站替代街区。芙蓉街、解放阁、黑虎泉仍独立。'),
]


async def main():
    assert hashlib.sha256((root/source_file).read_bytes()).hexdigest()==source_hash
    frozen=json.loads((root/source_file).read_text(encoding='utf-8'))
    assert hashlib.sha256((root/'all-cities/batch-32-baseline.json').read_bytes()).hexdigest()=='43d61c596ac01af954774c72fe63c05efc00fcf9af624812dee32f02fc57bb27'
    assert not (root/'all-cities/batch-32-decisions.json').exists()
    decisions=[]
    try:
        async with SessionFactory() as session:
            await session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            catalog=await load_mention_catalog(session,'济南')
            sources=(await session.scalars(select(CanonicalPlace).where(CanonicalPlace.city=='济南'))).all()
            mentions=await load_mention_rows(session,'济南')
            images=await load_image_rows(session,'济南')
            for i,(name,eid,other,overrides,quotes,conclusion) in enumerate(plans,1):
                groups=[g for g in frozen['groups'] if g['entity']['entity_id'] in [eid,other]]
                assert len(groups)==2
                source_ids={pid for g in groups for pid in g['sourceIds']}
                mids={mid for g in groups for mid in g['mentionIds']}
                keys=set()
                for group in groups:
                    assert catalog.catalog.root(group['entity']['entity_id'])==group['entity']
                    assert group['entity']['revision']==1
                    keys.update(group['nameKeys'])
                actual_sources=[s for s in sources if keys & source_keys(s)]
                assert {s.id for s in actual_sources}==source_ids
                assert all(catalog.scope_for_source(s.id) is None for s in actual_sources)
                for source in actual_sources:
                    original=next(s for s in frozen['sources'] if s['id']==source.id)
                    for key in ['name','normalized_name','address','latitude','longitude','geo_status','place_type','is_active']:
                        assert getattr(source,key)==original[key]
                rows=[m for m in mentions if scope_matches({'city':'济南','name_keys':keys},m)]
                assert {r['id'] for r in rows}==mids
                for row in rows:
                    assert mention_fingerprint(row)==next(m for m in frozen['mentions'] if m['id']==row['id'])['inputHash']
                note_ids={r['raw_note_id'] for r in rows}
                assert not [im for im in images if im['source_place_id'] in source_ids or im['raw_note_id'] in note_ids]
                for note_id,quote in quotes:
                    note=next(n for n in frozen['notes'] if n['id']==note_id)
                    assert quote in note['note_desc']
                evidence=[{'kind':'reviewed_full_note_context','file':source_file,'sha256':source_hash,
                    'sourcePlaceIds':sorted(source_ids),'mentionIds':sorted(mids),'noteIds':sorted(note_ids),
                    'quotes':[{'noteId':n,'quote':q} for n,q in quotes],'conclusion':conclusion}]
                for geo in ['priority-cities/济南/geo-03.json','priority-cities/济南/geo-04.json']:
                    evidence.append({'kind':'map_candidates','file':geo,'sha256':hashlib.sha256((root/geo).read_bytes()).hexdigest(),
                        'conclusion':'原始CGCS2000与转换GCJ02全部候选保留；仅用本体结果辅助位置核查，不以同点、码头、停车场或门店点证明同体。'})
                decisions.append({'key':f'all-cities-20261008-batch-32-{i:03d}','city':'济南',
                    'entityId':eid,'mergeEntityIds':[other],'canonicalName':name,
                    'expectedRevisions':{eid:1,other:1},'overrides':overrides,'evidence':evidence})
        path=root/'all-cities/batch-32-decisions.json'
        with path.open('x',encoding='utf-8',newline='\n') as output:
            output.write(json.dumps(decisions,ensure_ascii=False,indent=2)+'\n')
        print(json.dumps({'file':path.name,'groups':2,'sourceRows':4,'mentions':56,'fullNotes':36,'upstreamImages':0,
            'sha256':hashlib.sha256(path.read_bytes()).hexdigest()},ensure_ascii=False))
    finally:
        await engine.dispose()


asyncio.run(main())
