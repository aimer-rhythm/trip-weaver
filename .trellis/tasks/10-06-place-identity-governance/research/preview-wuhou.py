"""第71批真实来源SQL重建，核对网页/原评价保全与完整逆序回滚；仅隔离库。"""
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
root = Path(__file__).resolve().parent
sys.path.insert(0, 'D:/Project/xhs-travel-pipeline')
import app
app.__path__.insert(0, str(root / 'upstream/app'))
for name in ['aggregate', 'clean']:
    package = __import__('app.' + name, fromlist=['_'])
    package.__path__.insert(0, str(root / 'upstream/app' / name))
import scripts
scripts.__path__ = [str(root / 'upstream/scripts'), *scripts.__path__]
from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from app.models import Base, CanonicalPlace, PlaceEntity, PlaceEntityMember, PlaceMention, PlaceSummary, RawNote
from app.aggregate.place_identity import ENTITY_FIELDS, load_catalog, rollback_decision
from app.aggregate.mention_identity import apply_scope_decision, load_mention_rows, load_mention_catalog
from app.clean.mention_identity import MENTION_FIELDS, mention_fingerprint
from scripts import export_to_tripweaver as exporter

eid = '300d2ae16b4e2787a84d7661a06f580e'


def read(path):
    return json.loads((root / path).read_text(encoding='utf-8'))


def stable(place):
    value = copy.deepcopy(place)
    value['payload'].get('content', {}).pop('compiledAt', None)
    return value


