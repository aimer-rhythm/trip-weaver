"""明确非地点与待审语义分开，真实SQL验证原文绑定、撤回及历史兼容。"""
from __future__ import annotations

import copy
import json
import sys
from uuid import uuid4

import pytest
from sqlalchemy import select, text

from app.aggregate.mention_identity import apply_scope_decision, load_mention_catalog, load_mention_rows, refresh_mention_reviews
from app.aggregate.place_identity import bootstrap, load_catalog, rollback_decision
from app.clean.mention_identity import mention_fingerprint
from app.models import CanonicalPlace, PlaceEntityReview, PlaceMention, PlaceMentionAssignment, PlaceSummary, RawNote
from test_mention_identity_db import run, request


async def seed(session):
    city = '非地点排除' + uuid4().hex[:10]
    place = CanonicalPlace(city=city, name='九转大肠', normalized_name='九转大肠',
        is_active=True, geo_status='resolved', latitude=36.66, longitude=117.02)
    note = RawNote(city=city, note_id=uuid4().hex, keyword='菜品', title='济南吃过的菜',
        desc='九转大肠（鲁菜经典，酸甜咸辣香五味俱全）\n独立小馆在东街1号。', status='EXTRACTED')
    session.add_all([place,note]); await session.flush()
    await bootstrap(session,city)
    for _ in range(2):
        session.add(PlaceMention(raw_note_id=note.id,name=place.name,normalized_name=place.name,
            place_type='food',mention_type='recommend',confidence=.95,
            reason='鲁菜经典，酸甜咸辣香五味俱全',evidence_text='九转大肠（鲁菜经典，酸甜咸辣香五味俱全）'))
    session.add(PlaceSummary(canonical_place_id=place.id,mention_count_30d=2,recommend_score=9.5))
    await session.flush()
    return place,note


def excluded(assignment):
    return {**assignment,'exclusion':{'reason':'not_a_place','quote':'九转大肠（鲁菜经典，酸甜咸辣香五味俱全）'}}


async def pending(session,city):
    return (await session.scalars(select(PlaceEntityReview).where(PlaceEntityReview.city==city,
        PlaceEntityReview.status=='PENDING'))).all()


def test_确定非地点与空目标分别统计_允许重新待审并倒序回滚():
    async def check(factory):
        async with factory() as session:
            place,_=await seed(session)
            rows=copy.deepcopy(await load_mention_rows(session,place.city))
            baseline=copy.deepcopy((await load_catalog(session,place.city)).entities)
            first=await request(session,place,[None,None],key=uuid4().hex)
            old=await apply_scope_decision(session,first)
            assert all('exclusion' not in a for a in old['assignments'])
            assert len(await pending(session,place.city))==2
            second=await request(session,place,[None,None],key=uuid4().hex)
            second['assignments'][0]=excluded(second['assignments'][0])
            after=await apply_scope_decision(session,second)
            assert await apply_scope_decision(session,second)==after
            catalog=await load_mention_catalog(session,place.city)
            assert [catalog.resolve(r)['status'] for r in rows]==['excluded','review']
            assert len(await pending(session,place.city))==1
            assert after['assignments'][0]['exclusion']==second['assignments'][0]['exclusion']
            assert 'exclusion' not in after['assignments'][1]
            third=await request(session,place,[None,None],key=uuid4().hex)
            await apply_scope_decision(session,third)
            assert len(await pending(session,place.city))==2
            with pytest.raises(ValueError,match='后续'):
                await rollback_decision(session,second['key'])
            await rollback_decision(session,third['key'])
            assert len(await pending(session,place.city))==1
            await rollback_decision(session,second['key'])
            assert len(await pending(session,place.city))==2
            assert all('exclusion' not in a for a in (await load_mention_catalog(session,place.city)).assignments.values())
            await rollback_decision(session,first['key'])
            assert (await load_catalog(session,place.city)).entities==baseline
            assert not await pending(session,place.city)
            assert await load_mention_rows(session,place.city)==rows
    run(check)


def test_新提及与原文变化不能继承非地点结论():
    async def check(factory):
        async with factory() as session:
            place,note=await seed(session)
            decision=await request(session,place,[None,None],key=uuid4().hex)
            decision['assignments']=[excluded(a) for a in decision['assignments']]
            await apply_scope_decision(session,decision)
            assert not await pending(session,place.city)
            session.add(PlaceMention(raw_note_id=note.id,name=place.name,normalized_name=place.name,reason='新提及须重新核实'))
            await session.flush()
            await refresh_mention_reviews(session,place.city)
            rows=await load_mention_rows(session,place.city)
            catalog=await load_mention_catalog(session,place.city)
            assert [catalog.resolve(r)['status'] for r in rows]==['excluded','excluded','review']
            assert len(await pending(session,place.city))==1
            note.desc+='\n新增具体店铺语境，旧结论须重新审核。'; await session.flush()
            await refresh_mention_reviews(session,place.city)
            rows=await load_mention_rows(session,place.city)
            assert [catalog.resolve(r)['reason'] for r in rows]==['changed_input','changed_input','unreviewed_mention']
            assert len(await pending(session,place.city))==3
    run(check)


