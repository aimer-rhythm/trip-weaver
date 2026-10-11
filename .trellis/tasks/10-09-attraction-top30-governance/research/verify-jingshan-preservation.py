"""第78批首尾快照逐字段保全，明确仅新增名称scope及一条提及分配。"""
import copy
import hashlib
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parent
TARGET = '981bfe8125feb36e052dcfee1e0df8b5'
before = json.loads((ROOT / 'snapshot-20261009T130631744909Z/input.json').read_bytes())
raw = (ROOT / 'snapshot-20261009T134338341037Z/input.json').read_bytes()
after = json.loads(raw)
rank = json.loads((ROOT / 'ranking-09.json').read_bytes())
checks = {'snapshotMatchesRanking': rank['snapshotSha256'] == hashlib.sha256(raw).hexdigest(),
          'tripsUnchanged': before['tripsDigest'] == after['tripsDigest']}
changes = []
for prior, current in zip(before['cities'], after['cities']):
    city = prior['city']
    assert city == current['city']
    for field in ['sources', 'notes', 'members', 'reviews', 'summaries']:
        checks[f'{city}.{field}Unchanged'] = prior[field] == current[field]
    if city == '北京':
        checks['oneCorrectionScope'] = len(current['scopes']) == 1 and current['scopes'][0]['place_id'] == 1508 and current['scopes'][0]['mode'] == 'name_correction'
        checks['oneCorrectionAssignment'] = len(current['assignments']) == 1 and current['assignments'][0]['mention_id'] == 3148
        checks['twoAuditedChangesAdded'] = len(current['changes']) == len(prior['changes']) + 2 and current['changes'][:len(prior['changes'])] == prior['changes']
    else:
        checks['jinanScopeAndAuditsUnchanged'] = all(prior[f] == current[f] for f in ['scopes', 'assignments', 'changes'])
    old_entities = {e['entity_id']: e for e in prior['entities']}
    changed = [e['entity_id'] for e in current['entities'] if old_entities.get(e['entity_id']) != e]
    checks[f'{city}.expectedEntityChanges'] = changed == ([TARGET] if city == '北京' else [])
    checks[f'{city}.rawMentionInputsUnchanged'] = {m['id']: m['inputHash'] for m in prior['mentions']} == {m['id']: m['inputHash'] for m in current['mentions']}
    checks[f'{city}.mentionOwnersUnchanged'] = {m['id']: m['entityId'] for m in prior['mentions']} == {m['id']: m['entityId'] for m in current['mentions']}
    old = {p['id']: p for p in prior['downstream']}
    new = {p['id']: p for p in current['downstream']}
    checks[f'{city}.allPlaceRowsPreserved'] = old.keys() == new.keys()
    checks[f'{city}.allMediaFieldsPreserved'] = all(p['payload'].get(k) == new[p['id']]['payload'].get(k)
        for p in prior['downstream'] for k in ['coverImage', 'imageGallery', 'amapPhoto', 'imageIdentity', 'imagePolicy'])
    for eid, p in old.items():
        a, b = copy.deepcopy(p), copy.deepcopy(new[eid])
        for value in [a, b]:
            value['payload'].get('content', {}).pop('compiledAt', None)
            if eid == TARGET:
                value['payload'].pop('identity')
                value['payload'].pop('aliases', None)
                value['payload'].pop('nameKeys', None)
                value['payload'].pop('embeddedText', None)
                value['payload']['recommendationIdentity'].pop('revision')
        if a != b:
            changes.append({'city': city, 'id': eid, 'fields': [k for k in a['payload'].keys() | b['payload'].keys() if a['payload'].get(k) != b['payload'].get(k)]})
    if city == '北京':
        target = new[TARGET]
        checks['correctAliases'] = set(target['payload']['aliases']) == {'景山', '景山公园'}
        checks['unchangedLegacyIds'] = target['payload']['identity']['memberIds'] == old[TARGET]['payload']['identity']['memberIds']
        checks['newVersion'] = target['payload']['identity']['revision'] == 6
        checks['embeddingTextRemovesOnlyWrongAlias'] = (old[TARGET]['payload']['embeddedText'] == '北京 景山公园 景山 石景山公园 自然'
            and target['payload']['embeddedText'] == '北京 景山公园 景山 自然' and target['has_embedding'])
        checks['webContentExactlyPreserved'] = target['payload']['content'] == old[TARGET]['payload']['content']
        checks['noFactOrMediaContractAdded'] = 'mentionSources' not in target['payload'] and 'imageIdentity' not in target['payload']
checks['noUnexpectedPlaceChanges'] = not changes
checks['all60ScoresMatch'] = all(p['score'] == p['downstreamScore'] for c in rank['cities'] for p in c['top30'])
report = {'batch': 78, 'readOnly': True, 'checks': checks, 'unexpectedChanges': changes,
          'snapshotSha256': rank['snapshotSha256'], 'passed': all(checks.values())}
with (ROOT / 'jingshan-preservation-02.json').open('x', encoding='utf-8') as handle:
    json.dump(report, handle, ensure_ascii=False, indent=2)
print(json.dumps({'passed': report['passed'], 'checks': len(checks), 'failed': [k for k, v in checks.items() if not v], 'unexpectedChanges': changes}, ensure_ascii=False))
assert report['passed']
