"""第67批真实资料隔离预演：仅四处位置字段变化，六源全文/评价/导出可回滚。"""
from pathlib import Path
from datetime import datetime
import asyncio, copy, hashlib, json, os, re, sys, time
sys.dont_write_bytecode = True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, 'D:/Project/xhs-travel-pipeline')
from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from app.models import Base, CanonicalPlace, PlaceEntity, PlaceEntityMember, PlaceEntityReview, PlaceMention, PlaceSummary, RawNote
from app.aggregate.place_identity import ENTITY_FIELDS, apply_decision, load_catalog, rollback_decision
from app.aggregate.mention_identity import load_mention_rows, load_mention_catalog
from app.clean.mention_identity import MENTION_FIELDS, mention_fingerprint
from scripts import export_to_tripweaver as exporter
root = Path(__file__).resolve().parent
def read(p): return json.loads((root/p).read_text(encoding='utf-8'))
assert hashlib.sha256((root/'all-cities/batch-67-source.json').read_bytes()).hexdigest() == 'f85b48254c11284f79314e1f88ffcfab5cbf321528d2a6535e0e7e8830c995bc'
frozen = read('all-cities/batch-67-source.json')
decisions = read('all-cities/batch-67-decisions.json')
def stable(p):
    p = copy.deepcopy(p)
    if p['payload'].get('content'): p['payload']['content'].pop('compiledAt', None)
    return p

async def main():
    database = os.environ['IDENTITY_TEST_DATABASE_URL']
    assert re.fullmatch(r'postgresql\+asyncpg://postgres@127\.0\.0\.1:18798/place_identity_test_\d+', database)
    engine = create_async_engine(database)
    factory = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    folder = root/'all-cities/batch-67'/f'position-preview-{time.time_ns()}'
    folder.mkdir(parents=True, exist_ok=False)
    try:
        async with engine.begin() as conn: await conn.run_sync(Base.metadata.create_all)
        async with factory() as s:
            for n in frozen['noteDetails']:
                s.add(RawNote(id=n['id'], note_id=f"frozen-{n['id']}", city=n['city'], keyword='实城冻结', title=n['title'], desc=n['desc'],
                    img_analysis=n['images'], source_url=n['sourceUrl'], status=n['status'], created_at=datetime.fromisoformat(n['observedAt']),
                    publish_time=datetime.fromisoformat(n['publishedAt']) if n['publishedAt'] else None))
            await s.flush()
            for source in frozen['sources']:
                await s.execute(insert(CanonicalPlace).values(**source['source'], **source['derivedBefore'], **source['supplement']))
                if source['summary']: s.add(PlaceSummary(**source['summary']))
            for e in frozen['catalog']['entities']: await s.execute(insert(PlaceEntity).values(**{k:e[k] for k in ENTITY_FIELDS}))
            for m in frozen['catalog']['members']: await s.execute(insert(PlaceEntityMember).values(**m))
            for r in frozen['catalog']['reviews']: await s.execute(insert(PlaceEntityReview).values(**r))
            for m in frozen['mentions']: s.add(PlaceMention(**{k:m[k] for k in MENTION_FIELDS}))
            await s.commit()
        exporter.SessionFactory = factory
        async def export(name):
            target = folder/name
            sys.argv = ['export_to_tripweaver.py', '--city', '成都', '--out', str(target)]
            await exporter.main()
            return json.loads(target.read_text(encoding='utf-8'))
        before = await export('xhs-places-before.json')
        assert len(before['places']) == 6
        async with factory() as s:
            original = copy.deepcopy(await load_mention_rows(s, '成都'))
            original_catalog = await load_catalog(s, '成都')
            assert {m['id']:mention_fingerprint(m) for m in original} == {m['id']:m['inputHash'] for m in frozen['mentions']}
            for d in decisions:
                result = await apply_decision(s, d)
                assert result == await apply_decision(s, d)
            catalog = await load_mention_catalog(s, '成都')
            assert not catalog.assignments and not catalog.scopes
            assert original == await load_mention_rows(s, '成都')
            assert not (await s.scalars(select(PlaceEntityReview))).all()
            await s.commit()
        after = await export('xhs-places-成都.json')
        assert len(after['places']) == 6
        results = []
        for p in after['places']:
            old = next(v for v in before['places'] if v['id'] == p['id'])
            d = next((d for d in decisions if d['entityId'] == p['id']), None)
            if d is None:
                assert stable(p) == stable(old)
                continue
            expected = stable(old)
            expected.update(lat=None, lng=None)
            expected['payload'].update(address=d['overrides']['address'], geoStatus='unresolvable', adcode='')
            expected['payload']['identity']['revision'] = 2
            assert stable(p) == expected, p['name']
            assert not p['payload'].get('mentionSources')
            results.append({'id':p['id'], 'name':p['name'], 'coordinatesCleared':True, 'adcodeCleared':True,
                'allNonLocationConsumptionPreserved':True, 'identityMembersPreserved':True})
        async with factory() as s:
            for d in reversed(decisions): await rollback_decision(s, d['key'])
            restored = await load_catalog(s, '成都')
            assert original_catalog.entities == restored.entities and original_catalog.members == restored.members
            assert original == await load_mention_rows(s, '成都')
            assert not (await s.scalars(select(PlaceEntityReview))).all()
            for source in frozen['sources']:
                p = await s.get(CanonicalPlace, source['source']['id'])
                values = {**source['source'], **source['derivedBefore'], **source['supplement']}
                assert {k:getattr(p,k) for k in values} == values
            for n in frozen['noteDetails']:
                actual = await s.get(RawNote, n['id'])
                assert (actual.title,actual.desc,actual.img_analysis,actual.created_at.isoformat(),actual.publish_time.isoformat()) == (n['title'],n['desc'],n['images'],n['observedAt'],n['publishedAt'])
            await s.commit()
        restored = await export('xhs-places-restored.json')
        assert [stable(p) for p in restored['places']] == [stable(p) for p in before['places']]
        report = {'batch':67, 'isolated':True, 'synthetic':False, 'partialCityReconstruction':True,
            'sources':6, 'mentions':12, 'fullNotes':5, 'entityChanges':4, 'scopeChanges':0, 'assignmentChanges':0,
            'newEntities':0, 'withdrawals':0, 'readOnlyParentAndBuildingPreserved':True,
            'idempotent':True, 'reverseRollback':True, 'originalSourcesAndMentionsUnchanged':True,
            'sourceDatesAndAnalysisUnchanged':True, 'results':results,
            'imageComparison':'deferred_by_user', 'fullReviewPassed':False, 'failures':[]}
        with (folder/'report.json').open('x', encoding='utf-8') as handle: json.dump(report,handle,ensure_ascii=False,indent=2)
        print(json.dumps({'folder':str(folder.relative_to(root)),**report},ensure_ascii=False))
    finally: await engine.dispose()

asyncio.run(main())
