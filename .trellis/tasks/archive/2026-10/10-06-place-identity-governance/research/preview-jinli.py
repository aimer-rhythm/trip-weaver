"""第70批真实两源重建，验证锦里范围/原评价与武侯祠保全；只写隔离库。"""
from pathlib import Path
from datetime import datetime
import asyncio
import copy
import hashlib
import json
import os
import re
import sys
import time

sys.dont_write_bytecode = True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, 'D:/Project/xhs-travel-pipeline')
from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from app.models import Base, CanonicalPlace, PlaceEntity, PlaceEntityMember, PlaceEntityReview, PlaceMention, PlaceSummary, RawNote
from app.aggregate.place_identity import ENTITY_FIELDS, apply_decision, load_catalog, rollback_decision
from app.aggregate.mention_identity import apply_scope_decision, load_mention_rows, load_mention_catalog
from app.clean.mention_identity import MENTION_FIELDS, mention_fingerprint
from app.clean.identity import legacy_id
from scripts import export_to_tripweaver as exporter

root = Path(__file__).resolve().parent
eid = '8a433260acdd259716088f8009e0fbdc'
wuhou_id = '300d2ae16b4e2787a84d7661a06f580e'


def read(p):
    return json.loads((root/p).read_text(encoding='utf-8'))


def stable(p):
    value = copy.deepcopy(p)
    value['payload'].get('content', {}).pop('compiledAt', None)
    return value


