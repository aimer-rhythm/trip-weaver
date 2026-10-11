"""核验国子监合并后的身份、审核历史、原资料、图片和排名。"""
import argparse
import copy
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TARGET = '0854db5911778c6722637d896e9c2904'
OLD = '1405884c419eb09eb99f8489b7044278'
parser = argparse.ArgumentParser()
parser.add_argument('after', type=Path)
parser.add_argument('ranking', type=Path)
parser.add_argument('out', type=Path)
args = parser.parse_args()
before = json.loads((ROOT / 'snapshot-20261009T124103348992Z/input.json').read_bytes())
raw = args.after.read_bytes()
after = json.loads(raw)
rank = json.loads(args.ranking.read_bytes())
checks = {'snapshotMatchesRanking': rank['snapshotSha256'] == hashlib.sha256(raw).hexdigest(),
          'tripsUnchanged': before['tripsDigest'] == after['tripsDigest']}
changed_entities, changed_reviews, changed_mentions, changed_content = [], [], [], []
for prior, current in zip(before['cities'], after['cities']):
    city = prior['city']
    assert city == current['city']
    for field in ['sources', 'notes', 'scopes', 'assignments', 'summaries']:
        checks[f'{city}.{field}Preserved'] = prior[field] == current[field]
    checks[f'{city}.mentionInputsPreserved'] = {m['id']: m['inputHash'] for m in prior['mentions']} == {m['id']: m['inputHash'] for m in current['mentions']}
    for field, key, collector in [('entities', 'entity_id', changed_entities), ('reviews', 'id', changed_reviews)]:
        old_rows = {row[key]: row for row in prior[field]}
        new_rows = {row[key]: row for row in current[field]}
        checks[f'{city}.{field}IdsPreserved'] = old_rows.keys() == new_rows.keys()
        collector.extend(k for k, row in old_rows.items() if row != new_rows.get(k))
    old_mentions = {m['id']: m for m in prior['mentions']}
    changed_mentions.extend(m['id'] for m in current['mentions'] if m['entityId'] != old_mentions[m['id']]['entityId'])
    checks[f'{city}.exactUnion'] = all(m['entityId'] == (TARGET if old_mentions[m['id']]['entityId'] == OLD else old_mentions[m['id']]['entityId']) for m in current['mentions'])
    old_places = {p['id']: p for p in prior['downstream']}
    new_places = {p['id']: p for p in current['downstream']}
    checks[f'{city}.oldPlaceRowsPreserved'] = old_places.keys() <= new_places.keys()
    checks[f'{city}.mediaFieldsPreserved'] = all(p['payload'].get(k) == new_places[p['id']]['payload'].get(k)
        for p in prior['downstream'] for k in ['coverImage', 'imageGallery', 'amapPhoto', 'imageIdentity', 'imagePolicy'])
    for eid, old in old_places.items():
        if eid in [TARGET, OLD]:
            continue
        old_payload, new_payload = [copy.deepcopy(p['payload']) for p in [old, new_places[eid]]]
        old_payload.get('content', {}).pop('compiledAt', None)
        new_payload.get('content', {}).pop('compiledAt', None)
        if old_payload != new_payload:
            changed_content.append({'city': city, 'id': eid, 'name': old['name'],
                'fields': [k for k in old_payload.keys() | new_payload.keys() if old_payload.get(k) != new_payload.get(k)]})
    if city == '北京':
        target = new_places[TARGET]
        checks['mainIdAndAlias'] = target['name'] == '国子监' and set(target['payload']['aliases']) == {'国子监', '国子监街'}
        checks['oldIdRedirects'] = new_places[OLD]['payload'].get('canonicalRedirectTo') == TARGET
        checks['coordinatesPreserved'] = all(target[k] == old_places[TARGET][k] for k in ['lat', 'lng'])
        checks['contentInheritedFromStreetExactly'] = target['payload']['content'] == old_places[OLD]['payload']['content']
        checks['oldStreetContentPreserved'] = new_places[OLD]['payload']['content'] == old_places[OLD]['payload']['content']
        checks['existingHoursAndPriceUnchanged'] = all(target['payload'].get(k) == old_places[TARGET]['payload'].get(k) for k in ['openHours', 'price'])
        checks['actualScore'] = target['payload']['recommendScore'] == 51.74 and target['payload']['mentionCount'] == 19
        old_review = next(r for r in prior['reviews'] if r['id'] == 64)
        new_review = next(r for r in current['reviews'] if r['id'] == 64)
        checks['oldReviewPreservedInHistory'] = new_review['detail']['assessmentHistory'][-1] == old_review['detail']['assessment']
        checks['reviewReplacedByUserDecision'] = (new_review['status'] == 'RESOLVED'
            and new_review['detail']['assessment']['verdict'] == 'same_entity'
            and new_review['detail']['assessment']['supersedes'] == old_review['detail']['assessment']['key']
            and new_review['fingerprint'] == old_review['fingerprint'])
        checks['combinationMentionsStillUnresolved'] = all(m['entityId'] is None for m in current['mentions'] if m['id'] in [2557, 4985])
checks['onlyTwoEntitiesChanged'] = set(changed_entities) == {TARGET, OLD}
checks['onlyReview64Changed'] = changed_reviews == [64]
checks['onlyTenStreetMentionsMoved'] = len(changed_mentions) == 10
checks['otherPayloadsPreservedExceptCompiledAt'] = not changed_content
checks['all60ScoresMatch'] = all(p['score'] == p['downstreamScore'] for c in rank['cities'] for p in c['top30'])
checks['fayuansiFillsRank30'] = rank['cities'][0]['top30'][-1]['name'] == '法源寺'
report = {'readOnly': True, 'batch': 'batch-77-v2', 'snapshotSha256': rank['snapshotSha256'],
    'checks': checks, 'changedEntities': changed_entities, 'changedReviews': changed_reviews,
    'changedMentionIds': changed_mentions, 'unexpectedPayloadChanges': changed_content,
    'passed': all(checks.values()), 'limits': '身份改判不等于所有提及、旧营业票价或图片语义已审核；原国子监社区摘要留于原始来源与快照，当前简介采用原街道网页资料。'}
with args.out.open('x', encoding='utf-8') as handle:
    json.dump(report, handle, ensure_ascii=False, indent=2)
print(json.dumps({'passed': report['passed'], 'checks': len(checks), 'failed': [k for k, v in checks.items() if not v]}, ensure_ascii=False))
assert report['passed'], checks
