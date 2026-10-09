"""细分类治理须贯通实际导出且不更改原源，保留版本、scope和可逆边界。"""
import copy
import json
import sys
from uuid import uuid4

import pytest
from app.models import CanonicalPlace, PlaceMention, PlaceSummary, RawNote
from app.aggregate.place_identity import bootstrap, apply_decision, load_catalog, rollback_decision
from app.aggregate.mention_identity import apply_scope_decision, load_mention_catalog, load_mention_rows
from app.clean.entity_creation import validate_creations
from app.clean.mention_identity import mention_fingerprint
from test_mention_identity_db import run, request


async def seed(session):
    city = '细分类' + uuid4().hex[:10]
    place = CanonicalPlace(city=city,name='湖畔茶馆',normalized_name='湖畔茶馆',place_type='cafe',quality_score=20,is_active=True)
    note = RawNote(city=city,note_id=uuid4().hex,keyword='机位',title='拍摄机位',
        desc='搜索湖畔茶馆，其前平台拍摄湖面与楼阁全景。新平台适合拍摄。',
        source_url='https://example.com/platform',status='EXTRACTED')
    session.add_all([place,note]);await session.flush();await bootstrap(session,city)
    mention = PlaceMention(raw_note_id=note.id,name='湖畔茶馆',normalized_name='湖畔茶馆',place_type='cafe',
        mention_type='recommend',confidence=.95,reason='前平台可拍摄湖面与楼阁全景',evidence_text='其前平台拍摄湖面与楼阁全景')
    session.add_all([mention,PlaceSummary(canonical_place_id=place.id,mention_count_30d=1,recommend_score=8)])
    await session.flush()
    eid = (await load_catalog(session,city)).resolve(place_id=place.id)['entity_id']
    return place,note,mention,eid


def test_细分类与主名实际导出并保留旧ID原源及逆序回滚(monkeypatch,tmp_path):
    from scripts import export_to_tripweaver as exporter
    async def check(factory):
        monkeypatch.setattr(exporter,'SessionFactory',factory)
        async with factory() as session:
            place,_,_,eid = await seed(session);city=place.city
            original=copy.deepcopy(await load_mention_rows(session,city))
            before=await load_catalog(session,city)
            scope=await request(session,place,[eid],key=uuid4().hex)
            await apply_scope_decision(session,scope)
            d={'key':uuid4().hex,'city':city,'entityId':eid,'mergeEntityIds':[],
                'canonicalName':'湖畔茶馆前平台','aliases':['湖畔茶馆前平台'],'excludeNames':['湖畔茶馆'],
                'expectedRevisions':{eid:2},'overrides':{'category':'自然','xhsPlaceType':'photo_spot','lat':None,'lng':None},
                'evidence':[{'quote':'搜索湖畔茶馆，其前平台拍摄湖面与楼阁全景。'}]}
            result=await apply_decision(session,d);assert result==await apply_decision(session,d)
            assert place.place_type=='cafe' and original==await load_mention_rows(session,city)
            cat=await load_mention_catalog(session,city)
            assert cat.catalog.resolve('湖畔茶馆') is None
            assert cat.catalog.resolve('湖畔茶馆前平台')['entity_id']==eid
            assert cat.resolve(original[0])['status']=='resolved'
            await session.commit()
        dest=tmp_path/'places.json'
        monkeypatch.setattr(sys,'argv',['export_to_tripweaver.py','--city',city,'--out',str(dest)])
        await exporter.main()
        exported=json.loads(dest.read_text(encoding='utf-8'))['places']
        assert len(exported)==1
        p=exported[0]
        assert p['id']==eid and p['name']=='湖畔茶馆前平台' and p['category']=='自然'
        assert p['payload']['xhsPlaceType']=='photo_spot'
        assert p['payload']['identity']['revision']==3 and eid in p['payload']['identity']['memberIds']
        assert p['payload']['aliases']==['湖畔茶馆前平台']
        assert p['payload']['mentionSources'][0]['inputHash']==mention_fingerprint(original[0])
        async with factory() as session:
            await rollback_decision(session,d['key']);await rollback_decision(session,scope['key'])
            restored=await load_catalog(session,city)
            assert restored.entities==before.entities and restored.members==before.members
            assert original==await load_mention_rows(session,city)
            assert (await session.get(CanonicalPlace,place.id)).place_type=='cafe'
    run(check)


@pytest.mark.parametrize('value',[None,'',True,12,[],{},'restaurant','PHOTO_SPOT'])
def test_实体与独立新建均拒绝非法细分类且不改变目录(value):
    async def check(factory):
        async with factory() as session:
            p,_,_,eid=await seed(session)
            before=await load_catalog(session,p.city)
            d={'key':uuid4().hex,'city':p.city,'entityId':eid,'expectedRevisions':{eid:1},
                'overrides':{'xhsPlaceType':value},'evidence':[{'source':'类型证据'}]}
            with pytest.raises(ValueError,match='细分类'): await apply_decision(session,d)
            assert (await load_catalog(session,p.city)).entities==before.entities
            row=(await load_mention_rows(session,p.city))[0]
            created={'entityId':uuid4().hex,'canonicalName':'新平台','aliases':[],
                'overrides':{'category':'自然','xhsPlaceType':value},'evidence':[
                    {'mentionId':row['id'],'inputHash':mention_fingerprint(row),'quote':'新平台适合拍摄。'}]}
            with pytest.raises(ValueError,match='细分类'):
                validate_creations([created],[row],[{'mentionId':row['id'],'entityId':created['entityId']}],before,set())
    run(check)


def test_独立主体允许明确细分类并沿统一导出覆盖原值():
    from app.clean.place_export import consolidate_places
    from app.clean.identity import IdentityCatalog
    async def check(factory):
        async with factory() as session:
            p,_,_,_=await seed(session)
            catalog=await load_catalog(session,p.city)
            row=(await load_mention_rows(session,p.city))[0];eid=uuid4().hex
            created={'entityId':eid,'canonicalName':'新平台','aliases':[],
                'overrides':{'category':'自然','xhsPlaceType':'photo_spot'},'evidence':[
                    {'mentionId':row['id'],'inputHash':mention_fingerprint(row),'quote':'新平台适合拍摄。'}]}
            entities=validate_creations([created],[row],[{'mentionId':row['id'],'entityId':eid}],catalog,set())
            output=consolidate_places([{'sourceEntityId':eid,'name':'新平台','payload':{
                'mentionSources':[{'mentionId':row['id']}],'xhsPlaceType':'cafe'}}],p.city,'2026-10-09',IdentityCatalog(p.city,entities,[]))
            assert output[0]['payload']['xhsPlaceType']=='photo_spot'
    run(check)
