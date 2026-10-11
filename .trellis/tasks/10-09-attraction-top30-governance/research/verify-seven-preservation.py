"""七城本轮首尾冻结保全；不输出用户行程、带令牌的来源链接或图片URL。"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
before = json.loads((ROOT / 'snapshot-20261009T141514441892Z/input.json').read_bytes())
after = json.loads((ROOT / 'snapshot-20261009T150027953658Z/input.json').read_bytes())
batch_root = ROOT.parents[1] / '10-06-place-identity-governance/research/all-cities'
decisions = json.loads((batch_root / 'batch-79-decisions.json').read_bytes())
allowed_entities = {eid for d in decisions for eid in d['expectedRevisions']}
assert before['tripsDigest'] == after['tripsDigest']
rows = []
for old in before['cities']:
    current = next(c for c in after['cities'] if c['city'] == old['city'])
    for field in ['sources', 'summaries', 'mentions', 'notes', 'scopes', 'assignments']:
        if field != 'mentions':
            assert old[field] == current[field], (old['city'], field)
    assert {m['id']: m['inputHash'] for m in old['mentions']} == {m['id']: m['inputHash'] for m in current['mentions']}
    old_entities = {e['entity_id']: e for e in old['entities']}
    new_entities = {e['entity_id']: e for e in current['entities']}
    assert old_entities.keys() == new_entities.keys()
    changes = [eid for eid in old_entities if old_entities[eid] != new_entities[eid]]
    assert set(changes).issubset(allowed_entities)
    assert {e: v for e, v in old_entities.items() if e not in allowed_entities} == {e: v for e, v in new_entities.items() if e not in allowed_entities}
    remap = {eid: d['entityId'] for d in decisions for eid in d['mergeEntityIds']}
    previous_mentions = {m['id']: m for m in old['mentions']}
    for m in current['mentions']:
        previous = previous_mentions[m['id']]
        assert m['entityId'] == remap.get(previous['entityId'], previous['entityId'])
    down = {p['id']: p for p in current['downstream']}
    photo_fields = 0
    for p in old['downstream']:
        assert p['id'] in down
        for field in ['imageGallery', 'coverImage', 'amapPhoto']:
            if field in p['payload']:
                assert p['payload'][field] == down[p['id']]['payload'].get(field)
                photo_fields += 1
    if old['city'] not in ['上海', '成都']:
        assert old == current, old['city']
    rows.append({'city': old['city'], 'sourceRows': len(old['sources']), 'mentions': len(old['mentions']),
        'notes': len(old['notes']), 'changedEntityIds': changes, 'oldDownstreamRows': len(old['downstream']),
        'photoFieldsPreserved': photo_fields, 'passed': True})
flow = json.loads((batch_root / 'flow/run-80/report.json').read_bytes())
cleanup = json.loads((batch_root / 'flow/run-80/cleanup.json').read_bytes())
assert not flow['failures'] and cleanup['removed']
report = {'readOnly': True, 'passed': True, 'tripsUnchanged': before['tripsDigest'], 'cities': rows,
    'flow': {'run': 'run-80', 'failures': 0, 'temporaryDatabaseRemoved': True,
             'targetCoverage': [{ 'city': c['city'], **c['targetCoverage']} for c in flow['cities'] if c['targetCoverage']]},
    'limits': '冻结源/摘要/原文/既有分配/旧行/图片字段保全，实际图片语义未验收；flow含全目录兼容回归，不代表主动治理范围扩到其他城市。'}
with (ROOT / 'seven-cities-preservation-01.json').open('x', encoding='utf-8') as f:
    json.dump(report, f, ensure_ascii=False, indent=2)
print(json.dumps({'passed': True, 'sources': sum(r['sourceRows'] for r in rows),
    'mentions': sum(r['mentions'] for r in rows), 'notes': sum(r['notes'] for r in rows),
    'oldDownstreamRows': sum(r['oldDownstreamRows'] for r in rows),
    'photoFields': sum(r['photoFieldsPreserved'] for r in rows), 'flow': report['flow']}, ensure_ascii=False))