def test_来源变化优先于非地点排除():
    async def check(factory):
        async with factory() as session:
            place,_=await seed(session)
            decision=await request(session,place,[None,None],key=uuid4().hex)
            decision['assignments']=[excluded(a) for a in decision['assignments']]
            await apply_scope_decision(session,decision)
            place.name='九转大肠餐馆'; await session.flush()
            rows=await load_mention_rows(session,place.city)
            catalog=await load_mention_catalog(session,place.city)
            assert all(catalog.resolve(r)['reason']=='changed_source' for r in rows)
    run(check)


@pytest.mark.parametrize('invalid',['target','reason','extra','unquoted','other_subject','empty','unavailable','stale'])
def test_非地点排除须绑定当前原文及空目标(invalid):
    async def check(factory):
        async with factory() as session:
            place,note=await seed(session)
            decision=await request(session,place,[None,None],key=uuid4().hex)
            decision['assignments'][0]=excluded(decision['assignments'][0])
            value=decision['assignments'][0]
            if invalid=='target': value['entityId']=next(iter(decision['expectedRevisions']))
            elif invalid=='reason': value['exclusion']['reason']='no_evidence'
            elif invalid=='extra': value['exclusion']['extra']='任意扩展'
            elif invalid=='unquoted': value['exclusion']['quote']='九转大肠是菜品不是地点。'
            elif invalid=='other_subject': value['exclusion']['quote']='独立小馆在东街1号。'
            elif invalid=='empty': value['exclusion']['quote']=''
            elif invalid=='unavailable':
                note.status='PRIVATE'; await session.flush()
                rows=await load_mention_rows(session,place.city)
                for assignment,row in zip(decision['assignments'],rows): assignment['inputHash']=mention_fingerprint(row)
            elif invalid=='stale':
                note.desc+='修改'; await session.flush()
            baseline=copy.deepcopy((await load_catalog(session,place.city)).entities)
            with pytest.raises(ValueError): await apply_scope_decision(session,decision)
            assert (await load_catalog(session,place.city)).entities==baseline
            assert not (await load_mention_catalog(session,place.city)).scopes
    run(check)


def test_非地点撤回经过真实导出_无事实无图片_原文与旧ID保留(monkeypatch,tmp_path):
    from scripts import export_to_tripweaver as exporter
    async def check(factory):
        async with factory() as session:
            place,_=await seed(session)
            city=place.city
            original=copy.deepcopy(await load_mention_rows(session,city))
            decision=await request(session,place,[None,None],key=uuid4().hex)
            decision['assignments']=[excluded(a) for a in decision['assignments']]
            eid=next(iter(decision['expectedRevisions']))
            await apply_scope_decision(session,decision)
            await session.commit()
        monkeypatch.setattr(exporter,'SessionFactory',factory)
        file=tmp_path/'xhs-places-non-place.json'
        monkeypatch.setattr(sys,'argv',['export_to_tripweaver.py','--city',city,'--out',str(file)])
        await exporter.main()
        rows=json.loads(file.read_text(encoding='utf-8'))['places']
        assert len(rows)==1
        row=rows[0]
        assert row['id']==eid and row['verified'] is False
        assert row['lat'] is row['lng'] is None
        assert row['payload']['identityWithdrawal']['candidateIds']==[]
        assert row['payload']['mentionSources']==row['payload']['imageIdentity']['approved']==[]
        assert row['payload']['recommendScore']==0 and row['evidence']==[]
        async with factory() as session:
            assert await load_mention_rows(session,city)==original
            assert not await pending(session,city)
            await rollback_decision(session,decision['key'])
            assert not (await load_mention_catalog(session,city)).scopes
            await session.commit()
    run(check)


def test_新增可空列保留旧快照_旧审计仍可回滚():
    from scripts.migrate_place_identity import migrate
    async def check(factory):
        async with factory() as session:
            place,_=await seed(session)
            decision=await request(session,place,[None,None],key=uuid4().hex)
            old=await apply_scope_decision(session,decision)
            city=place.city
            assert all('exclusion' not in a for a in old['assignments'])
            await session.commit()
        engine=factory.kw['bind']
        async with engine.begin() as connection:
            await connection.execute(text('ALTER TABLE place_mention_assignment DROP COLUMN exclusion'))
            assert (await migrate(connection,False))['missingColumns']==['place_mention_assignment.exclusion']
            await migrate(connection,True)
            assert (await migrate(connection,True))['missingColumns']==[]
        async with factory() as session:
            catalog=await load_mention_catalog(session,city)
            assert all('exclusion' not in a for a in catalog.assignments.values())
            assert all(a.exclusion is None for a in (await session.scalars(select(PlaceMentionAssignment))).all())
            await rollback_decision(session,decision['key'])
            assert not (await load_mention_catalog(session,city)).scopes
    run(check)
