"""只读冻结快照上的景点排名和阻塞清单，不把技术唯一当作语义已审核。"""
import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path
import unicodedata

ATTRACTIONS = {'attraction', 'park', 'museum', 'scenic_area'}


def key(value):
    return ''.join(unicodedata.normalize('NFKC', value or '').lower().split())


def score(rows):
    # 同一提及只能出现一次；不同提取轮次的不同 mention ID 沿用现行评分合同。
    unique = {m['id']: m for m in rows}
    n = len(unique)
    notes = len({m['raw_note_id'] for m in unique.values()})
    return round(n * 2 + sum(m['mention_type'] == 'recommend' for m in unique.values()) / max(n, 1) * 5 + notes * .5, 2)


def build_city(city):
    entities = {e['entity_id']: e for e in city['entities']}
    sources = {s['id']: s for s in city['sources']}
    downstream = {p['id']: p for p in city['downstream']}
    members, resolved = defaultdict(list), defaultdict(list)

    def root(eid):
        seen = set()
        while eid in entities and entities[eid]['redirect_to']:
            if eid in seen:
                raise ValueError('实体重定向环')
            seen.add(eid)
            eid = entities[eid]['redirect_to']
        if eid not in entities:
            raise ValueError('实体重定向悬空')
        return eid

    for sid, eid in city['members'].items():
        members[root(eid)].append(sources[int(sid)])
    for m in city['mentions']:
        if m['entityId']:
            resolved[root(m['entityId'])].append(m)
    ranked, excluded, risks = [], [], []
    for e in city['entities']:
        eid = e['entity_id']
        if e['redirect_to']:
            continue
        src = members[eid]
        primary = sources.get(e['primary_place_id'])
        down = downstream.get(eid, {})
        payload = down.get('payload') or {}
        typ = e['overrides'].get('xhsPlaceType', primary['place_type'] if primary else payload.get('xhsPlaceType'))
        # 已冻结历史人工证据：山东大厦为中庭机位，不能因旧 attraction 误分进入景点配额。
        if city['city'] == '济南' and e['primary_place_id'] == 5971:
            typ = 'photo_spot'
        if typ not in ATTRACTIONS:
            excluded.append({'entityId': eid, 'name': e['canonical_name'], 'effectiveType': typ,
                             'reason': '不属本轮景点类型，保留原业务状态'})
            continue
        scopes = [s for s in city['scopes'] if eid in s['entity_ids'] or eid in (s.get('withdrawal_entity_ids') or [])]
        scope_ids = {s['place_id'] for s in scopes}
        names = {key(n) for n in [e['canonical_name'], *e['aliases']]}
        names.update(key(n) for s in src for n in [s['name'], s['normalized_name']])
        uncertain = [m for m in city['mentions'] if not m['entityId'] and m['resolution']['status'] != 'excluded'
                     and (scope_ids.intersection(m['resolution'].get('scopePlaceIds', []))
                          or names.intersection({key(m['name']), key(m['normalized_name'])}))]
        pending = [r for r in city['reviews'] if r['status'] == 'PENDING' and eid in r['detail'].get('entityIds', [])]
        own = resolved[eid]
        aliases = sorted(set(e['aliases']) - {e['canonical_name']})
        issues = []
        if uncertain:
            issues.append('存在未确认归属提及')
        if pending:
            issues.append('存在未结实体对审核')
        if not down or not down.get('verified') or payload.get('identityWithdrawal'):
            issues.append('下游未上架或已撤回')
        if payload.get('identity', {}).get('revision') != e['revision']:
            issues.append('上下游版本不一致')
        live_score = payload.get('recommendScore')
        if live_score != score(own):
            issues.append('下游推荐分与当前实体提及重算不一致')
        row = {'entityId': eid, 'city': city['city'], 'name': e['canonical_name'], 'revision': e['revision'],
               'aliases': aliases, 'sourceIds': sorted(s['id'] for s in src), 'sourceNames': sorted({s['name'] for s in src}),
               'effectiveType': typ, 'score': score(own), 'downstreamScore': live_score,
               'mentionCount': len(own), 'noteCount': len({m['raw_note_id'] for m in own}),
               'uncertainMentionIds': [m['id'] for m in uncertain], 'allAssignedScore': score([*own, *uncertain]),
               # 分母变化可能使推荐占比下降；全部归入的分数不一定是数学上界。
               'potentialScore': (len({m['id'] for m in [*own, *uncertain]}) * 2 + 5
                                  + len({m['raw_note_id'] for m in [*own, *uncertain]}) * .5)
                                 if uncertain else score(own),
               'pendingReviewIds': [r['id'] for r in pending], 'scopeIds': sorted(scope_ids),
               'hasCoordinates': down.get('lat') is not None and down.get('lng') is not None,
               'hasEmbedding': down.get('has_embedding', False), 'issues': issues,
               'identityReviewStatus': 'pending_semantic_review', 'mentionIds': [m['id'] for m in own],
               'legacyIds': e['legacy_ids'], 'evidence': e['evidence']}
        if payload.get('identityWithdrawal') or e['status'] != 'ACTIVE':
            risks.append(row)
        else:
            ranked.append(row)
    ranked.sort(key=lambda r: (-r['score'], -r['noteCount'], r['entityId']))
    for i, row in enumerate(ranked, 1):
        row['rank'] = i
    selected = ranked[:30]
    boundary = selected[-1]['score'] if len(selected) == 30 else None
    blockers = [r for r in [*ranked, *risks] if boundary is None or r['potentialScore'] >= boundary]
    return {'city': city['city'], 'top30': selected, 'allAttractions': ranked, 'excludedOtherTypes': excluded,
            'withdrawnOrReview': risks, 'boundaryScore': boundary,
            'rankAffectingUncertainty': [r for r in blockers if r['uncertainMentionIds'] or r['pendingReviewIds']],
            'completed': False, 'userAcceptance': False}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('snapshot', type=Path)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    raw = args.snapshot.read_bytes()
    snapshot = json.loads(raw)
    result = {'snapshotSha256': hashlib.sha256(raw).hexdigest(), 'capturedAt': snapshot['capturedAt'],
              'formula': '2*uniqueMentionIds + 5*recommendRatio + 0.5*uniqueNoteIds',
              'tieBreak': ['score DESC', 'noteCount DESC', 'entityId ASC'],
              'cityScope': ['北京', '济南'], 'quota': 30, 'cities': [build_city(c) for c in snapshot['cities']]}
    with args.out.open('x', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(json.dumps({'file': str(args.out), 'cities': [{'city': c['city'], 'selected': len(c['top30']),
                     'boundaryScore': c['boundaryScore'], 'rankAffectingUncertainty': len(c['rankAffectingUncertainty'])} for c in result['cities']]}, ensure_ascii=False))


if __name__ == '__main__':
    main()
