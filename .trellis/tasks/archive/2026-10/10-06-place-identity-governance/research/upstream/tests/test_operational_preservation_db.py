"""旧运营来源真实SQL、导出、过期拒绝、移除及回滚；不连接业务库。"""
from __future__ import annotations

import copy
import json
import sys
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.aggregate.mention_identity import apply_scope_decision, load_mention_catalog, load_mention_rows
from app.aggregate.operational_preservation import legacy_context
from app.aggregate.place_identity import bootstrap, load_catalog, rollback_decision
from app.clean.legacy_operational_facts import FIELDS, POLICY, fact_names, relevant_images
from app.clean.mention_identity import digest
from app.clean.scoped_place_export import scoped_facts
from app.models import CanonicalPlace, PlaceEntityChange, PlaceMention, PlaceSummary, RawNote
from test_mention_identity_db import request, run


async def seed(session):
    city='运营保全'+uuid4().hex[:10]
    source=CanonicalPlace(city=city,name='清溪公园',normalized_name='清溪公园',place_type='park',
        latitude=30.64,longitude=104.04,geo_status='resolved',is_active=True,quality_score=60)
    note=RawNote(city=city,note_id=uuid4().hex,keyword='公园',title='清溪公园游览',
        desc='清溪公园绿树和湖边很舒服。',source_url='https://example.test/good',status='EXTRACTED')
    hotel=RawNote(city=city,note_id=uuid4().hex,keyword='酒店',title='酒店窗景',
        desc='酒店窗外可见清溪公园。',source_url='https://example.test/hotel',status='EXTRACTED')
    image=RawNote(city=city,note_id=uuid4().hex,keyword='攻略图',title='旧攻略的运营信息',
        desc='这是一份旧攻略，不表示现行政策。',source_url='https://example.test/image-note',status='EXTRACTED',
        img_analysis=[{'has_text':True,'text_content':'清溪公园免费；清溪公园08:00-17:30；清溪公园需提前预约。',
            'key_info':{'price':'别家馆80元；清溪公园免费','hours':'别家馆09:00-18:00；清溪公园08:00-17:30',
                'reservation':'清溪公园需提前预约','tips':''}},
            {'has_text':True,'text_content':'清溪公园08:30-18:00，建议核对官方安排。',
             'key_info':{'hours':'清溪公园08:30-18:00','price':'清溪公园0元'}}])
    session.add_all([source,note,hotel,image])
    await session.flush()
    await bootstrap(session,city)
    eid=(await load_catalog(session,city)).resolve(place_id=source.id)['entity_id']
    mentions=[PlaceMention(raw_note_id=n.id,name=source.name,normalized_name=source.name,place_type='park',
        mention_type='recommend',reason=text,evidence_text=text,confidence=.95)
        for n,text in [(note,'清溪公园绿树和湖边很舒服'),(hotel,'酒店窗外可见清溪公园')]]
    session.add_all([*mentions,PlaceSummary(canonical_place_id=source.id,mention_count_30d=2,recommend_score=10)])
    await session.flush()
    return source,note,hotel,image,mentions,eid


async def build_request(session, source, eid, payload, key):
    decision=await request(session,source,[eid,None],key=key)
    catalog=await load_mention_catalog(session,source.city)
    _,_,notes=await legacy_context(session,source.city,catalog.catalog)
    decision['preserveOperationalFacts']=[{'entityId':eid,'sourcePlaceId':source.id,
        'sources':relevant_images(notes,fact_names(source.name,source.city)),
        'payloadHash':digest({k:v for k,v in payload.items() if k in FIELDS}),
        'evidence':[{'kind':'subject_only_preservation','file':'source-review.json',
            'conclusion':'旧图文明确指向同一公园，只保留旧消费及冲突，不宣称本轮核实运营政策。'}]}]
    return decision


