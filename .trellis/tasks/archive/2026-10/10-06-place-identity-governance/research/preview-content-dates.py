"""实城只读预演：使用真实来源和现行快照，禁止关系发布写入，不查看图片。"""
from pathlib import Path
import asyncio, copy, hashlib, json, sys
from datetime import datetime, timezone

sys.dont_write_bytecode = True
sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parent
ORIGINAL = Path('D:/Project/xhs-travel-pipeline')
sys.path.insert(0, str(ORIGINAL))
sys.path.insert(0, str(ORIGINAL / 'vendor/spider_xhs'))
import app
app.__path__.insert(0, str(ROOT / 'upstream/app'))
for package_name in ['clean', 'aggregate', 'photography', 'resolve', 'extract', 'qa']:
    package = __import__('app.' + package_name, fromlist=['_'])
    package.__path__.insert(0, str(ROOT / 'upstream/app' / package_name))
import scripts
scripts.__path__ = [str(ROOT / 'upstream/scripts'), *scripts.__path__]
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from app.config import settings
from app.models import CanonicalPlace, PlaceRelationSnapshot
from app.aggregate.mention_identity import load_mention_catalog, load_mention_rows
from app.clean.relation_snapshot import build_relation_snapshot
from scripts import export_to_tripweaver as exporter

def read(path):
    return json.loads((ROOT / path).read_text(encoding='utf-8'))

async def main():
    folder = ROOT / 'metadata/content-dates-01/preview'
    folder.mkdir(parents=True, exist_ok=False)
    pointer = read('cleaning-scope/current.json')
    assert pointer['latestAppliedEntityBatch'] == 50
    assert pointer['imageComparisonPolicy']['status'] == 'deferred_by_user'
    baseline = read('all-cities/batch-50/sync-01/xhs-places-济南.json')
    provenance = read('priority-cities/济南/vintage-timestamp-provenance-01.json')
    expected_changes = {(r['entityId'], r['highlightIndex']): r for r in provenance['rows']}
    engine = create_async_engine(settings.database_url, connect_args={'server_settings': {'default_transaction_read_only': 'on'}})
    factory = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    source_observations = []
    async def current_snapshot(session, city):
        assert city == '济南'
        assert (await session.execute(text('SHOW transaction_read_only'))).scalar_one() == 'on'
        previous = await session.scalar(select(PlaceRelationSnapshot).where(PlaceRelationSnapshot.city == city))
        cat = await load_mention_catalog(session, city)
        rows = await load_mention_rows(session, city)
        sources = (await session.execute(select(CanonicalPlace.name, CanonicalPlace.normalized_name).where(CanonicalPlace.city == city))).all()
        snapshot = build_relation_snapshot(cat, rows, extra_surfaces=[n for pair in sources for n in pair],
            min_mentions=previous.payload['sourceState']['minMentions'])
        for key in ['sourceHash', 'relationHash']:
            assert snapshot[key] == previous.payload[key] == baseline['relationIdentity'][key]
        snapshot['revision'] = previous.revision
        # 全部原提及（包括当前来源日期）和治理目录均纳入前后只读指纹。
        state = {'rows': rows, 'entities': cat.catalog.entities, 'members': cat.catalog.members,
            'scopes': cat.scopes, 'assignments': cat.assignments}
        digest = hashlib.sha256(json.dumps(state, ensure_ascii=False, sort_keys=True, default=str).encode()).hexdigest()
        source_observations.append({'hash': digest, 'mentions': len(rows), 'sources': len(sources), 'revision': previous.revision})
        return snapshot
    exporter.SessionFactory = factory
    exporter.publish_relation_snapshot = current_snapshot
    try:
        outputs = []
        for label in ['first', 'second']:
            output = folder / f'xhs-places-{label}.json'
            sys.argv = ['export_to_tripweaver.py', '--city', '济南', '--out', str(output)]
            await exporter.main()
            outputs.append(json.loads(output.read_text(encoding='utf-8')))
        old = {p['id']: p for p in baseline['places']}
        first, second = [{p['id']: p for p in d['places']} for d in outputs]
        assert set(old) == set(first) == set(second) and len(first) == 228
        changes = []
        for eid, new in first.items():
            expected = copy.deepcopy(old[eid])
            content, prior = new['payload'].get('content'), expected['payload'].get('content')
            if content:
                assert len(content['highlights']) == len(prior['highlights'])
                for index, highlight in enumerate(content['highlights']):
                    old_highlight = prior['highlights'][index]
                    if old_highlight['observedAt'] != highlight['observedAt']:
                        origin = expected_changes[(eid, index)]
                        assert old_highlight['observedAt'] == prior['compiledAt']
                        dates = {m['rawNoteCreatedAt'] for m in origin['matches']}
                        assert highlight['observedAt'] in dates
                        changes.append({'entityId': eid, 'name': new['name'], 'highlightIndex': index,
                            'beforeObservedAt': old_highlight['observedAt'], 'observedAt': highlight['observedAt'],
                            'matchingMentionIds': [m['mentionId'] for m in origin['matches'] if m['rawNoteCreatedAt'] == highlight['observedAt']]})
                        old_highlight['observedAt'] = highlight['observedAt']
                prior['compiledAt'] = content['compiledAt']
            assert expected == new, new['name']
            repeated = copy.deepcopy(new)
            if content:
                repeated['payload']['content']['compiledAt'] = second[eid]['payload']['content']['compiledAt']
            assert repeated == second[eid], new['name']
        assert {(r['entityId'], r['highlightIndex']) for r in changes} == set(expected_changes)
        assert source_observations[0] == source_observations[1]
        assert outputs[0]['relationIdentity'] == outputs[1]['relationIdentity'] == baseline['relationIdentity']
        report = {'metadataRun': 1, 'readOnly': True, 'at': datetime.now(timezone.utc).isoformat(), 'city': '济南',
            'productionCodeInstalled': False, 'businessWrites': False, 'fullCityPlaces': 228,
            'highlightsCorrected': len(changes), 'entitiesAffected': len({r['entityId'] for r in changes}),
            'repeatExportDatesStable': True, 'allOtherPlaceFieldsPreserved': True, 'relationManifestPreserved': True,
            'sourceObservations': source_observations,
            'publicationOverride': '只读重建关系并验证源/图哈希与现行发布快照相同，沿用revision；没有发布新快照或跳过匹配校验。',
            'changes': changes, 'imageComparison': 'deferred_by_user', 'failures': []}
        with (folder / 'report.json').open('x', encoding='utf-8') as file:
            json.dump(report, file, ensure_ascii=False, indent=2)
        print(json.dumps({k:v for k,v in report.items() if k != 'changes'}, ensure_ascii=False))
    finally:
        await engine.dispose()

asyncio.run(main())
