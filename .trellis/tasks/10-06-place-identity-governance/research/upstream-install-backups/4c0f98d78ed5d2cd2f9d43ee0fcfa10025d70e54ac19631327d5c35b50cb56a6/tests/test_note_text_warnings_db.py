"""完整文字警告的SQL、实际导出、变更拒绝、移除与逆序回滚。"""
import copy
import json
import os
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import select, text

from app.aggregate.mention_identity import apply_scope_decision, load_mention_catalog, load_mention_rows
from app.aggregate.note_text_warnings import load_warning_notes
from app.aggregate.place_identity import apply_decision, bootstrap, load_catalog, rollback_decision
from app.clean.note_text_warnings import warning_input
from app.clean.relation_snapshot import build_relation_snapshot
from app.clean.scoped_place_export import scoped_facts
from app.models import CanonicalPlace, PlaceIdentityScope, PlaceMention, PlaceSummary, RawNote
from test_mention_identity_db import request, run

QUOTE = '美食：别在甲街买小吃，又贵又不正宗！'
TEXT = '🧭城市避坑指南\n'+QUOTE+'\n乙馆周一闭馆；黑虎泉接水自带空瓶。'


async def seed(session, quote=QUOTE):
    city = '文字警告'+uuid4().hex[:10]
    p = CanonicalPlace(city=city, name='甲街', normalized_name='甲街', place_type='other',
        is_active=True, quality_score=20, latitude=36.66, longitude=117.02)
    n = RawNote(city=city, note_id=uuid4().hex, keyword='街道', title='街道散步', desc='甲街有老房子，游玩30分钟。',
        source_url='https://example.com/street', status='EXTRACTED')
    warning = RawNote(city=city, note_id=uuid4().hex, keyword='攻略', title='作者意见', desc='仅话题。',
        img_analysis=[{'text_content': TEXT.replace(QUOTE, quote), 'key_info': {'tips': quote+'；乙馆周一闭馆'}}],
        source_url='https://example.com/warning', status='EXTRACTED', publish_time=datetime(2026,6,29,tzinfo=timezone.utc))
    session.add_all([p,n,warning]);await session.flush();await bootstrap(session,city)
    session.add(PlaceSummary(canonical_place_id=p.id,mention_count_30d=1,recommend_score=10))
    session.add(PlaceMention(raw_note_id=n.id,name='甲街',normalized_name='甲街',place_type='other',
        mention_type='recommend',confidence=.95,reason='甲街老房子适合漫步，游玩30分钟。',evidence_text=n.desc,
        fact_type='visit_duration',fact_value={'minutes':30}))
    await session.flush()
    eid=(await load_catalog(session,city)).resolve(place_id=p.id)['entity_id']
    d=await request(session,p,[eid],key=uuid4().hex)
    notes=await load_warning_notes(session,[{'noteId':warning.id}])
    d['textWarnings']=[{**warning_input(warning.id,0,notes[warning.id]),'start':TEXT.index(QUOTE),
        'end':TEXT.index(QUOTE)+len(quote),'quote':quote,'entityId':eid}]
    return p,warning,d