async def main():
    assert hashlib.sha256((root / 'all-cities/batch-71-source.json').read_bytes()).hexdigest() == '1a4ca706c00f6e535baa4b8b9ecee1859a2e272b669eddf8b60772791327bc2f'
    frozen, decisions = read('all-cities/batch-71-source.json'), read('all-cities/batch-71-scope-decisions.json')
    database = os.environ['IDENTITY_TEST_DATABASE_URL']
    assert re.fullmatch(r'postgresql\+asyncpg://postgres@127\.0\.0\.1:18798/place_identity_test_\d+', database)
    engine = create_async_engine(database)
    factory = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    folder = root / 'all-cities/batch-71' / f'scope-preview-{time.time_ns()}'
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
                session.add(PlaceSummary(**source['summary']))
            for e in frozen['catalog']['entities']:
                await session.execute(insert(PlaceEntity).values(**{k: e[k] for k in ENTITY_FIELDS}))
            for m in frozen['catalog']['members']:
                await session.execute(insert(PlaceEntityMember).values(**m))
            for m in frozen['mentions']:
                session.add(PlaceMention(**{k: m[k] for k in MENTION_FIELDS}))
            await session.commit()
        exporter.SessionFactory = factory

        async def export(name):
            target = folder / name
            sys.argv = ['export_to_tripweaver.py', '--city', '成都', '--out', str(target)]
            await exporter.main()
            return json.loads(target.read_text(encoding='utf-8'))

        before = await export('xhs-places-before.json')
        assert len(before['places']) == 1
        old = before['places'][0]
        baseline = next(p for p in read('all-cities/batch-70/sync-01/xhs-places-成都.json')['places'] if p['id'] == eid)
        # 局部重建未含所有城内图片文字，旧营业/提示可不同；profile及旧原观点须完全一致。
        assert old['payload']['content'] == baseline['payload']['content']
        for k in ['name', 'id', 'category', 'lat', 'lng']: assert old[k] == baseline[k]
        assert old['payload']['typicalVisitMinutes'] == baseline['payload']['typicalVisitMinutes'] == 150
        async with factory() as session:
            original = copy.deepcopy(await load_mention_rows(session, '成都'))
            original_catalog = await load_catalog(session, '成都')
            assert {m['id']: mention_fingerprint(m) for m in original} == {m['id']: m['inputHash'] for m in frozen['mentions']}
            for decision in decisions:
                result = await apply_scope_decision(session, decision)
                assert result == await apply_scope_decision(session, decision)
            catalog = await load_mention_catalog(session, '成都')
            assert len(catalog.assignments) == 26 and len(catalog.scopes) == 1
            assert all(catalog.resolve(m)['status'] == 'resolved' for m in original)
            assert original == await load_mention_rows(session, '成都')
            profile = (await session.get(CanonicalPlace, 1688)).content_profile
            assert profile['identityBinding']['entityId'] == eid and profile['identityBinding']['revision'] == 2
            assert {k: v for k, v in profile.items() if k != 'identityBinding'} == old['payload']['content']
            await session.commit()
        after = await export('xhs-places-成都.json')
        assert len(after['places']) == 1
        current = after['places'][0]
        p = current['payload']
        assert p['identity']['revision'] == 2
        assert p['identity']['memberIds'] == old['payload']['identity']['memberIds']
        assert p['identity']['memberNames'] == old['payload']['identity']['memberNames']
        assert p['aliases'] == old['payload']['aliases']
        assert p['content'] == old['payload']['content'] == baseline['payload']['content']
        assert len(p['content']['highlights']) == 3 and all(h['basis'] == 'web' for h in p['content']['highlights'])
        assert p['imageIdentity']['approved'] == []
        for k in ['name', 'id', 'lat', 'lng', 'verified', 'category']: assert current[k] == old[k]
        for k in ['address', 'adcode', 'xhsPlaceType']: assert p.get(k) == old['payload'].get(k)
        assert 'typicalVisitMinutes' not in p
        assert p['reservation'] == 'unknown'
        rows = sorted(frozen['mentions'], key=lambda m: (-m['confidence'], m['id']))
        expected = [{'kind': 'xhs_warning' if m['mention_type'] == 'warning' else 'xhs_reason', 'content': m['reason'], 'sourceUrl': m['source_url']}
            for m in rows if m['id'] != 3818 and m['reason']]
        notes = {n['id']: n for n in frozen['noteDetails']}
        expected.extend({'kind': 'xhs_warning', 'content': w['quote'], 'sourceUrl': notes[w['noteId']]['sourceUrl']} for w in decisions[0]['textWarnings'])
        assert current['evidence'] == expected
        old_opinions = [e for e in baseline['evidence'] if e['kind'] in ['xhs_reason', 'xhs_warning']]
        assert len(old_opinions) == 6 and all(e in current['evidence'] for e in old_opinions)
        negatives = [m for m in rows if m['id'] in [3500, 3938, 4062, 4172]]
        assert len(negatives) == 4 and all(any(e['content'] == m['reason'] for e in current['evidence']) for m in negatives)
        historical = next(m for m in rows if m['id'] == 4117)
        assert any(e['content'] == historical['reason'] for e in current['evidence'])
        assert '9.10‑9.20' in historical['note_desc'] and '教师资格证原件' in historical['note_desc']
        assert p['tips'] == [w['quote'] for w in decisions[0]['textWarnings']]
        assert sorted(m['mentionId'] for m in p['mentionSources']) == sorted(m['id'] for m in rows)
        assert '人文古迹片区，周边生活气息浓' not in json.dumps(current, ensure_ascii=False)
        async with factory() as session:
            for decision in reversed(decisions): await rollback_decision(session, decision['key'])
            restored_catalog = await load_catalog(session, '成都')
            assert original_catalog.entities == restored_catalog.entities and original_catalog.members == restored_catalog.members
            assert original == await load_mention_rows(session, '成都')
            assert not (await load_mention_catalog(session, '成都')).scopes
            for source in frozen['sources']:
                actual = await session.get(CanonicalPlace, source['source']['id'])
                values = {**source['source'], **source['derivedBefore'], **source['supplement']}
                assert {k: getattr(actual, k) for k in values} == values
            for n in frozen['noteDetails']:
                actual = await session.get(RawNote, n['id'])
                assert (actual.title, actual.desc, actual.img_analysis, actual.created_at.isoformat(), actual.publish_time.isoformat() if actual.publish_time else None) == (n['title'], n['desc'], n['images'], n['observedAt'], n['publishedAt'])
            await session.commit()
        restored = await export('xhs-places-restored.json')
        assert [stable(p) for p in restored['places']] == [stable(p) for p in before['places']]
        report = {'batch': 71, 'isolated': True, 'synthetic': False, 'partialCityReconstruction': True,
            'sources': 1, 'mentions': 26, 'fullNotes': 27, 'scopeChanges': 1, 'assignmentChanges': 26, 'confirmed': 26, 'pending': 0,
            'newEntities': 0, 'withdrawals': 0, 'textWarnings': 1, 'currentEvidence': len(current['evidence']),
            'oldOpinionEvidencePreserved': 6, 'originalNegativeOpinionsPreserved': 4, 'webHighlightsAndDatesPreserved': 3,
            'entireWebProfilePreserved': True, 'profileBindingAuditedWithScope': True, 'areaDescriptionRemoved': True,
            'groupDurationRemoved': True, 'independentDurationUnknown': True, 'historicalTeacherConditionsPreserved': True,
            'idempotent': True, 'reverseRollback': True, 'originalSourcesAndMentionsUnchanged': True,
            'sourceDatesAndAnalysisUnchanged': True, 'imageComparison': 'deferred_by_user', 'fullReviewPassed': False, 'failures': []}
        with (folder / 'report.json').open('x', encoding='utf-8') as out:
            json.dump(report, out, ensure_ascii=False, indent=2)
            out.write('\n')
        print(json.dumps({'folder': str(folder.relative_to(root)), **report}, ensure_ascii=False))
    finally:
        await engine.dispose()


asyncio.run(main())