async def export(factory, monkeypatch, tmp_path, city, name):
    from scripts import export_to_tripweaver as exporter
    monkeypatch.setattr(exporter,'SessionFactory',factory)
    path=tmp_path/name
    monkeypatch.setattr(sys,'argv',['export','--city',city,'--out',str(path)])
    await exporter.main()
    return json.loads(path.read_text(encoding='utf-8'))


async def facts(session,city,eid):
    catalog=await load_mention_catalog(session,city)
    rows=[r for r in await load_mention_rows(session,city) if catalog.resolve(r).get('entity',{}).get('entity_id')==eid]
    return scoped_facts(catalog.catalog.entities[eid],rows,'2026-10-10',[],mention_catalog=catalog)


def test_真实导出保全旧字段并隔离酒店_重复导出幂等回滚(monkeypatch,tmp_path):
    async def check(factory):
        async with factory() as session:
            source,note,hotel,image,mentions,eid=await seed(session)
            sid,city=source.id,source.city
            note_before=(note.desc,hotel.desc,copy.deepcopy(image.img_analysis))
            await session.commit()
        before=await export(factory,monkeypatch,tmp_path,city,'before.json')
        old=before['places'][0]['payload']
        assert old['price']=='清溪公园免费' and old['openHours']['text']=='08:00-17:30'
        async with factory() as session:
            source=await session.get(CanonicalPlace,sid)
            decision=await build_request(session,source,eid,old,city+'-scope')
            first=await apply_scope_decision(session,decision)
            assert await apply_scope_decision(session,decision)==first
            result,evidence=await facts(session,city,eid)
            assert {k:v for k,v in result.items() if k in FIELDS}=={k:v for k,v in old.items() if k in FIELDS}
            assert result['mentionCount']==1 and not any('酒店' in e['content'] for e in evidence)
            assert result['operationalIdentity']['currentFactsReviewed'] is False
            assert result['operationalIdentity']['policy']==POLICY
            change=await session.scalar(select(PlaceEntityChange).where(PlaceEntityChange.change_key==decision['key']))
            assert len(change.after['inputs']['operationalSources'])==2
            assert change.before['inputs']['operationalSources']==change.after['inputs']['operationalSources']
            await session.commit()
        after=await export(factory,monkeypatch,tmp_path,city,'after.json')
        repeated=await export(factory,monkeypatch,tmp_path,city,'repeated.json')
        for data in [after,repeated]:
            new=data['places'][0]['payload']
            assert {k:v for k,v in new.items() if k in FIELDS}=={k:v for k,v in old.items() if k in FIELDS}
            assert new['mentionCount']==1 and new['imageIdentity']['approved']==[]
            assert any(s.get('kind')==POLICY for s in data['relationIdentity']['sourceState']['supplementalSources'])
        async with factory() as session:
            await rollback_decision(session,decision['key'])
            assert not (await load_mention_catalog(session,city)).scopes
            assert ((await session.get(RawNote,note.id)).desc,(await session.get(RawNote,hotel.id)).desc,
                (await session.get(RawNote,image.id)).img_analysis)==note_before
            await session.commit()
        restored=await export(factory,monkeypatch,tmp_path,city,'restored.json')
        assert {k:v for k,v in restored['places'][0]['payload'].items() if k in FIELDS}=={k:v for k,v in old.items() if k in FIELDS}
        assert 'operationalIdentity' not in restored['places'][0]['payload']
    run(check)


