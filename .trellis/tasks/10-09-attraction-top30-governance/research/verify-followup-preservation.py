"""验证第75/76批前后原始数据、媒体、行程与未触及实体保全。"""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BEFORE = ROOT / 'snapshot-20261009T111626632432Z/input.json'
AFTER = ROOT / 'snapshot-20261009T120916994082Z/input.json'
before, after = [json.loads(p.read_bytes()) for p in [BEFORE, AFTER]]
expected_ids = {'21152db5b05aff609cffa2bee47f16b4', '298e600416cbc4f85119932e8a3c966c', '0854db5911778c6722637d896e9c2904'}
checks, changed_ids = {}, []
media_fields = ['coverImage', 'imageGallery', 'amapPhoto', 'imageIdentity', 'imagePolicy']
old_rows = 0
for old, new in zip(before['cities'], after['cities']):
    city = old['city']
    assert city == new['city']
    for field in ['sources', 'notes', 'scopes', 'assignments', 'summaries']:
        checks[city + '.' + field] = old[field] == new[field]
    checks[city + '.mentionFingerprints'] = {m['id']: m['inputHash'] for m in old['mentions']} == {m['id']: m['inputHash'] for m in new['mentions']}
    old_entities = {e['entity_id']: e for e in old['entities']}
    changed_ids += [e['entity_id'] for e in new['entities'] if e != old_entities.get(e['entity_id'])]
    new_rows = {p['id']: p for p in new['downstream']}
    checks[city + '.oldRowsPreserved'] = all(p['id'] in new_rows for p in old['downstream'])
    checks[city + '.mediaPreserved'] = all(p['payload'].get(k) == new_rows[p['id']]['payload'].get(k)
        for p in old['downstream'] for k in media_fields)
    old_rows += len(old['downstream'])
    if city == '北京':
        square = '21152db5b05aff609cffa2bee47f16b4'
        previous = next(p for p in old['downstream'] if p['id'] == square)
        checks['squareCoordinatesPreserved'] = all(previous[k] == new_rows[square][k] for k in ['lat', 'lng'])
        old_tiananmen = next(p for p in old['downstream'] if p['id'] == '298e600416cbc4f85119932e8a3c966c')
        source = next(p for p in old['sources'] if p['id'] == 690)
        checks['squareContentExactlyInheritedFromMergedTiananmen'] = new_rows[square]['payload'].get('content') == old_tiananmen['payload'].get('content') == source['content_profile']
        primary = next(p for p in old['sources'] if p['id'] == 1163)
        checks['primarySourceHadNoWebProfile'] = primary['content_profile'] is None
checks['onlyExpectedEntitiesChanged'] = set(changed_ids) == expected_ids
checks['tripsPreserved'] = before['tripsDigest'] == after['tripsDigest']
rank = json.loads((ROOT / 'ranking-07.json').read_bytes())
checks['all60ScoresMatch'] = all(p['score'] == p['downstreamScore'] for c in rank['cities'] for p in c['top30'])
checks['rankingMatchesFinalSnapshot'] = rank['snapshotSha256'] == hashlib.sha256(AFTER.read_bytes()).hexdigest()
report = {'readOnly': True, 'batches': [75, 76], 'before': str(BEFORE.relative_to(ROOT)), 'after': str(AFTER.relative_to(ROOT)),
    'checks': checks, 'changedEntityIds': changed_ids, 'oldDownstreamRows': old_rows,
    'rawSources': sum(len(c['sources']) for c in after['cities']),
    'mentions': sum(len(c['mentions']) for c in after['cities']), 'trips': after['tripsDigest']['count'],
    'contentChange': {'entityId':'21152db5b05aff609cffa2bee47f16b4', 'sourceId':690,
        'before':'广场的4条社区看点摘要', 'after':'原天安门已审核网页简介及3条引文，逐字段完全相同',
        'primarySource':1163, 'primaryWebProfileExisted':False,
        'previousCheck':'followup-preservation-01.json保留：原广场消费内容不变的假设失败'},
    'passed': all(checks.values())}
with (ROOT / 'followup-preservation-02.json').open('x', encoding='utf-8') as f:
    json.dump(report, f, ensure_ascii=False, indent=2)
print(json.dumps({'passed': report['passed'], 'checks': len(checks), 'failed': [k for k, v in checks.items() if not v]}))
assert report['passed'], checks
