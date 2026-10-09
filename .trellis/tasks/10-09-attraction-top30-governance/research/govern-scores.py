"""为冻结榜单中已核实的分数差异启用策略；不改来源分配。"""
import argparse
import asyncio
import hashlib
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.stdout.reconfigure(encoding='utf-8')
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, 'D:/Project/xhs-travel-pipeline')
from dotenv import dotenv_values
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from app.aggregate.place_identity import apply_decision, rollback_decision, load_catalog
from app.aggregate.mention_identity import load_mention_catalog, load_mention_rows
from app.clean.mention_identity import mention_fingerprint
from app.clean.recommendation import recommendation_metrics

ROOT = Path(__file__).resolve().parent
BATCH_ROOT = ROOT.parents[1] / '10-06-place-identity-governance/research/all-cities'


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--backfill-guozijian', action='store_true')
    args = parser.parse_args()
    batch = 76 if args.backfill_guozijian else 73
    expected_count = 1 if args.backfill_guozijian else 18
    snapshot_file = 'snapshot-20261009T113623767243Z/input.json' if args.backfill_guozijian else 'snapshot-20261009T083356944724Z/input.json'
    ranking_file = 'ranking-06.json' if args.backfill_guozijian else 'ranking-03.json'
    snapshot_bytes = (ROOT / snapshot_file).read_bytes()
    snapshot = json.loads(snapshot_bytes)
    ranking = json.loads((ROOT / ranking_file).read_bytes())
    assert hashlib.sha256(snapshot_bytes).hexdigest() == ranking['snapshotSha256']
    selected = [p for c in ranking['cities'] for p in c['top30'] if p['score'] != p['downstreamScore']]
    assert len(selected) == expected_count and all(not p['scopeIds'] and p['effectiveType'] == 'attraction' for p in selected)
    if args.backfill_guozijian:
        assert [p['entityId'] for p in selected] == ['0854db5911778c6722637d896e9c2904']
        assert selected[0]['score'] == 26.44 and selected[0]['mentionCount'] == 9
    decisions = [{'key': f'top30-20261009-batch-{batch}-score-' + p['entityId'], 'city': p['city'], 'entityId': p['entityId'],
        'canonicalName': p['name'], 'aliases': [p['name'], *p['aliases']], 'mergeEntityIds': [],
        'expectedRevisions': {p['entityId']: p['revision']}, 'overrides': {'recommendationPolicy': 'resolved_attraction_mentions_v1'},
        'evidence': [{'kind': 'resolved_identity_recommendation_score', 'file': str(ROOT / ranking_file),
            'snapshotSha256': ranking['snapshotSha256'], 'mentionIds': p['mentionIds'], 'scoreBefore': p['downstreamScore'],
            'scoreAfter': p['score'], 'conclusion': '仅修复本景点当前已解析提及的分数；未解析、活动和子项不按normalized_name补给母项；不表示来源语义全部审完。'}]}
        for p in selected]
    expectations = [{'city': p['city'], 'id': p['entityId'], 'name': p['name'], 'revision': p['revision'] + 1,
                     'verified': True, 'recommendScore': p['score'], 'mentionCount': p['mentionCount']} for p in selected]
    report_path = BATCH_ROOT / (f'batch-{batch}-applied.json' if args.apply else f'batch-{batch}-preview.json')
    assert not report_path.exists()
    for name, value in [(f'batch-{batch}-decisions.json', decisions), (f'batch-{batch}-export-expectations.json', expectations)]:
        file = BATCH_ROOT / name
        if args.apply:
            assert json.loads(file.read_bytes()) == value
        else:
            with file.open('x', encoding='utf-8') as out:
                json.dump(value, out, ensure_ascii=False, indent=2)
    if args.apply:
        preview = json.loads((BATCH_ROOT / f'batch-{batch}-preview.json').read_bytes())
        assert preview['checks']['reverseRollback'] and preview['checks']['idempotency']
    engine = create_async_engine(dotenv_values('D:/Project/xhs-travel-pipeline/.env')['DATABASE_URL'])
    report = {'apply': args.apply, 'cities': [{'city': c} for c in sorted({p['city'] for p in selected})], 'changes': [], 'checks': {}}
    try:
        async with async_sessionmaker(engine)() as session:
            await session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ'))
            await session.execute(text("SET LOCAL statement_timeout='30s'"))
            original = {}
            raw_before = (await session.execute(text("SELECT md5(string_agg(row_to_json(p)::text,'' ORDER BY id)) FROM canonical_place p WHERE city IN ('北京','济南')"))).scalar_one()
            for frozen in snapshot['cities']:
                city = frozen['city']
                catalog = await load_mention_catalog(session, city)
                original[city] = catalog.catalog
                assert catalog.catalog.entities == {e['entity_id']: e for e in frozen['entities']}
                rows = await load_mention_rows(session, city)
                assert {m['id']: mention_fingerprint(m) for m in rows} == {m['id']: m['inputHash'] for m in frozen['mentions']}
                for p in [p for p in selected if p['city'] == city]:
                    own = [m for m in rows if (catalog.resolve(m).get('entity') or {}).get('entity_id') == p['entityId']]
                    assert recommendation_metrics(own) == {'mentionCount': p['mentionCount'], 'recommendScore': p['score']}
                    assert sorted(m['id'] for m in own) == sorted(p['mentionIds'])
            for decision in decisions:
                after = await apply_decision(session, decision)
                report['changes'].append(after)
                if not args.apply:
                    assert await apply_decision(session, decision) == after
            for city, before in original.items():
                after = await load_catalog(session, city)
                changed_ids = {p['entityId'] for p in selected if p['city'] == city}
                assert {eid: e for eid, e in after.entities.items() if eid not in changed_ids} == {eid: e for eid, e in before.entities.items() if eid not in changed_ids}
            raw_after = (await session.execute(text("SELECT md5(string_agg(row_to_json(p)::text,'' ORDER BY id)) FROM canonical_place p WHERE city IN ('北京','济南')"))).scalar_one()
            assert raw_before == raw_after
            report['checks'].update({f'only{expected_count}SelectedAttractionsChanged': True, 'rawSourcesPreserved': True, 'resolvedMentionInputsUnchanged': True})
            if args.apply:
                assert report['changes'] == preview['changes']
                await session.commit()
            else:
                for decision in reversed(decisions):
                    await rollback_decision(session, decision['key'])
                for city, before in original.items():
                    after = await load_catalog(session, city)
                    assert after.entities == before.entities and after.members == before.members
                report['checks'].update({'idempotency': True, 'reverseRollback': True})
                await session.rollback()
        with report_path.open('x', encoding='utf-8') as out:
            json.dump(report, out, ensure_ascii=False, indent=2)
        print(json.dumps({'batch': batch, 'apply': args.apply, 'changes': len(report['changes']), 'checks': report['checks']}, ensure_ascii=False))
    finally:
        await engine.dispose()


if __name__ == '__main__':
    asyncio.run(main())
