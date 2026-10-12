"""由冻结原始提及生成batch-24请求，不连接数据库、不执行应用。"""
from pathlib import Path
import hashlib
import json
import sys
sys.stdout.reconfigure(encoding='utf-8')
root = Path(__file__).resolve().parent
file = root/'scope-source-459-1791335308979279800.json'
snapshot = json.loads(file.read_text(encoding='utf-8'))
assert {row['id'] for row in snapshot['mentions']} == {534, 1119, 1615}
assert all(row['raw_note_id'] == 7 and row['evidence_text'] == '呼归石公交站对面' and not row['note_unavailable'] for row in snapshot['mentions'])
assert not snapshot['images'] and not snapshot['curatedImages']
assert all(value == 0 for value in snapshot['scopeTableCounts'].values())
sources = {row['id']: row for row in snapshot['sources']}
primary, old = sources[176]['entity'], sources[215]['entity']
assert primary['revision'] == 2 and old['revision'] == 1
evidence = [{'kind': 'reviewed_mention_scope', 'file': file.name, 'sha256': hashlib.sha256(file.read_bytes()).hexdigest(),
    'mentionIds': [534, 1119, 1615], 'reviewIds': [459], 'sourcePlaceIds': [176, 215],
    'conclusion': '三条原提及来自同一篇note7，原始证据均为呼归石公交站对面；534/1615错抽取丢失对面。逐条分给站外机位，排除公交站裸名，不声明公交站与站外机位永久同义。保留旧ID兼容正确名称，未来真实公交站提及仍须独立审核。'}]
versions = {primary['entity_id']: primary['revision'], old['entity_id']: old['revision']}
scopes = []
for source_id in [215, 176]:
    source = sources[source_id]
    affected = sorted({source['entity']['entity_id'], primary['entity_id']})
    rows = [row for row in snapshot['mentions'] if row['normalized_name'] == source['normalized_name']]
    scopes.append({'key': f'all-cities-20261007-batch-24-scope-{source_id}', 'city': '重庆', 'sourcePlaceId': source_id,
        'expectedSourceHash': source['sourceHash'], 'expectedScopeRevision': 0,
        'expectedRevisions': {eid: versions[eid] for eid in affected},
        'assignments': [{'mentionId': row['id'], 'inputHash': row['inputHash'], 'entityId': primary['entity_id']} for row in rows],
        'evidence': evidence})
    for eid in affected:
        versions[eid] += 1
decisions = [{'key': 'all-cities-20261007-batch-24-correct-459', 'city': '重庆', 'entityId': primary['entity_id'],
    'canonicalName': primary['canonical_name'], 'mergeEntityIds': [old['entity_id']], 'expectedRevisions': versions,
    'aliases': [primary['canonical_name']], 'excludeNames': [old['canonical_name']], 'overrides': primary['overrides'], 'evidence': evidence}]
out = root/'all-cities'
for suffix in ['scope-decisions', 'decisions', 'applied']:
    assert not (out/f'batch-24-{suffix}.json').exists(), f'不得覆盖{suffix}'
for suffix, value in [('scope-decisions', scopes), ('decisions', decisions)]:
    with (out/f'batch-24-{suffix}.json').open('x', encoding='utf-8') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
print(json.dumps({'batch': 'batch-24', 'scopes': len(scopes), 'mentions': 3, 'corrections': 1, 'expectedVersionsBeforeMerge': versions}, ensure_ascii=False))
