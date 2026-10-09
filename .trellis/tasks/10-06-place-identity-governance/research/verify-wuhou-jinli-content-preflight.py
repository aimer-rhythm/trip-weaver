"""真实冻结资料的内存预演：网页绑定和静态组合名称；不创建业务决定。"""
from pathlib import Path
from datetime import datetime, timezone
import asyncio
import copy
import hashlib
import json
import sys

sys.dont_write_bytecode = True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, 'D:/Project/xhs-travel-pipeline')
from sqlalchemy import text
from app.db import SessionFactory, engine
from app.aggregate.mention_identity import load_mention_catalog, load_mention_rows
from app.clean.scoped_place_export import scoped_facts, scoped_binding
from app.clean.place_export import consolidate_places

root = Path(__file__).resolve().parent
target = root / 'priority-cities/成都/wuhou-jinli-content-preflight-01.json'


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


async def main():
    assert not target.exists()
    packet = json.loads((root / 'priority-cities/成都/wuhou-jinli-source-01.json').read_text(encoding='utf-8'))
    exported = json.loads((root / 'all-cities/batch-69/sync-01/xhs-places-成都.json').read_text(encoding='utf-8'))['places']
    wuhou_id, jinli_id = '300d2ae16b4e2787a84d7661a06f580e', '8a433260acdd259716088f8009e0fbdc'
    try:
        async with SessionFactory() as session:
            await session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            catalog = await load_mention_catalog(session, '成都')
            rows = await load_mention_rows(session, '成都')
            for entity in packet['catalog']['entities']:
                assert catalog.catalog.entities[entity['entity_id']] == entity
                assert catalog.scope_for_source(entity['primary_place_id']) is None
            mids = set(next(g['mentionIds'] for g in packet['groups'] if g['entity']['entity_id'] == wuhou_id))
            wrows = [r for r in rows if r['id'] in mids]
            assert len(wrows) == 26
            old = next(p for p in exported if p['id'] == wuhou_id)['payload']['content']
            known_names = [e['canonical_name'] for e in catalog.catalog.entities.values()]
            unbound, _ = scoped_facts(catalog.catalog.entities[wuhou_id], wrows, '2026-10-09T00:00:00Z', known_names, profile=old)
            assert old.get('identityBinding') is None
            assert len(old['highlights']) == 3 and all(h['basis'] == 'web' for h in old['highlights'])
            assert unbound['content'] != old
            bound = copy.deepcopy(old)
            bound['identityBinding'] = scoped_binding(catalog.catalog.entities[wuhou_id], wrows)
            hypothetically_bound, _ = scoped_facts(catalog.catalog.entities[wuhou_id], wrows, '2026-10-09T00:00:00Z', known_names, profile=bound)
            assert hypothetically_bound['content'] == old
            frozen_jinli = next(p for p in exported if p['id'] == jinli_id)
            hypothetical_catalog = copy.deepcopy(catalog.catalog)
            entity = hypothetical_catalog.entities[jinli_id]
            entity['aliases'] = [n for n in entity['aliases'] if n != '锦里古街主巷']
            entity['overrides']['identityExcludedNames'] = ['锦里古街主巷']
            before_contract = hypothetical_catalog.contract(entity)
            assert '锦里古街主巷' not in before_contract['memberNames']
            incoming = copy.deepcopy(frozen_jinli)
            incoming['sourcePlaceId'] = 1689
            # 假设受控输入，仅证明导出再次补名；不是已经审核的scope。
            incoming['payload']['mentionSources'] = []
            consolidated = consolidate_places([incoming], '成都', '2026-10-09T00:00:00Z', hypothetical_catalog)[0]
            assert '锦里古街主巷' in consolidated['payload']['identity']['memberNames']
            assert consolidated['payload']['components'] == []
            report = {'capturedAt': datetime.now(timezone.utc).isoformat(), 'readOnly': True,
                      'entityBatch': 69, 'hypotheticalInputsOnly': True, 'businessScopeApplied': False,
                      'wuhou': {'currentRevision': 1, 'mentionsUsedInHypothesis': 26,
                                'oldContentSha256': digest(old), 'webHighlights': 3,
                                'unboundProfileReplaced': True, 'explicitBindingPreservesExactContentInMemory': True,
                                'unboundContentSha256': digest(unbound['content']),
                                'profileBindingIsNotReviewedOrWritten': True},
                      'jinli': {'currentRevision': 1, 'name': '锦里', 'excludedName': '锦里古街主巷',
                                'contractContainsSubarea': False, 'consolidatedContainsSubarea': True,
                                'components': 0, 'staticPlanningReintroducesName': True},
                      'assignments': len(catalog.assignments), 'imagesViewed': 0, 'failures': []}
            with target.open('x', encoding='utf-8') as out:
                json.dump(report, out, ensure_ascii=False, indent=2)
                out.write('\n')
        print(json.dumps({'file': str(target.relative_to(root)), 'profileLossReproduced': True,
                          'staticPlanningNameReintroductionReproduced': True, 'businessScopeApplied': False}, ensure_ascii=False))
    finally:
        await engine.dispose()


asyncio.run(main())
