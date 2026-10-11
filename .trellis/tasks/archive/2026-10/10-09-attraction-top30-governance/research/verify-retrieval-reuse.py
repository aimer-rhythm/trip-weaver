"""复用输入完全保持的已通过召回；新入榜或内容/身份变化者单独真实请求。"""
import argparse
import copy
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def load(name): return json.loads((ROOT / name).read_bytes())


def stable(row):
    row = copy.deepcopy(row)
    row.get('payload', {}).get('content', {}).pop('compiledAt', None)
    return row


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--complete', action='store_true')
    parser.add_argument('--before', default='snapshot-20261009T163355404046Z/input.json')
    parser.add_argument('--after', default='snapshot-20261009T171425234590Z/input.json')
    parser.add_argument('--ranking', default='seven-cities-ranking-10.json')
    parser.add_argument('--previous', default='seven-cities-retrieval-03.json')
    parser.add_argument('--targets', default='seven-cities-retrieval-targets-03.json')
    parser.add_argument('--fresh', default='seven-cities-changes-retrieval-01.json')
    parser.add_argument('--out', default='seven-cities-retrieval-04.json')
    args = parser.parse_args()
    old = load(args.before)
    new_bytes = (ROOT / args.after).read_bytes()
    new = json.loads(new_bytes)
    ranking = load(args.ranking)
    assert ranking['snapshotSha256'] == hashlib.sha256(new_bytes).hexdigest()
    previous = load(args.previous)
    assert previous['passed'] and previous['snapshotSha256'] == hashlib.sha256((ROOT / args.before).read_bytes()).hexdigest()
    prior = {p['entityId']: p for p in previous['rows']}
    old_places = {p['id']: p for c in old['cities'] for p in c['downstream']}
    new_places = {p['id']: p for c in new['cities'] for p in c['downstream']}
    reused, targets = [], []
    for city in ranking['cities']:
        needs = []
        for p in city['top30']:
            eid = p['entityId']
            assert p['score'] == p['downstreamScore']
            if eid in prior and prior[eid]['passed'] and stable(old_places[eid]) == stable(new_places[eid]):
                reused.append({**prior[eid], 'evidenceReport': args.previous,
                               'reusedAfterFullStoredRowComparison': True})
            else: needs.append(p)
        targets.append({'city': city['city'], 'top30': needs})
    target_ids = {p['entityId'] for c in targets for p in c['top30']}
    output = {'snapshotSha256': ranking['snapshotSha256'], 'cities': targets, 'cityScope': ranking['cityScope'],
              'reuseEvidence': {'report': args.previous, 'count': len(reused),
                               'comparison': '完整下游行逐字段相等，仅忽略content.compiledAt'}}
    if not args.complete:
        with (ROOT / args.targets).open('x', encoding='utf-8') as handle:
            json.dump(output, handle, ensure_ascii=False, indent=2)
        print(json.dumps({'reused': len(reused), 'newTargets': [{'city': c['city'], 'name': p['name']} for c in targets for p in c['top30']]}, ensure_ascii=False))
        return
    assert load(args.targets) == output
    fresh = load(args.fresh)
    assert fresh['passed'] and fresh['snapshotSha256'] == ranking['snapshotSha256']
    assert {p['entityId'] for p in fresh['rows']} == target_ids
    rows = [*reused, *[{**p, 'evidenceReport': args.fresh} for p in fresh['rows']]]
    expected_count = sum(len(c['top30']) for c in ranking['cities'])
    assert len(rows) == expected_count and len({p['entityId'] for p in rows}) == expected_count
    report = {'readOnly': True, 'snapshotSha256': ranking['snapshotSha256'], 'passed': True, 'rows': rows,
              'reused': len(reused), 'newRequests': len(fresh['rows']), 'uncovered': [],
              'limits': f'{len(reused)}项原真实SQL/向量结果经完整下游行比对复用，{len(fresh["rows"])}项新发真实请求；不是本轮重复请求全部{expected_count}项。身份及正文边界仍须单独审核。'}
    with (ROOT / args.out).open('x', encoding='utf-8') as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)
    print(json.dumps({'passed': True, 'total': len(rows), 'reused': len(reused), 'newRequests': len(fresh['rows'])}))


if __name__ == '__main__': main()
