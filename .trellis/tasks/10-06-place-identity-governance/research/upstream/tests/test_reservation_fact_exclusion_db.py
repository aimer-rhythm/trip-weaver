"""游船预约字段排除不能撤回景区或丢失独立有效政策；原始事实可回溯。"""
import copy
import json
import sys
from uuid import uuid4
import pytest
from app.models import CanonicalPlace,PlaceMention,PlaceSummary,RawNote
from app.aggregate.place_identity import bootstrap,load_catalog,rollback_decision
from app.aggregate.mention_identity import apply_scope_decision,load_mention_catalog,load_mention_rows
from app.clean.mention_identity import effective_fact_value,validate_fact_exclusions
from app.clean.scoped_place_export import scoped_facts
from test_mention_identity_db import run,request

QUOTE='甲泉旁游船需要提前预约选座，泉水从石雕虎首喷涌。'
POLICY={'reservation':{'reason':'subject_mismatch','quote':QUOTE}}

@pytest.mark.parametrize('independent,status',[(None,'unknown'),('甲泉无需预约，可现场游览。','none'),('甲泉进入景区必须提前预约。','required')])
def test_游船预约不作为景区政策_独立政策保留_实际导出幂等回滚(monkeypatch,tmp_path,independent,status):
    from scripts import export_to_tripweaver as exporter
    async def check(factory):
        city='预约字段'+uuid4().hex[:10]
        async with factory() as s:
            p=CanonicalPlace(city=city,name='甲泉',normalized_name='甲泉',place_type='attraction',is_active=True,quality_score=20)
            texts=[QUOTE]+([independent] if independent else [])
            notes=[RawNote(city=city,note_id=uuid4().hex,keyword='游览',title='泉边游览',desc=v,
                source_url='https://example.com/spring/'+str(i),status='EXTRACTED') for i,v in enumerate(texts)]
            s.add_all([p,*notes]);await s.flush();await bootstrap(s,city)
            s.add(PlaceSummary(canonical_place_id=p.id,mention_count_30d=len(notes),recommend_score=10))
            for n in notes:s.add(PlaceMention(raw_note_id=n.id,name='甲泉',normalized_name='甲泉',place_type='attraction',
                mention_type='recommend',confidence=.95,reason=n.desc,evidence_text=n.desc,fact_type='reservation',fact_value={'reservation':True}))
            await s.flush();original=copy.deepcopy(await load_mention_rows(s,city));before=await load_catalog(s,city)
            eid=before.resolve(place_id=p.id)['entity_id'];decision=await request(s,p,[eid]*len(notes),key=uuid4().hex)
            decision['assignments'][0]['factExclusions']=POLICY
            result=await apply_scope_decision(s,decision);assert result==await apply_scope_decision(s,decision)
            cat=await load_mention_catalog(s,city);resolution=cat.resolve(original[0])
            assert resolution['status']=='resolved' and resolution['entity']['entity_id']==eid
            assert 'reservation' not in effective_fact_value(original[0],resolution)
            payload,evidence=scoped_facts(cat.catalog.entities[eid],original,'',[],mention_catalog=cat)
            assert payload['reservation']==status and QUOTE not in payload['reservationEvidence']
            assert payload['reservationEvidence']==([independent] if independent else [])
            assert any(QUOTE==e['content'] for e in evidence) # 具名游船描述仍是有效语境，未改写整条提及。
            assert original==await load_mention_rows(s,city)
            await s.commit()
        monkeypatch.setattr(exporter,'SessionFactory',factory)
        dest=tmp_path/'places.json';monkeypatch.setattr(sys,'argv',['export_to_tripweaver.py','--city',city,'--out',str(dest)])
        await exporter.main();export=json.loads(dest.read_text(encoding='utf-8'))['places']
        assert len(export)==1 and export[0]['verified'] is True
        assert export[0]['payload']['reservation']==status
        assert export[0]['payload']['reservationEvidence']==([independent] if independent else [])
        assert len(export[0]['payload']['mentionSources'])==len(notes)
        async with factory() as s:
            assert (await load_mention_rows(s,city))[0]['fact_value']['reservation'] is True
            await rollback_decision(s,decision['key'])
            assert (await load_catalog(s,city)).entities==before.entities
            assert not (await load_mention_catalog(s,city)).scopes
            assert original==await load_mention_rows(s,city)
    run(check)

@pytest.mark.parametrize('invalid',['quote','other_subject','null_target','missing_flag','number_flag','string_flag','wrong_reason','extra_field'])
def test_预约排除必须有当前布尔事实与绑定原文(invalid):
    row={'name':'甲泉','normalized_name':'甲泉','note_desc':QUOTE+'\n乙泉需预约。','note_title':'泉边游览',
        'note_unavailable':False,'fact_type':'reservation','fact_value':{'reservation':True}}
    policy=copy.deepcopy(POLICY);target='spring'
    if invalid=='quote':policy['reservation']['quote']='甲泉预约已取消。'
    elif invalid=='other_subject':policy['reservation']['quote']='乙泉需预约。'
    elif invalid=='null_target':target=None
    elif invalid=='missing_flag':row['fact_value']={}
    elif invalid=='number_flag':row['fact_value']['reservation']=1
    elif invalid=='string_flag':row['fact_value']['reservation']='true'
    elif invalid=='wrong_reason':policy['reservation']['reason']='group_duration'
    elif invalid=='extra_field':policy['reservation']['replace']=False
    with pytest.raises(ValueError):validate_fact_exclusions(policy,row,target)