@pytest.mark.parametrize('quote', [QUOTE, '人多可以不去\n甲街'])
def test_实际导出保留完整意见不挪用他处事实_显式移除及逆序回滚(monkeypatch,tmp_path,quote):
    from scripts import export_to_tripweaver as exporter
    async def check(factory):
        monkeypatch.setattr(exporter,'SessionFactory',factory)
        folder=Path(os.environ.get('NOTE_WARNING_FIXTURE_DIR') or tmp_path)
        if quote != QUOTE:
            folder=folder/'multiline';folder.mkdir(parents=True,exist_ok=True)
        async with factory() as s:
            p,warning,d=await seed(s,quote);city=p.city;eid=d['assignments'][0]['entityId']
            original=copy.deepcopy(await load_mention_rows(s,city));raw=copy.deepcopy(warning.img_analysis)
            before=await load_catalog(s,city);await s.commit()
        async def export(name):
            dest=folder/name;monkeypatch.setattr(sys,'argv',['export_to_tripweaver.py','--city',city,'--out',str(dest)])
            await exporter.main();return json.loads(dest.read_text(encoding='utf-8'))
        old=await export('xhs-places-before.json')
        async with factory() as s:
            result=await apply_scope_decision(s,d);assert result==await apply_scope_decision(s,d)
            assert result['scopes'][0]['text_warnings']==d['textWarnings']
            assert result['inputs']['textWarnings'][0]['inputHash']==d['textWarnings'][0]['inputHash']
            await s.commit()
        data=await export('xhs-places-with-warning.json');place=data['places'][0]
        assert len(data['places'])==1 and place['verified']
        assert place['payload']['tips']==[quote]
        assert place['payload']['mentionCount']==1 and place['payload']['typicalVisitMinutes']==30
        assert place['payload']['reservation']=='unknown' and place['payload']['openHours']['status']=='unknown'
        assert len(place['payload']['mentionSources'])==1
        assert [e['content'] for e in place['evidence'] if e['kind']=='xhs_warning']==[quote]
        assert '又贵' not in place['payload']['content']['intro']
        assert 'supplementalSources' not in old['relationIdentity']['sourceState']
        assert data['relationIdentity']['sourceState']['supplementalSources'][0]['scopePlaceId']==p.id
        async with factory() as s:
            removed=await request(s,p,[eid],key=uuid4().hex);removed['textWarnings']=[]
            await apply_scope_decision(s,removed);await s.commit()
        cleared=await export('xhs-places-removed-warning.json')
        assert 'tips' not in cleared['places'][0]['payload']
        assert not any(e['kind']=='xhs_warning' for e in cleared['places'][0]['evidence'])
        assert 'supplementalSources' not in cleared['relationIdentity']['sourceState']
        async with factory() as s:
            await rollback_decision(s,removed['key'])
            cat=await load_mention_catalog(s,city)
            assert scoped_facts(cat.catalog.entities[eid],original,'',[],mention_catalog=cat)[0]['tips']==[quote]
            await rollback_decision(s,d['key'])
            assert (await load_catalog(s,city)).entities==before.entities
            assert not (await load_mention_catalog(s,city)).scopes
            assert original==await load_mention_rows(s,city)
            assert (await s.get(RawNote,warning.id)).img_analysis==raw
        (folder/'report.json').write_text(json.dumps({'city':city,'entityId':eid,'quote':quote,'scopeSourceId':p.id,
            'actualExport':True,'idempotent':True,'reverseRollback':True,'rawPreserved':True,'failures':[]},ensure_ascii=False,indent=2),encoding='utf-8')
    run(check)


@pytest.mark.parametrize('case',['null','object','missing','extra','float_index','bool_id','out_of_range','other_city','private',
    'wrong_hash','changed_text','changed_date','wrong_quote','trim_negation','multiline','unconfirmed','duplicate','other_name'])
def test_非法警告在任何实体变更前拒绝(case):
    async def check(factory):
        async with factory() as s:
            p,n,d=await seed(s);item=d['textWarnings'][0]
            if case=='null':d['textWarnings']=None
            elif case=='object':d['textWarnings']={}
            elif case=='missing':del item['quote']
            elif case=='extra':item['replacement']='更便宜'
            elif case=='float_index':item['imageIndex']=0.0
            elif case=='bool_id':item['noteId']=True
            elif case=='out_of_range':item['end']=len(TEXT)+1;item['quote']=TEXT[item['start']:]
            elif case=='other_city':n.city='别城'
            elif case=='private':n.status='PRIVATE'
            elif case=='wrong_hash':item['inputHash']='0'*64
            elif case=='changed_text':n.img_analysis=[{'text_content':TEXT+'变化'}]
            elif case=='changed_date':n.publish_time+=timedelta(days=1)
            elif case=='wrong_quote':item['quote']='甲街便宜又正宗，适合吃饭。'
            elif case=='trim_negation':item['start']+=4;item['quote']=QUOTE[4:]
            elif case=='multiline':item['start']=0;item['end']=len(TEXT);item['quote']=TEXT
            elif case=='unconfirmed':d['assignments'][0]['entityId']=None
            elif case=='duplicate':d['textWarnings'].append(copy.deepcopy(item))
            elif case=='other_name':item['quote']=TEXT.splitlines()[-1];item['start']=TEXT.index(item['quote']);item['end']=len(TEXT)
            await s.flush();before=(await load_catalog(s,p.city)).entities
            with pytest.raises(ValueError):await apply_scope_decision(s,d)
            assert (await load_catalog(s,p.city)).entities==before
            assert not (await load_mention_catalog(s,p.city)).scopes
    run(check)


@pytest.mark.parametrize('case',['text','deleted','missing_analysis','date'])
def test_审核后来源变化禁止静默替换或丢失意见并拒绝过期回滚(case):
    async def check(factory):
        async with factory() as s:
            p,n,d=await seed(s);eid=d['assignments'][0]['entityId'];await apply_scope_decision(s,d)
            rows=await load_mention_rows(s,p.city);cat=await load_mention_catalog(s,p.city)
            before=build_relation_snapshot(cat,rows)
            if case=='text':n.img_analysis=[{'text_content':TEXT.replace('又贵','便宜')}]
            elif case=='deleted':n.status='DELETED'
            elif case=='missing_analysis':n.img_analysis=None
            else:n.publish_time+=timedelta(days=1)
            await s.flush();changed=await load_mention_catalog(s,p.city)
            assert build_relation_snapshot(changed,rows)['sourceHash']!=before['sourceHash']
            with pytest.raises(ValueError):scoped_facts(changed.catalog.entities[eid],rows,'',[],mention_catalog=changed)
            with pytest.raises(ValueError,match='后续'):await rollback_decision(s,d['key'])
    run(check)


