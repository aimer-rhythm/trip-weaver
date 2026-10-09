"""冻结batch25请求：未定位的四条提及保留待审，明确撤回泛名；不连接数据库。"""
from pathlib import Path
import hashlib
import json
import sys
sys.stdout.reconfigure(encoding='utf-8')
root = Path(__file__).resolve().parent
source = root/'joint-coffee-source-1791338728505852300.json'
snapshot = json.loads(source.read_text(encoding='utf-8'))
assert snapshot['tableCounts'] == {'place_identity_scope': 2, 'place_identity_scope_source': 0, 'place_mention_assignment': 3}
scopes, reviews, expected = [], [], []
for group in snapshot['groups']:
    assert len(group['sources']) == len(group['mentions']) == 2
    assert not group['images'] and not group['existingScopes']
    assert all(s['entity']['revision'] == 1 for s in group['sources'])
    conclusion = ('两条原始提及均未确认具体分店；原图及评论补证仍不足，旧地图匹配不作为分店证据。'
        '联合纳管全部同名来源，每条提及显式未分配，四条旧泛名记录仅作撤回引用保留，不再作为具体门店候选。'
        '本决策不判断两实体同义或独立，不创建分店，不改原文；实体对与提及继续待审。')
    evidence = [{'kind': 'reviewed_joint_mention_scope', 'file': source.name,
        'sha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'reviewIds': [group['review']['id']],
        'sourcePlaceIds': [s['id'] for s in group['sources']], 'mentionIds': [m['id'] for m in group['mentions']],
        'conclusion': conclusion}, {'kind': 'evidence_review_record', 'file': 'scope-collision-and-audit-20261007.md',
        'sha256': hashlib.sha256((root/'scope-collision-and-audit-20261007.md').read_bytes()).hexdigest(),
        'conclusion': '四篇顶层评论扫描至末页，嵌套有限抽查；公开门店档案不能证明原提及归属。'}]
    anchor = group['sources'][0]
    revisions = {s['entity']['entity_id']: 1 for s in group['sources']}
    scopes.append({'key': f'all-cities-20261007-batch-25-joint-{anchor["id"]}', 'city': group['city'],
        'sourcePlaceId': anchor['id'], 'expectedSourceHash': anchor['sourceHash'], 'expectedScopeRevision': 0,
        'sources': [{'sourcePlaceId': s['id'], 'sourceHash': s['sourceHash']} for s in group['sources']],
        'expectedRevisions': revisions, 'assignments': [{'mentionId': m['id'], 'inputHash': m['inputHash'], 'entityId': None}
            for m in group['mentions']], 'evidence': evidence})
    reviews.append({'key': f'all-cities-20261007-batch-25-review-{group["review"]["id"]}', 'city': group['city'],
        'reviewFingerprint': group['review']['fingerprint'], 'expectedRevisions': {eid: 2 for eid in revisions},
        'verdict': 'uncertain', 'explanation': conclusion, 'evidence': evidence})
    expected.extend({'city': group['city'], 'id': s['entity']['entity_id'], 'name': s['entity']['canonical_name'],
        'revision': 2, 'verified': False, 'mentionIds': [], 'candidateIds': []} for s in group['sources'])
values = {'decisions': [], 'scope-decisions': scopes, 'review-decisions': reviews, 'export-expectations': expected}
out = root/'all-cities'
assert not (out/'batch-25-applied.json').exists()
assert all(not (out/f'batch-25-{key}.json').exists() for key in values)
for key, value in values.items():
    with (out/f'batch-25-{key}.json').open('x', encoding='utf-8') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
print(json.dumps({'batch': 'batch-25', 'scopes': len(scopes), 'pendingMentions': 4, 'withdrawals': 4, 'merges': 0}, ensure_ascii=False))
