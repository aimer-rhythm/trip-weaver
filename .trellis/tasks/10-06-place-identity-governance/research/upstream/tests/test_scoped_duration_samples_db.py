"""同篇重复抽取不加权游览时长，跨篇独立来源仍贡献样本。"""
import copy
import json
import sys
from uuid import uuid4
from app.models import CanonicalPlace,PlaceMention,PlaceSummary,RawNote
from app.aggregate.place_identity import bootstrap,load_catalog,rollback_decision
from app.aggregate.mention_identity import apply_scope_decision,load_mention_catalog,load_mention_rows
from app.aggregate.summary import mention_groups
from app.clean.scoped_place_export import scoped_facts
from test_mention_identity_db import run,request

def test_重复高时长不改变中位数_不同原文相同分钟仍计数_实际导出与回滚(monkeypatch,tmp_path):
    from scripts import export_to_tripweaver as exporter
    async def check(factory):
        city='时长去重'+uuid4().hex[:10]
        async with factory() as s:
            p=CanonicalPlace(city=city,name='甲泉',normalized_name='甲泉',place_type='attraction',is_active=True,quality_score=20,
                typical_visit_minutes=90,typical_visit_source='xhs_median')
            minutes=[30,50,60,90]
            notes=[RawNote(city=city,note_id=uuid4().hex,keyword='游览',title='甲泉游览',desc=f'甲泉游玩{n}分钟。',
                source_url='https://example.com/visit/'+str(i),status='EXTRACTED') for i,n in enumerate(minutes)]
            s.add_all([p,*notes]);await s.flush();await bootstrap(s,city)
            s.add(PlaceSummary(canonical_place_id=p.id,mention_count_30d=8,recommend_score=10))
            # 最后一篇重复5次，旧按提及加权中位数为90，按独立篇次应为60。
            for index in [0,1,2,3,3,3,3,3]:
                n=notes[index];s.add(PlaceMention(raw_note_id=n.id,name='甲泉',normalized_name='甲泉',place_type='attraction',
                    mention_type='recommend',confidence=.95,reason=n.desc,evidence_text=n.desc,fact_type='visit_duration',fact_value={'minutes':minutes[index]}))
            await s.flush();original=copy.deepcopy(await load_mention_rows(s,city));before=await load_catalog(s,city)
            eid=before.resolve(place_id=p.id)['entity_id'];decision=await request(s,p,[eid]*8,key=uuid4().hex)
            await apply_scope_decision(s,decision);cat=await load_mention_catalog(s,city)
            groups=mention_groups(city,cat,original);assert next(iter(groups.values()))['durations']==[30,50,60,90]
            payload,_=scoped_facts(cat.catalog.entities[eid],original,'',[],mention_catalog=cat)
            assert payload['typicalVisitMinutes']==60 and payload['mentionCount']==8
            # 独立篇次即使分钟数相同仍计数；不将所有相同值全局去重。
            extra=copy.deepcopy(original[0]);extra['id']=max(r['id'] for r in original)+1
            extra['raw_note_id']=max(r['raw_note_id'] for r in original)+1
            ordinary=copy.deepcopy(original)+[extra]
            from app.clean.mention_identity import MentionIdentityCatalog
            unscoped=MentionIdentityCatalog(before,[],[])
            assert next(iter(mention_groups(city,unscoped,ordinary).values()))['durations']==[30,50,60,90,30]
            assert original==await load_mention_rows(s,city);await s.commit()
        monkeypatch.setattr(exporter,'SessionFactory',factory)
        dest=tmp_path/'places.json';monkeypatch.setattr(sys,'argv',['export_to_tripweaver.py','--city',city,'--out',str(dest)])
        await exporter.main();pout=json.loads(dest.read_text(encoding='utf-8'))['places'][0]
        assert pout['payload']['typicalVisitMinutes']==60 and len(pout['payload']['mentionSources'])==8
        async with factory() as s:
            assert (await s.get(CanonicalPlace,p.id)).typical_visit_minutes==90
            await rollback_decision(s,decision['key']);assert original==await load_mention_rows(s,city)
            assert (await load_catalog(s,city)).entities==before.entities
    run(check)
