"""子项目时长不能作为景区停留值；字段排除仍保留独立整园时长与原始事实。"""
import copy
import json
import sys
from uuid import uuid4
import pytest
from app.models import CanonicalPlace, PlaceMention, PlaceSummary, RawNote
from app.aggregate.place_identity import bootstrap, load_catalog, rollback_decision
from app.aggregate.mention_identity import apply_scope_decision, load_mention_catalog, load_mention_rows
from app.aggregate.summary import mention_groups
from app.clean.scoped_place_export import scoped_facts
from app.clean.mention_identity import effective_fact_value, validate_fact_exclusions
from test_mention_identity_db import run, request

QUOTE = '甲湖西南门进入，码头游船船上时间30分钟，游湖可以看沿岸柳树。'
POLICY = {'visit_duration': {'reason':'subject_mismatch', 'quote':QUOTE}}

def test_船程不作景区时长_真实导出保留独立120分钟及原始缓存_幂等回滚(monkeypatch,tmp_path):
    from scripts import export_to_tripweaver as exporter
    async def check(factory):
        city='子项目时长'+uuid4().hex[:10]
        async with factory() as session:
            p=CanonicalPlace(city=city,name='甲湖',normalized_name='甲湖',place_type='attraction',
                is_active=True,quality_score=20,typical_visit_minutes=30,typical_visit_source='xhs_median')
            notes=[RawNote(city=city,note_id=uuid4().hex,keyword='游湖',title='游湖说明',desc=desc,
                source_url='https://example.com/lake/'+str(i),status='EXTRACTED')
                for i,desc in enumerate([QUOTE,'甲湖环湖游玩120分钟，可以看湖边古亭与垂柳。'])]
            session.add_all([p,*notes]);await session.flush();await bootstrap(session,city)
            session.add(PlaceSummary(canonical_place_id=p.id,mention_count_30d=2,recommend_score=10))
            for note,minutes in zip(notes,[30,120]):
                session.add(PlaceMention(raw_note_id=note.id,name='甲湖',normalized_name='甲湖',place_type='attraction',
                    mention_type='recommend',confidence=.95,reason=note.desc,evidence_text=note.desc,
                    fact_type='visit_duration',fact_value={'minutes':minutes}))
            await session.flush()
            original=copy.deepcopy(await load_mention_rows(session,city));before=await load_catalog(session,city)
            eid=before.resolve(place_id=p.id)['entity_id']
            decision=await request(session,p,[eid,eid],key=uuid4().hex)
            decision['assignments'][0]['factExclusions']=POLICY
            result=await apply_scope_decision(session,decision);assert result==await apply_scope_decision(session,decision)
            cat=await load_mention_catalog(session,city)
            assert [cat.resolve(m)['status'] for m in original]==['resolved','resolved']
            assert 'minutes' not in effective_fact_value(original[0],cat.resolve(original[0]))
            assert effective_fact_value(original[1],cat.resolve(original[1]))['minutes']==120
            assert next(iter(mention_groups(city,cat,original).values()))['durations']==[120]
            payload,evidence=scoped_facts(cat.catalog.entities[eid],original,'',[],mention_catalog=cat)
            assert payload['typicalVisitMinutes']==120 and payload['mentionCount']==2 and len(evidence)==2
            assert original==await load_mention_rows(session,city)
            await session.commit()
        monkeypatch.setattr(exporter,'SessionFactory',factory)
        dest=tmp_path/'places.json';monkeypatch.setattr(sys,'argv',['export_to_tripweaver.py','--city',city,'--out',str(dest)])
        await exporter.main()
        exported=json.loads(dest.read_text(encoding='utf-8'))['places'];assert len(exported)==1
        assert exported[0]['payload']['typicalVisitMinutes']==120
        assert exported[0]['payload']['mentionCount']==2 and exported[0]['payload']['identity']['revision']==2
        async with factory() as session:
            assert (await session.get(CanonicalPlace,p.id)).typical_visit_minutes==30
            await rollback_decision(session,decision['key'])
            assert (await load_catalog(session,city)).entities==before.entities
            assert not (await load_mention_catalog(session,city)).scopes
            assert original==await load_mention_rows(session,city)
    run(check)

@pytest.mark.parametrize('invalid',['quote','other_subject','null_target','wrong_field','missing_minutes'])
def test_子项目时长仍须绑定当前事实与同主体原文(invalid):
    row={'name':'甲湖','normalized_name':'甲湖','note_desc':QUOTE+'\n乙湖游玩120分钟。','note_title':'游湖说明',
        'note_unavailable':False,'fact_type':'visit_duration','fact_value':{'minutes':30}}
    policy=copy.deepcopy(POLICY);target='lake'
    if invalid=='quote':policy['visit_duration']['quote']='甲湖船程只有10分钟'
    elif invalid=='other_subject':policy['visit_duration']['quote']='乙湖游玩120分钟。'
    elif invalid=='null_target':target=None
    elif invalid=='wrong_field':policy={'price':policy['visit_duration']}
    elif invalid=='missing_minutes':row['fact_value']={}
    with pytest.raises(ValueError):validate_fact_exclusions(policy,row,target)
