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


def build_city(city, classifications=(), geography_reviews=(), mention_boundaries=()):
    entities = {e['entity_id']: e for e in city['entities']}
    sources = {s['id']: s for s in city['sources']}
    downstream = {p['id']: p for p in city['downstream']}
    reviewed_types = {}
    boundaries = {}
    for review in mention_boundaries:
        if review['city'] != city['city']:
            continue
        pair = (review['entityId'], review['mentionId'])
        assert pair not in boundaries, '重复母项提及边界审核'
        entity = entities[review['entityId']]
        assert entity['revision'] == review['expectedRevision'] and not entity['redirect_to'], '母项边界审核版本已变化'
        assert entity['canonical_name'] == review['name']
        mention = next(m for m in city['mentions'] if m['id'] == review['mentionId'])
        assert mention['entityId'] is None and mention['resolution']['status'] in {'unresolved', 'review'}, '已归属提及须走正式治理，不能仅改排名'
        assert mention['inputHash'] == review['inputHash'] and mention['resolution'] == review['expectedResolution'], '边界原文或解析范围已变化'
        assert review['relation'] == 'not_same_entity' and review['conclusion']
        assert review['subjectType'] in {'component', 'route_segment', 'photo_spot', 'hotel', 'area', 'activity', 'transport', 'service'}
        assert review['noteId'] == mention['raw_note_id'] and review['quote'] in city['notes'][str(review['noteId'])]['note_desc'], '边界原文引述不匹配'
        boundaries[pair] = review
    for review in classifications:
        if review['city'] != city['city']:
            continue
        eid = review['entityId']
        assert eid not in reviewed_types, '重复类型审核'
        entity = entities[eid]
        assert not entity['redirect_to'] and entity['revision'] == review['expectedRevision'], '类型审核实体版本已变化'
        assert entity['canonical_name'] == review['name'], '类型审核主体名称已变化'
        own = {str(m['id']): m['inputHash'] for m in city['mentions'] if m['entityId'] == eid}
        assert own == review['mentionHashes'], '类型审核提及集合或原文已变化'
        assert review['effectiveType'] in {'transport', 'activity', 'photo_spot', 'market', 'food', 'cafe', 'hotel'}
        assert review['conclusion'] and review['noteQuotes'], '缺少类型审核证据'
        for quote in review['noteQuotes']:
            assert quote['quote'] in city['notes'][str(quote['noteId'])]['note_desc'], '类型审核原文引述不匹配'
        for evidence in review.get('publicSources', []):
            raw = (Path(__file__).resolve().parent / evidence['file']).read_bytes()
            assert hashlib.sha256(raw).hexdigest() == evidence['sha256'], '公开类型证据已变化'
            fetched = json.loads(raw)
            assert fetched['ok'] and fetched['url'] == evidence['url'] and evidence['quote'] in fetched['content'], '公开类型引述未获原页支持'
        reviewed_types[eid] = review
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
    geography = {r['entityId']: r for r in geography_reviews if r['city'] == city['city']}
    assert len(geography) == sum(r['city'] == city['city'] for r in geography_reviews), '重复地域审核'
    assert set(geography).issubset(entities), '地域审核实体不在当前城市'
    ranked, excluded, risks, other_cities = [], [], [], []
    used_geography, used_boundaries = set(), set()
    for e in city['entities']:
        eid = e['entity_id']
        if e['redirect_to']:
            continue
        src = members[eid]
        primary = sources.get(e['primary_place_id'])
        down = downstream.get(eid, {})
        payload = down.get('payload') or {}
        typ = e['overrides'].get('xhsPlaceType', primary['place_type'] if primary else payload.get('xhsPlaceType'))
        # 早期批次仅修正产品粗类；不得用未回写的源 attraction 复活餐饮/购物/住宿配额。
        governed_category = e['overrides'].get('category')
        if governed_category in {'美食', '购物', '住宿'}:
            typ = {'美食': 'food', '购物': 'market', '住宿': 'hotel'}[governed_category]
        classification = reviewed_types.get(eid)
        if classification:
            typ = classification['effectiveType']
        # 已冻结历史人工证据：山东大厦为中庭机位，不能因旧 attraction 误分进入景点配额。
        if city['city'] == '济南' and e['primary_place_id'] == 5971:
            typ = 'photo_spot'
        if typ not in ATTRACTIONS:
            excluded.append({'entityId': eid, 'name': e['canonical_name'], 'effectiveType': typ,
                             'reason': '不属本轮景点类型，保留原业务状态',
                             **({'governedCategory': governed_category} if governed_category else {}),
                             **({'classificationReview': classification} if classification else {})})
            continue
        scopes = [s for s in city['scopes'] if eid in s['entity_ids'] or eid in (s.get('withdrawal_entity_ids') or [])]
        scope_ids = {s['place_id'] for s in scopes}
        names = {key(n) for n in [e['canonical_name'], *e['aliases']]}
        names.update(key(n) for s in src for n in [s['name'], s['normalized_name']])
        uncertain = [m for m in city['mentions'] if not m['entityId'] and m['resolution']['status'] != 'excluded'
                     and (scope_ids.intersection(m['resolution'].get('scopePlaceIds', []))
                          or names.intersection({key(m['name']), key(m['normalized_name'])}))]
        not_same = [boundaries[(eid, m['id'])] for m in uncertain if (eid, m['id']) in boundaries]
        used_boundaries.update((eid, r['mentionId']) for r in not_same)
        uncertain = [m for m in uncertain if (eid, m['id']) not in boundaries]
        pending = [r for r in city['reviews'] if r['status'] == 'PENDING' and eid in r['detail'].get('entityIds', [])]
        own = resolved[eid]
        if eid in geography:
            review = geography[eid]
            assert not own and payload.get('identityWithdrawal'), '地域排除仅适用于已隔离且无当前归属的实体'
            assert review['expectedRevision'] == e['revision'] and review['name'] == e['canonical_name'], '地域审核实体已变化'
            assert review['sourceIds'] == sorted(s['id'] for s in src), '地域审核来源集合已变化'
            assert review['scopeSnapshot'] == scopes, '地域审核隔离范围已变化'
            assert review['mentionHashes'] == {str(m['id']): m['inputHash'] for m in uncertain}, '地域审核提及集合或原文已变化'
            assert uncertain and review['actualCity'] != city['city'] and review['conclusion'], '地域审核缺明确异城证据'
            assert {q['noteId'] for q in review['noteQuotes']} == {m['raw_note_id'] for m in uncertain}, '地域审核未覆盖全部笔记'
            for quote in review['noteQuotes']:
                assert review['actualCity'] in quote['quote'] and quote['quote'] in city['notes'][str(quote['noteId'])]['note_desc'], '地域审核原文不匹配'
            other_cities.append({'entityId': eid, 'name': e['canonical_name'], 'geographyReview': review,
                                 'uncertainMentionIds': [m['id'] for m in uncertain], 'pendingReviewIds': [r['id'] for r in pending],
                                 'reason': '已隔离异城来源不占本城配额；历史待审状态保持', 'businessMutation': False})
            used_geography.add(eid)
            continue
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
               'reviewedNonEquivalentMentions': not_same,
               'legacyIds': e['legacy_ids'], 'evidence': e['evidence']}
        if payload.get('identityWithdrawal') or e['status'] != 'ACTIVE':
            risks.append(row)
        else:
            ranked.append(row)
    assert used_geography == set(geography), '地域审核未作用于有效景点候选'
    assert used_boundaries == set(boundaries), '边界审核未对应本次母项的潜在提及，不能用无关证据消项'
    ranked.sort(key=lambda r: (-r['score'], -r['noteCount'], r['entityId']))
    for i, row in enumerate(ranked, 1):
        row['rank'] = i
    selected = ranked[:30]
    boundary = selected[-1]['score'] if len(selected) == 30 else None
    blockers = [r for r in [*ranked, *risks] if boundary is None or r['potentialScore'] >= boundary]
    return {'city': city['city'], 'top30': selected, 'allAttractions': ranked, 'excludedOtherTypes': excluded,
            'withdrawnOrReview': risks, 'excludedOtherCities': other_cities, 'boundaryScore': boundary,
            'rankAffectingUncertainty': [r for r in blockers if r['uncertainMentionIds'] or r['pendingReviewIds']],
            'completed': False, 'userAcceptance': False}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('snapshot', type=Path)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--classifications', type=Path)
    parser.add_argument('--geography-reviews', type=Path)
    parser.add_argument('--mention-boundaries', type=Path)
    args = parser.parse_args()
    raw = args.snapshot.read_bytes()
    snapshot = json.loads(raw)
    classifications = json.loads(args.classifications.read_bytes()) if args.classifications else []
    geography = json.loads(args.geography_reviews.read_bytes()) if args.geography_reviews else []
    boundaries = json.loads(args.mention_boundaries.read_bytes()) if args.mention_boundaries else []
    assert {r['city'] for r in classifications}.issubset({c['city'] for c in snapshot['cities']}), '类型审核城市不在本次快照'
    assert {r['city'] for r in geography}.issubset({c['city'] for c in snapshot['cities']}), '地域审核城市不在本次快照'
    assert {r['city'] for r in boundaries}.issubset({c['city'] for c in snapshot['cities']}), '边界审核城市不在本次快照'
    result = {'snapshotSha256': hashlib.sha256(raw).hexdigest(), 'capturedAt': snapshot['capturedAt'],
              'formula': '2*uniqueMentionIds + 5*recommendRatio + 0.5*uniqueNoteIds',
              'tieBreak': ['score DESC', 'noteCount DESC', 'entityId ASC'],
              'cityScope': [c['city'] for c in snapshot['cities']], 'quota': 30,
              'classificationFile': str(args.classifications) if args.classifications else None,
              'classificationSha256': hashlib.sha256(args.classifications.read_bytes()).hexdigest() if args.classifications else None,
              'geographyReviewFile': str(args.geography_reviews) if args.geography_reviews else None,
              'geographyReviewSha256': hashlib.sha256(args.geography_reviews.read_bytes()).hexdigest() if args.geography_reviews else None,
              'mentionBoundaryFile': str(args.mention_boundaries) if args.mention_boundaries else None,
              'mentionBoundarySha256': hashlib.sha256(args.mention_boundaries.read_bytes()).hexdigest() if args.mention_boundaries else None,
              'cities': [build_city(c, classifications, geography, boundaries) for c in snapshot['cities']]}
    with args.out.open('x', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(json.dumps({'file': str(args.out), 'cities': [{'city': c['city'], 'selected': len(c['top30']),
                     'boundaryScore': c['boundaryScore'], 'rankAffectingUncertainty': len(c['rankAffectingUncertainty'])} for c in result['cities']]}, ensure_ascii=False))


if __name__ == '__main__':
    main()
