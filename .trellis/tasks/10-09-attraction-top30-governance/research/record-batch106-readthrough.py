"""将106批正式结果投影到阅读台账；完整核对其余31项未变。"""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
B = ROOT.parents[1] / '10-06-place-identity-governance/research/all-cities'
SOURCE = 'snapshot-20261009T213645389978Z/input.json'


def read(path):
    return json.loads(path.read_bytes())


raw = (ROOT / SOURCE).read_bytes()
current = json.loads(raw)
record = read(ROOT / 'seven-cities-semantic-readthrough-05.json')
previous = read(ROOT / record['snapshotFile'])
assert record['snapshotSha256'] == hashlib.sha256((ROOT / record['snapshotFile']).read_bytes()).hexdigest()
scopes = {eid: scope for scope in read(B / 'batch-106-scope-decisions.json') for eid in scope['expectedRevisions']}
assert len(scopes) == 4
for r in record['reviews']:
    old = next(c for c in previous['cities'] if c['city'] == r['city'])
    city = next(c for c in current['cities'] if c['city'] == r['city'])
    assert old['notes'] == city['notes']
    eid = r['entityId']
    before = next(e for e in old['entities'] if e['entity_id'] == eid)
    after = next(e for e in city['entities'] if e['entity_id'] == eid)
    old_mentions = [m for m in old['mentions'] if m['entityId'] == eid]
    mentions = [m for m in city['mentions'] if m['entityId'] == eid]
    if eid not in scopes:
        assert before == after and old_mentions == mentions
        r['reusedAfterFullEntityMentionsAndNotesComparison'] = True
        continue
    scope = scopes[eid]
    assert scope['expectedRevisions'][eid] == before['revision'] and after['revision'] == before['revision'] + 1
    assert {m['id']: m['inputHash'] for m in old_mentions} == {a['mentionId']: a['inputHash'] for a in scope['assignments']}
    assert {m['id'] for m in mentions} == {a['mentionId'] for a in scope['assignments'] if a['entityId'] == eid}
    for m in mentions:
        old_m = next(m0 for m0 in old_mentions if m0['id'] == m['id'])
        assert {k: v for k, v in m.items() if k not in {'entityId', 'resolution'}} == {k: v for k, v in old_m.items() if k not in {'entityId', 'resolution'}}
    r['expectedRevision'] = after['revision']
    r['mentions'] = [{'mentionId': m['id'], 'inputHash': m['inputHash'], 'resolution': m['resolution']} for m in mentions]
    r['reviewedSourceMentionIds'] = [a['mentionId'] for a in scope['assignments']]
    r['appliedScopeBatch'] = 'batch-106'
    r['conclusion'] = scope['evidence'][0]['conclusion']
    r['pendingMentionIds'] = [10944] if r['name'] == '北外滩' else []
    if r['name'] == '新天地':
        r['conclusion'] += ' 新天地文化街区/购物属性的任务配额仍待明确，scope不替代类型复核。'
    r['reusedAfterFullEntityMentionsAndNotesComparison'] = False
assert len(record['reviews']) == 35 and sum(len(r['mentions']) for r in record['reviews']) == 367
record.update(snapshotFile=SOURCE, snapshotSha256=hashlib.sha256(raw).hexdigest(),
    limits='35项/367当前提及包含上海当前30候选的阅读；106批四主体已按正式scope更新，其余31项逐字段保持。尚有类型、馆区、河岸、组合、坐标与简称引文等未决，不是所有身份闭合或用户验收。')
with (ROOT / 'seven-cities-semantic-readthrough-06.json').open('x', encoding='utf-8') as handle:
    json.dump(record, handle, ensure_ascii=False, indent=2)
lines = ['# 本轮逐项原文阅读记录', '', '35项、367条当前有效提及的阅读已留证，含上海当前30候选；未决身份、类型、资料与用户验收仍未完成。', '',
    '| 城市 | 地点 | 当前有效提及 | 结论与待办 |', '| --- | --- | --- | --- |']
for r in record['reviews']:
    lines.append('| ' + ' | '.join([r['city'], r['name'], '、'.join(str(m['mentionId']) for m in r['mentions']), r['conclusion'].replace('|', '／')]) + ' |')
lines += ['', '证据：[机器台账](research/seven-cities-semantic-readthrough-06.json)。每项绑定原文、归属和实体版本。', '']
(ROOT.parent / '七城本轮原文复核.md').write_text('\n'.join(lines), encoding='utf-8')
print(json.dumps({'readthroughEntities': 35, 'currentMentions': 367, 'updatedScopes': 4, 'fullyComparedUnchanged': 31}))
