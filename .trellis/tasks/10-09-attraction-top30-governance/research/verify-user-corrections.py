"""只读复现景山错误名称解析，并验证第75批前后原始数据保全。"""
import hashlib
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parent
UPSTREAM = Path('D:/Project/xhs-travel-pipeline')
sys.path.insert(0, str(UPSTREAM))
from app.clean.identity import IdentityCatalog
from app.clean.mention_identity import MentionIdentityCatalog

before_path = ROOT / 'snapshot-20261009T111626632432Z/input.json'
after_path = ROOT / 'snapshot-20261009T113623767243Z/input.json'
before = json.loads(before_path.read_bytes())
after = json.loads(after_path.read_bytes())
city = after['cities'][0]
catalog = IdentityCatalog(city['city'], city['entities'],
    [{'place_id': pid, 'entity_id': eid} for pid, eid in city['members'].items()])
mentions = MentionIdentityCatalog(catalog, city['scopes'], city['assignments'])
jingshan_id = '981bfe8125feb36e052dcfee1e0df8b5'
old_jingshan_id = 'a94865355cdbf6fccfda6fc748b9e9fe'
square_id = '21152db5b05aff609cffa2bee47f16b4'
old_tiananmen_id = '298e600416cbc4f85119932e8a3c966c'
synthetic = {'id': -1, 'name': '石景山公园', 'normalized_name': '石景山公园',
    'note_city': '北京', 'note_unavailable': False}
resolution = mentions.resolve(synthetic)
existing = [m for m in city['mentions'] if m['name'] == '石景山公园']
assert [m['id'] for m in existing] == [3148]
assert resolution['entity']['entity_id'] == jingshan_id
assert resolution['reason'] == 'confirmed_name'
assert catalog.resolve(entity_id=old_jingshan_id)['entity_id'] == jingshan_id
checks = {}
for old, new in zip(before['cities'], after['cities']):
    for field in ['sources', 'notes', 'assignments', 'scopes', 'summaries']:
        checks[f"{old['city']}.{field}"] = old[field] == new[field]
    checks[f"{old['city']}.mentionFingerprints"] = {
        m['id']: m['inputHash'] for m in old['mentions']} == {
        m['id']: m['inputHash'] for m in new['mentions']}
checks['trips'] = before['tripsDigest'] == after['tripsDigest']
old_entities = {e['entity_id']: e for e in before['cities'][0]['entities']}
changed = [e['entity_id'] for e in city['entities'] if old_entities[e['entity_id']] != e]
checks['onlyTwoEntitiesChanged'] = set(changed) == {square_id, old_tiananmen_id}
old_mentions = {m['id'] for m in before['cities'][0]['mentions']
    if m['entityId'] in {square_id, old_tiananmen_id}}
new_mentions = {m['id'] for m in city['mentions'] if m['entityId'] == square_id}
checks['exactMentionUnion'] = old_mentions == new_mentions and len(new_mentions) == 32
new_square = next(p for p in city['downstream'] if p['id'] == square_id)
old_square = next(p for p in before['cities'][0]['downstream'] if p['id'] == square_id)
checks['squareCoordinatesPreserved'] = all(new_square[k] == old_square[k] for k in ['lat', 'lng'])
checks['jingshanUnchanged'] = next(e for e in city['entities'] if e['entity_id'] == jingshan_id) == old_entities[jingshan_id]
module_files = ['app/clean/identity.py', 'app/clean/mention_identity.py', 'app/aggregate/place_identity.py']
report = {'readOnly': True, 'snapshotSha256': hashlib.sha256(after_path.read_bytes()).hexdigest(),
    'productionModuleSha256': {p: hashlib.sha256((UPSTREAM / p).read_bytes()).hexdigest() for p in module_files},
    'jingshan': {'defectReproduced': True, 'fixed': False, 'globalAlias': '石景山公园',
        'wrongTargetId': jingshan_id, 'targetRevision': catalog.root(jingshan_id)['revision'],
        'oldIdResolvesToWrongGlobalTarget': old_jingshan_id,
        'syntheticNewMention': {**synthetic, 'result': {k: v for k, v in resolution.items() if k != 'entity'}},
        'existingAffectedMentions': [{'id': m['id'], 'noteId': m['raw_note_id'], 'entityId': m['entityId']} for m in existing],
        'scopeCount': len(city['scopes']),
        'interpretation': '3148可按图片纠正为景山；新同名提及仍被全局别名自动归入景山，不能把单篇纠错等同全局同义。'},
    'tiananmen': {'changedEntityIds': changed, 'mentionCount': len(new_mentions),
        'recommendScore': new_square['payload']['recommendScore'], 'checks': checks, 'passed': all(checks.values())}}
assert report['tiananmen']['passed'], checks
with (ROOT / 'user-corrections-verification-01.json').open('x', encoding='utf-8') as f:
    json.dump(report, f, ensure_ascii=False, indent=2)
print(json.dumps(report, ensure_ascii=False))