@pytest.mark.parametrize('variant',['missing','order','fingerprint','value','duplicate','extra','evidence','source','target','null'])
def test_伪造遗漏跨主体与顺序变化均拒绝(variant,monkeypatch,tmp_path):
    async def check(factory):
        async with factory() as session:
            source,_,_,_,_,eid=await seed(session)
            sid,city=source.id,source.city
            await session.commit()
        old=(await export(factory,monkeypatch,tmp_path,city,'before.json'))['places'][0]['payload']
        async with factory() as session:
            source=await session.get(CanonicalPlace,sid)
            decision=await build_request(session,source,eid,old,city+'-scope')
            item=decision['preserveOperationalFacts'][0]
            if variant=='missing':item['sources'].pop()
            if variant=='order':item['sources'].reverse()
            if variant=='fingerprint':item['sources'][0]['inputHash']='0'*64
            if variant=='value':item['payloadHash']='0'*64
            if variant=='duplicate':decision['preserveOperationalFacts'].append(copy.deepcopy(item))
            if variant=='extra':item['price']='清溪公园999元'
            if variant=='evidence':item['evidence'][0]['kind']='facts_verified'
            if variant=='source':item['sourcePlaceId']=sid+10000
            if variant=='target':item['entityId']='another-entity'
            if variant=='null':decision['preserveOperationalFacts']=None
            with pytest.raises(ValueError):
                await apply_scope_decision(session,decision)
            assert not (await load_mention_catalog(session,city)).scopes
    run(check)


@pytest.mark.parametrize('field',['desc','source_url','created_at','publish_time','img_analysis','status'])
def test_补充原笔记变化后消费与回滚都拒绝(field,monkeypatch,tmp_path):
    from datetime import datetime,timezone
    async def check(factory):
        async with factory() as session:
            source,_,_,image,_,eid=await seed(session)
            sid,nid,city=source.id,image.id,source.city
            await session.commit()
        old=(await export(factory,monkeypatch,tmp_path,city,'before.json'))['places'][0]['payload']
        async with factory() as session:
            source=await session.get(CanonicalPlace,sid)
            decision=await build_request(session,source,eid,old,city+'-scope')
            await apply_scope_decision(session,decision)
            image=await session.get(RawNote,nid)
            original=copy.deepcopy(getattr(image,field))
            changed={'desc':'原正文变化','source_url':'https://example.test/changed',
                'created_at':datetime(2030,1,1,tzinfo=timezone.utc),'publish_time':datetime(2030,1,1,tzinfo=timezone.utc),
                'img_analysis':[],'status':'PRIVATE'}[field]
            setattr(image,field,changed)
            await session.flush()
            with pytest.raises(ValueError):await facts(session,city,eid)
            with pytest.raises(ValueError,match='后续修改'):await rollback_decision(session,decision['key'])
            setattr(image,field,original)
            await session.flush()
            await rollback_decision(session,decision['key'])
    run(check)


def test_显式续绑移除回滚_既有受控源不得复活旧池(monkeypatch,tmp_path):
    async def check(factory):
        async with factory() as session:
            source,_,_,_,_,eid=await seed(session)
            sid,city=source.id,source.city
            await session.commit()
        old=(await export(factory,monkeypatch,tmp_path,city,'before.json'))['places'][0]['payload']
        async with factory() as session:
            source=await session.get(CanonicalPlace,sid)
            first=await build_request(session,source,eid,old,city+'-first')
            await apply_scope_decision(session,first)
            second=await request(session,source,[eid,None],key=city+'-second')
            with pytest.raises(ValueError,match='显式列全'):await apply_scope_decision(session,second)
            renewal=await build_request(session,source,eid,old,city+'-renew')
            await apply_scope_decision(session,renewal)
            assert (await facts(session,city,eid))[0]['operationalIdentity']['revision']==3
            with pytest.raises(ValueError):await rollback_decision(session,first['key'])
            await rollback_decision(session,renewal['key'])
            second['preserveOperationalFacts']=[]
            await apply_scope_decision(session,second)
            assert 'price' not in (await facts(session,city,eid))[0]
            resurrect=await build_request(session,source,eid,old,city+'-invalid')
            with pytest.raises(ValueError,match='重新采用旧图片池'):await apply_scope_decision(session,resurrect)
            await rollback_decision(session,second['key'])
            assert (await facts(session,city,eid))[0]['price']==old['price']
            await rollback_decision(session,first['key'])
    run(check)
