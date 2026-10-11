"""保留前18项并补齐上海当前30候选的提及阅读；有待办者明确标出。"""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
B = ROOT.parents[1] / '10-06-place-identity-governance/research/all-cities'
SOURCE = 'snapshot-20261009T212651757971Z/input.json'


def read(path):
    return json.loads(path.read_bytes())


raw = (ROOT / SOURCE).read_bytes()
snapshot = json.loads(raw)
old_record = read(ROOT / 'seven-cities-semantic-readthrough-04.json')
old = read(ROOT / old_record['snapshotFile'])
assert old_record['snapshotSha256'] == hashlib.sha256((ROOT / old_record['snapshotFile']).read_bytes()).hexdigest()
reviews = old_record['reviews']
for r in reviews:
    now_city = next(c for c in snapshot['cities'] if c['city'] == r['city'])
    old_city = next(c for c in old['cities'] if c['city'] == r['city'])
    eid = r['entityId']
    assert next(e for e in now_city['entities'] if e['entity_id'] == eid) == next(e for e in old_city['entities'] if e['entity_id'] == eid)
    assert [m for m in now_city['mentions'] if m['entityId'] == eid] == [m for m in old_city['mentions'] if m['entityId'] == eid]
    for n in [*r.get('reviewedNotes', []), *r['noteEvidence']]:
        assert now_city['notes'][str(n['noteId'])] == old_city['notes'][str(n['noteId'])]
    r['reusedAfterFullEntityMentionsAndNotesComparison'] = True
city = next(c for c in snapshot['cities'] if c['city'] == '上海')
old_city = next(c for c in old['cities'] if c['city'] == '上海')
assert city['notes'] == old_city['notes']
for addition in read(ROOT / 'shanghai-readthrough-additions-01.json'):
    entity, = [e for e in city['entities'] if e['canonical_name'] == addition['name'] and e['status'] == 'ACTIVE']
    eid = entity['entity_id']
    assert not any(r['entityId'] == eid for r in reviews)
    mentions = [m for m in city['mentions'] if m['entityId'] == eid]
    assert len(mentions) == addition['count']
    assert addition['quote'] in city['notes'][str(addition['quoteNote'])]['note_desc']
    note_ids = {m['raw_note_id'] for m in mentions} | {addition['quoteNote']}
    source_ids = [m['id'] for m in mentions]
    if addition.get('batch'):
        scopes = read(B / (addition['batch'] + '-scope-decisions.json'))
        scope, = [s for s in scopes if eid in s['expectedRevisions']]
        source_ids = [a['mentionId'] for a in scope['assignments']]
        note_ids.update(m['raw_note_id'] for m in city['mentions'] if m['id'] in source_ids)
    reviews.append({'city': '上海', 'entityId': eid, 'name': entity['canonical_name'], 'expectedRevision': entity['revision'],
        'identityRetained': True, 'fullFactsReviewed': False, 'scope': '当前提及及完整笔记的身份语境阅读，未决语义与后续改动另列。',
        'mentions': [{'mentionId': m['id'], 'inputHash': m['inputHash'], 'resolution': m['resolution']} for m in mentions],
        'reviewedSourceMentionIds': source_ids,
        'reviewedNotes': [{'noteId': n, 'noteDescSha256': hashlib.sha256(city['notes'][str(n)]['note_desc'].encode()).hexdigest()} for n in sorted(note_ids)],
        'noteEvidence': [{'noteId': addition['quoteNote'], 'quote': addition['quote']}],
        'conclusion': addition['conclusion'], 'pendingMentionIds': addition.get('pendingMentionIds', []),
        'businessMutationByThisRecord': False, 'userAcceptance': False})
ranking = read(ROOT / 'seven-cities-ranking-22.json')
shanghai = next(c for c in ranking['cities'] if c['city'] == '上海')
assert {r['entityId'] for r in reviews if r['city'] == '上海'} == {p['entityId'] for p in shanghai['top30']}
assert len(reviews) == 35 and sum(len(r['mentions']) for r in reviews) == 370
with (ROOT / 'seven-cities-semantic-readthrough-05.json').open('x', encoding='utf-8') as handle:
    json.dump({'snapshotFile': SOURCE, 'snapshotSha256': hashlib.sha256(raw).hexdigest(), 'reviews': reviews,
        'limits': '35项/370当前提及包含上海当前30候选的提及语境阅读；已识别待应用来源与未决馆区/河岸/机位等仍未完成，不是30项身份全部闭合或所有资料已核。其余六城175个当前候选继续审核。'}, handle, ensure_ascii=False, indent=2)
lines = ['# 本轮逐项原文阅读记录', '', '35项、370条当前有效提及的阅读已留证，含上海当前30候选；待应用来源、未决主体边界及全部事实与用户验收仍未完成。', '',
    '| 城市 | 地点 | 当前有效提及 | 结论与待办 |', '| --- | --- | --- | --- |']
for r in reviews:
    lines.append('| ' + ' | '.join([r['city'], r['name'], '、'.join(str(m['mentionId']) for m in r['mentions']), r['conclusion'].replace('|', '／')]) + ' |')
lines += ['', '证据：[机器台账](research/seven-cities-semantic-readthrough-05.json)。每项绑定原文、归属和实体版本。', '']
(ROOT.parent / '七城本轮原文复核.md').write_text('\n'.join(lines), encoding='utf-8')
print(json.dumps({'readthroughEntities': len(reviews), 'currentMentions': 370, 'shanghaiCurrentCandidates': 30, 'allSemanticsCompleted': False}))
