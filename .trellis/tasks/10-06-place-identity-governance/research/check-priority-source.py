"""批次后只读核对重点冻结原源、原文提及及本批实体版本，不输出笔记或凭据。"""
from pathlib import Path
import argparse
import asyncio
import hashlib
import json
import re
import sys
from datetime import datetime, timezone
sys.dont_write_bytecode = True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, 'D:/Project/xhs-travel-pipeline')
from sqlalchemy import select, text
from app.db import SessionFactory, engine
from app.models import CanonicalPlace
from app.aggregate.mention_identity import load_mention_catalog, load_mention_rows, source_input
from app.aggregate.place_identity import load_catalog
from app.clean.mention_identity import mention_fingerprint, source_fingerprint
root = Path(__file__).resolve().parent

async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True)
    parser.add_argument('--batch', required=True)
    args = parser.parse_args()
    assert re.fullmatch(r'batch-\d{2}(?:-v\d+)?', args.batch)
    path = (root / args.source).resolve()
    assert path.is_relative_to(root)
    raw = path.read_bytes()
    frozen = json.loads(raw)
    manifest = json.loads(path.with_name('manifest.json').read_text(encoding='utf-8'))
    assert hashlib.sha256(raw).hexdigest() == manifest['sha256']
    city = frozen['city']
    pointer = json.loads((root / 'cleaning-scope/current.json').read_text(encoding='utf-8'))
    assert city not in pointer['policy'].get('excludedCities', [])
    decisions = json.loads((root / f'all-cities/{args.batch}-decisions.json').read_text(encoding='utf-8'))
    scopes_path = root / f'all-cities/{args.batch}-scope-decisions.json'
    scopes = json.loads(scopes_path.read_text(encoding='utf-8')) if scopes_path.exists() else []
    assert decisions or scopes, '不可用空批次冒充治理验证'
    assert all(d['city'] == city for d in [*decisions, *scopes])
    applied = json.loads((root / f'all-cities/{args.batch}-applied.json').read_text(encoding='utf-8'))
    assert applied['apply'] is True
    # 同批scope先分配提及、实体决定再补类别时，一个主体会连续升版。
    # 校验每个已应用中间快照与版本衔接，最终再比实库；不能要求终态等于每一步的+1。
    steps = [*scopes, *decisions]
    assert len(applied['changes']) == len(steps)
    final_revisions = {}
    for decision, change in zip(steps, applied['changes']):
        entities = {entity['entity_id']:entity for entity in change['entities']}
        assert set(entities) == set(decision['expectedRevisions'])
        for eid, revision in decision['expectedRevisions'].items():
            assert revision == final_revisions.get(eid, revision), (eid, '同批版本链不连续')
            assert entities[eid]['revision'] == revision + 1, (eid, '应用快照版本错误')
            final_revisions[eid] = revision + 1
    target = root / f'all-cities/{args.batch}-upstream-check.json'
    assert not target.exists()
    try:
        async with SessionFactory() as session:
            await session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            sources = {p.id:p for p in (await session.scalars(select(CanonicalPlace).where(CanonicalPlace.city==city))).all()}
            for original in frozen['sources']:
                current = sources[original['id']]
                assert source_fingerprint(source_input(current)) == original['sourceHash']
                for key in ['name','normalized_name','city','address','latitude','longitude','place_type','geo_status','amap_poi_id','is_active','quality_score']:
                    assert getattr(current,key) == original[key], (original['id'],key)
            mentions = {m['id']:m for m in await load_mention_rows(session,city)}
            for original in frozen['mentions']:
                assert mention_fingerprint(mentions[original['id']]) == original['inputHash'], original['id']
            catalog = await load_catalog(session,city)
            for eid, revision in final_revisions.items():
                assert catalog.entities[eid]['revision'] == revision, (eid, '实库版本偏离批次终态')
            mention_catalog = await load_mention_catalog(session,city,catalog)
            checked_assignments = 0
            excluded_mentions = 0
            fact_exclusions = 0
            for decision in scopes:
                scope = mention_catalog.scopes[decision['sourcePlaceId']]
                assert scope['revision'] == decision['expectedScopeRevision'] + 1
                assert scope['change_key'] == decision['key'] and scope['source_valid']
                assignments = {a['mention_id']:a for a in mention_catalog.assignments.values()
                    if a['scope_place_id'] == decision['sourcePlaceId']}
                assert set(assignments) == {a['mentionId'] for a in decision['assignments']}
                for expected in decision['assignments']:
                    assignment = assignments[expected['mentionId']]
                    assert assignment['change_key'] == decision['key']
                    assert assignment['input_hash'] == expected['inputHash']
                    assert assignment['entity_id'] == expected['entityId']
                    assert assignment.get('exclusion') == expected.get('exclusion')
                    assert assignment.get('fact_exclusions') == expected.get('factExclusions')
                    if expected.get('factExclusions') is not None:
                        result = mention_catalog.resolve(mentions[expected['mentionId']])
                        assert result['status'] == 'resolved' and result['entity']['entity_id'] == expected['entityId']
                        assert result['factExclusions'] == expected['factExclusions']
                        fact_exclusions += 1
                    if expected.get('exclusion') is not None:
                        result = mention_catalog.resolve(mentions[expected['mentionId']])
                        assert result['status'] == 'excluded' and result['reason'] == 'reviewed_non_place'
                        excluded_mentions += 1
                    checked_assignments += 1
            for decision in decisions:
                entity = catalog.root(decision['entityId'])
                assert entity['entity_id'] == decision['entityId']
                assert entity['revision'] == final_revisions[entity['entity_id']]
                assert entity['canonical_name'] == decision['canonicalName']
                for key,value in decision['overrides'].items():
                    assert entity['overrides'][key] == value, (entity['entity_id'],key)
            report = {'readOnly':True,'capturedAt':datetime.now(timezone.utc).isoformat(),'batch':args.batch,'city':city,
                'sourceFile':args.source,'sourceSha256':manifest['sha256'],
                'rawSourcesUnchanged':len(frozen['sources']),'originalMentionsUnchanged':len(frozen['mentions']),
                'originalNotesCovered':len(frozen['notes']),'appliedEntitiesVerified':len(decisions),
                'appliedScopesVerified':len(scopes),'assignmentsVerified':checked_assignments,
                'finalEntityRevisions':final_revisions,
                'excludedMentionsVerified':excluded_mentions,'factExclusionsVerified':fact_exclusions,'failures':[]}
            with target.open('x',encoding='utf-8',newline='\n') as handle:
                handle.write(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
            print(json.dumps(report,ensure_ascii=False))
    finally:
        await engine.dispose()

asyncio.run(main())
