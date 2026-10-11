"""核对指定批次首尾原资料、提及归属、既有范围、旧ID及媒体字段；输出新证据。"""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BATCH_ROOT = ROOT.parents[1] / '10-06-place-identity-governance/research/all-cities'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('before', type=Path)
    parser.add_argument('after', type=Path)
    parser.add_argument('--batches', nargs='+', required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    before_bytes, after_bytes = args.before.read_bytes(), args.after.read_bytes()
    before, after = json.loads(before_bytes), json.loads(after_bytes)
    assert before['tripsDigest'] == after['tripsDigest']
    assert [c['city'] for c in before['cities']] == [c['city'] for c in after['cities']]
    decisions, scope_decisions = [], []
    for batch in args.batches:
        assert not (BATCH_ROOT / f'{batch}-rolled-back.json').exists(), '已撤回批次不能作为本轮成功变更'
        assert json.loads((BATCH_ROOT / f'{batch}-applied.json').read_bytes())['apply']
        decisions.extend(json.loads((BATCH_ROOT / f'{batch}-decisions.json').read_bytes()))
        scope_file = BATCH_ROOT / f'{batch}-scope-decisions.json'
        if scope_file.exists():
            scope_decisions.extend(json.loads(scope_file.read_bytes()))
    allowed = {eid for d in decisions for eid in d['expectedRevisions']}
    allowed.update(eid for d in scope_decisions for eid in d['expectedRevisions'])
    rows = []
    for old, current in zip(before['cities'], after['cities']):
        for key in ['sources', 'summaries', 'notes']:
            assert old[key] == current[key], (old['city'], key)
        scopes = [d for d in scope_decisions if d['city'] == old['city']]
        old_scopes = {s['place_id']: s for s in old['scopes']}
        now_scopes = {s['place_id']: s for s in current['scopes']}
        # 本工具只支持新增范围；既有范围修订必须另行给出完整前后预期。
        assert all(d['expectedScopeRevision'] == 0 and d['sourcePlaceId'] not in old_scopes for d in scopes)
        assert set(now_scopes) == set(old_scopes) | {d['sourcePlaceId'] for d in scopes}
        assert all(now_scopes[sid] == value for sid, value in old_scopes.items())
        old_assignments = {a['mention_id']: a for a in old['assignments']}
        now_assignments = {a['mention_id']: a for a in current['assignments']}
        supplied = {a['mentionId']: (d, a) for d in scopes for a in d['assignments']}
        assert not set(old_assignments).intersection(supplied)
        assert set(now_assignments) == set(old_assignments) | set(supplied)
        assert all(now_assignments[mid] == value for mid, value in old_assignments.items())
        for mid, (d, a) in supplied.items():
            actual = now_assignments[mid]
            assert actual['scope_place_id'] == d['sourcePlaceId'] and actual['revision'] == 1
            assert actual['entity_id'] == a['entityId'] and actual['input_hash'] == a['inputHash']
            assert actual.get('fact_exclusions') == a.get('factExclusions')
            assert actual.get('exclusion') == a.get('exclusion') and actual['change_key'] == d['key']
        for d in scopes:
            actual = now_scopes[d['sourcePlaceId']]
            assert actual['revision'] == 1 and actual['change_key'] == d['key']
            assert actual['source_hash'] == d['expectedSourceHash'] and actual['evidence'] == d['evidence']
            assert set(actual['entity_ids']) == set(d['expectedRevisions'])
        old_entities = {e['entity_id']: e for e in old['entities']}
        new_entities = {e['entity_id']: e for e in current['entities']}
        assert old_entities.keys() == new_entities.keys()
        changed = {eid for eid in old_entities if old_entities[eid] != new_entities[eid]}
        assert changed.issubset(allowed)
        expected_owners = {m['id']: m['entityId'] for m in old['mentions']}
        for d in decisions:
            for mid, eid in expected_owners.items():
                if eid in d['mergeEntityIds']:
                    expected_owners[mid] = d['entityId']
            if d['city'] == old['city']:
                for evidence in d['evidence']:
                    for admission in evidence.get('admitMentions', []):
                        assert expected_owners[admission['mentionId']] is None
                        expected_owners[admission['mentionId']] = d['entityId']
        for mid, (_, a) in supplied.items():
            expected_owners[mid] = a['entityId']
        assert expected_owners == {m['id']: m['entityId'] for m in current['mentions']}
        assert {m['id']: m['inputHash'] for m in old['mentions']} == {m['id']: m['inputHash'] for m in current['mentions']}
        down = {p['id']: p for p in current['downstream']}
        media_count = 0
        for p in old['downstream']:
            assert p['id'] in down
            for key in ['imageGallery', 'coverImage', 'amapPhoto']:
                if key in p['payload']:
                    assert p['payload'][key] == down[p['id']]['payload'].get(key)
                    media_count += 1
        rows.append({'city': old['city'], 'sourceRows': len(old['sources']), 'mentions': len(old['mentions']),
            'notes': len(old['notes']), 'oldDownstreamRows': len(old['downstream']),
            'photoFieldsPreserved': media_count, 'changedEntityIds': sorted(changed),
            'scopesPreserved': len(old['scopes']), 'assignmentsPreserved': len(old['assignments']),
            'newScopes': len(scopes), 'newAssignments': len(supplied), 'passed': True})
    result = {'readOnly': True, 'passed': True, 'beforeSha256': hashlib.sha256(before_bytes).hexdigest(),
        'afterSha256': hashlib.sha256(after_bytes).hexdigest(), 'batches': args.batches,
        'tripsUnchanged': before['tripsDigest'], 'cities': rows,
        'limits': '核对原资料和原文、身份变更范围、归属并集、既有scope与分配及旧图片字段；不表示逐项资料事实、图片语义、坐标或未决边界已审完。'}
    with args.out.open('x', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(json.dumps({'passed': True, 'changedEntities': sum(len(r['changedEntityIds']) for r in rows),
        'sources': sum(r['sourceRows'] for r in rows), 'mentions': sum(r['mentions'] for r in rows),
        'oldRows': sum(r['oldDownstreamRows'] for r in rows), 'mediaFields': sum(r['photoFieldsPreserved'] for r in rows)}))


if __name__ == '__main__':
    main()