async def main():
    assert hashlib.sha256((root/'all-cities/batch-70-source.json').read_bytes()).hexdigest() == '21f57b6b992060060171b5f474872c968443148fc616e62ba79e155386b2c597'
    frozen = read('all-cities/batch-70-source.json')
    scopes, decisions = read('all-cities/batch-70-scope-decisions.json'), read('all-cities/batch-70-decisions.json')
    database = os.environ['IDENTITY_TEST_DATABASE_URL']
    assert re.fullmatch(r'postgresql\+asyncpg://postgres@127\.0\.0\.1:18798/place_identity_test_\d+', database)
    engine = create_async_engine(database)
    factory = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    folder = root/'all-cities/batch-70'/f'scope-preview-{time.time_ns()}'
    folder.mkdir(parents=True, exist_ok=False)
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with factory() as session:
            for n in frozen['noteDetails']:
                session.add(RawNote(id=n['id'], note_id=f"frozen-{n['id']}", city=n['city'], keyword='实城冻结', title=n['title'], desc=n['desc'],
                    img_analysis=n['images'], source_url=n['sourceUrl'], status=n['status'], created_at=datetime.fromisoformat(n['observedAt']),
                    publish_time=datetime.fromisoformat(n['publishedAt']) if n['publishedAt'] else None))
            await session.flush()
            for source in frozen['sources']:
                await session.execute(insert(CanonicalPlace).values(**source['source'], **source['derivedBefore'], **source['supplement']))
                if source['summary']:
                    session.add(PlaceSummary(**source['summary']))
            for e in frozen['catalog']['entities']:
                await session.execute(insert(PlaceEntity).values(**{k:e[k] for k in ENTITY_FIELDS}))
            for m in frozen['catalog']['members']:
                await session.execute(insert(PlaceEntityMember).values(**m))
            for r in frozen['catalog']['reviews']:
                await session.execute(insert(PlaceEntityReview).values(**r))
            for m in frozen['mentions']:
                session.add(PlaceMention(**{k:m[k] for k in MENTION_FIELDS}))
            await session.commit()
        exporter.SessionFactory = factory

        async def export(name):
            target = folder/name
            sys.argv = ['export_to_tripweaver.py', '--city', '成都', '--out', str(target)]
            await exporter.main()
            return json.loads(target.read_text(encoding='utf-8'))

        before = await export('xhs-places-before.json')
        assert len(before['places']) == 2
        async with factory() as session:
            original = copy.deepcopy(await load_mention_rows(session, '成都'))
            original_catalog = await load_catalog(session, '成都')
            assert {m['id']:mention_fingerprint(m) for m in original} == {m['id']:m['inputHash'] for m in frozen['mentions']}
            for decision in scopes:
                result = await apply_scope_decision(session, decision)
                assert result == await apply_scope_decision(session, decision)
            for decision in decisions:
                result = await apply_decision(session, decision)
                assert result == await apply_decision(session, decision)
            catalog = await load_mention_catalog(session, '成都')
            assert len(catalog.assignments) == 17 and len(catalog.scopes) == 1
            assert original == await load_mention_rows(session, '成都')
            pending = catalog.resolve(next(m for m in original if m['id'] == 3702))
            assert pending['status'] == 'review' and not pending.get('entity')
            assert catalog.catalog.resolve('锦里古街主巷') is None
            assert catalog.catalog.entities[wuhou_id] == original_catalog.entities[wuhou_id]
            assert len((await session.scalars(select(PlaceEntityReview))).all()) == 1
            await session.commit()
        after = await export('xhs-places-成都.json')
        assert len(after['places']) == 2
        old = next(p for p in before['places'] if p['id'] == eid)
        current = next(p for p in after['places'] if p['id'] == eid)
        assert stable(next(p for p in before['places'] if p['id'] == wuhou_id)) == stable(next(p for p in after['places'] if p['id'] == wuhou_id))
        p = current['payload']
        assert p['identity']['revision'] == 3 and p['identity']['memberNames'] == ['锦里', '锦里古街']
        assert p['identity']['kind'] == 'complex' and p['components'] == []
        assert set(p['identity']['memberIds']) == {*old['payload']['identity']['memberIds'], legacy_id('成都', '锦里古街')}
        assert p['aliases'] == old['payload']['aliases']
        assert p['imageIdentity']['approved'] == []
        assert p['xhsPlaceType'] == 'market' and current['category'] == '文化'
        for key in ['name', 'id', 'lat', 'lng', 'verified']:
            assert current[key] == old[key]
        for key in ['address', 'adcode']:
            assert p.get(key) == old['payload'].get(key)
        assert 'typicalVisitMinutes' not in p and 'typicalVisitMinutes' not in old['payload']
        assert p['reservation'] == 'unknown' and 'openHours' not in p
        rows = [m for m in frozen['mentions'] if m['id'] in {a['mentionId'] for a in scopes[0]['assignments']} and m['id'] != 3702]
        rows.sort(key=lambda m:(-m['confidence'],m['id']))
        expected_evidence = [{'kind':'xhs_warning' if m['mention_type']=='warning' else 'xhs_reason', 'content':m['reason'], 'sourceUrl':m['source_url']}
                             for m in rows if m['id'] != 3822]
        notes = {n['id']:n for n in frozen['noteDetails']}
        expected_evidence.extend({'kind':'xhs_warning','content':w['quote'],'sourceUrl':notes[w['noteId']]['sourceUrl']} for w in scopes[0]['textWarnings'])
        assert current['evidence'] == expected_evidence and len(expected_evidence) == 18
        assert p['tips'] == [w['quote'] for w in scopes[0]['textWarnings']]
        old_opinions = [e for e in old['evidence'] if e['kind'] in ['xhs_reason','xhs_warning']]
        assert len(old_opinions) == 6 and all(e in current['evidence'] for e in old_opinions)
        old_valid_highlights = [h for h in old['payload']['content']['highlights'] if h['text'] != '古镇风街区，适合与草堂玉林路串联游玩']
        assert len(old_valid_highlights) == 3 and all(h in p['content']['highlights'] for h in old_valid_highlights)
        assert '古镇风街区' not in json.dumps(p['content'], ensure_ascii=False)
        assert sorted(m['mentionId'] for m in p['mentionSources']) == sorted(m['id'] for m in rows)
        assert len([e for e in current['evidence'] if e['kind']=='xhs_warning']) == 10
        async with factory() as session:
            for decision in reversed([*scopes, *decisions]):
                await rollback_decision(session, decision['key'])
            restored_catalog = await load_catalog(session, '成都')
            assert original_catalog.entities == restored_catalog.entities and original_catalog.members == restored_catalog.members
            assert original == await load_mention_rows(session, '成都')
            assert not (await session.scalars(select(PlaceEntityReview))).all()
            for source in frozen['sources']:
                actual = await session.get(CanonicalPlace, source['source']['id'])
                values = {**source['source'], **source['derivedBefore'], **source['supplement']}
                assert {k:getattr(actual,k) for k in values} == values
            for n in frozen['noteDetails']:
                actual = await session.get(RawNote, n['id'])
                assert (actual.title,actual.desc,actual.img_analysis,actual.created_at.isoformat(),actual.publish_time.isoformat() if actual.publish_time else None) == (n['title'],n['desc'],n['images'],n['observedAt'],n['publishedAt'])
            await session.commit()
        restored = await export('xhs-places-restored.json')
        assert [stable(p) for p in restored['places']] == [stable(p) for p in before['places']]
        report = {'batch':70,'isolated':True,'synthetic':False,'partialCityReconstruction':True,
                  'sources':2,'mentions':43,'fullNotes':28,'scopeChanges':1,'typeChanges':1,'assignmentChanges':17,
                  'confirmed':16,'pending':1,'newEntities':0,'withdrawals':0,'textWarnings':3,'currentEvidence':18,
                  'oldOpinionEvidencePreserved':6,'oldValidHighlightsAndDatesPreserved':3,'wrongAreaHighlightRemoved':1,
                  'allOriginalWarningsPreserved':7,'totalWarningEvidence':10,'noTravelInclusiveDurationAdded':True,
                  'wuhouAllConsumedFieldsPreserved':True,'parentHasNoUnreviewedSubareaNames':True,
                  'idempotent':True,'reverseRollback':True,'originalSourcesAndMentionsUnchanged':True,
                  'sourceDatesAndAnalysisUnchanged':True,'imageComparison':'deferred_by_user','fullReviewPassed':False,'failures':[]}
        with (folder/'report.json').open('x',encoding='utf-8') as handle:
            json.dump(report,handle,ensure_ascii=False,indent=2)
            handle.write('\n')
        print(json.dumps({'folder':str(folder.relative_to(root)),**report},ensure_ascii=False))
    finally:
        await engine.dispose()


asyncio.run(main())