def test_移除仍保护原警告输入且旧scope缺省字段逆序恢复():
    async def check(factory):
        async with factory() as s:
            p,n,d=await seed(s);eid=d['assignments'][0]['entityId']
            legacy=copy.deepcopy(d);legacy.pop('textWarnings');legacy['key']=uuid4().hex
            old=await apply_scope_decision(s,legacy);assert 'text_warnings' not in old['scopes'][0]
            add=await request(s,p,[eid],key=uuid4().hex);add['textWarnings']=d['textWarnings'];await apply_scope_decision(s,add)
            omitted=await request(s,p,[eid],key=uuid4().hex)
            with pytest.raises(ValueError,match='完整列出'):await apply_scope_decision(s,omitted)
            remove=await request(s,p,[eid],key=uuid4().hex);remove['textWarnings']=[];await apply_scope_decision(s,remove)
            raw=copy.deepcopy(n.img_analysis);n.img_analysis=[{'text_content':'原文变化'}];await s.flush()
            with pytest.raises(ValueError,match='后续'):await rollback_decision(s,remove['key'])
            n.img_analysis=raw;await s.flush();await rollback_decision(s,remove['key']);await rollback_decision(s,add['key'])
            restored=await s.scalar(select(PlaceIdentityScope).where(PlaceIdentityScope.place_id==p.id).execution_options(populate_existing=True))
            assert restored.text_warnings is None
            await rollback_decision(s,legacy['key'])
    run(check)


def test_新增可空列迁移幂等且不改旧scope内容():
    from scripts.migrate_place_identity import migrate
    async def check(factory):
        async with factory() as s:
            p,n,d=await seed(s);d.pop('textWarnings');await apply_scope_decision(s,d);await s.commit()
        async with factory() as s:
            conn=await s.connection()
            before=(await s.execute(text("SELECT to_jsonb(s)-'text_warnings' FROM place_identity_scope s ORDER BY place_id"))).scalars().all()
            await s.execute(text('ALTER TABLE place_identity_scope DROP COLUMN text_warnings'))
            preview=await migrate(conn,False);assert preview['missingColumns']==['place_identity_scope.text_warnings']
            await migrate(conn,True);assert (await migrate(conn,True))['missingColumns']==[]
            after=(await s.execute(text("SELECT to_jsonb(s)-'text_warnings' FROM place_identity_scope s ORDER BY place_id"))).scalars().all()
            assert before==after
            assert not (await s.execute(text('SELECT count(*) FROM place_identity_scope WHERE text_warnings IS NOT NULL'))).scalar_one()
            await s.rollback()
    run(check)


def test_合法实体合并后警告沿现行根保留并可逆():
    async def check(factory):
        async with factory() as s:
            p,n,d=await seed(s);old_id=d['assignments'][0]['entityId'];await apply_scope_decision(s,d)
            other=CanonicalPlace(city=p.city,name='甲老街',normalized_name='甲老街',place_type='other')
            s.add(other);await s.flush();await bootstrap(s,p.city)
            cat=await load_catalog(s,p.city);new_id=cat.resolve(place_id=other.id)['entity_id']
            merge={'key':uuid4().hex,'city':p.city,'entityId':new_id,'mergeEntityIds':[old_id],
                'canonicalName':'甲老街','aliases':['甲街','甲老街'],'overrides':{},
                'expectedRevisions':{new_id:cat.entities[new_id]['revision'],old_id:cat.entities[old_id]['revision']},
                'evidence':[{'kind':'test_same_entity','quote':'甲街是甲老街的别称'}]}
            await apply_decision(s,merge);merged=await load_mention_catalog(s,p.city)
            rows=await load_mention_rows(s,p.city)
            payload,evidence=scoped_facts(merged.catalog.entities[new_id],rows,'',[],mention_catalog=merged)
            assert payload['tips']==[QUOTE] and any(e['content']==QUOTE for e in evidence)
            await rollback_decision(s,merge['key'])
            restored=await load_mention_catalog(s,p.city)
            assert restored.text_warnings_for(old_id)[0]['quote']==QUOTE
    run(check)
