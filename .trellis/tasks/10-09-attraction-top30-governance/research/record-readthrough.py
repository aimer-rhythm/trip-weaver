"""通用逐项原文阅读固化：由 cases JSON 驱动，引文逐条断言，不覆盖历史台账。"""
import hashlib
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parent
TASK = ROOT.parent
PARENT = ROOT.parents[1] / '10-06-place-identity-governance'
read = lambda p: json.loads(p.read_bytes())
write = lambda name, value: (ROOT / name).write_text(
    json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')

cases = read(ROOT / sys.argv[1])
DOC = sys.argv[2] if len(sys.argv) > 2 else '七城本轮原文复核.md'
record = read(ROOT / cases['from'])
raw = (ROOT / record['snapshotFile']).read_bytes()
assert hashlib.sha256(raw).hexdigest() == record['snapshotSha256']
city = next(c for c in json.loads(raw)['cities'] if c['city'] == cases['city'])
raw_notes = (city.get('governanceState') or {}).get('rawNotes') or []
notes = {n['id']: n for n in raw_notes}
desc = city['notes']
assert len(record['reviews']) == cases['expectedFromItems'], len(record['reviews'])
items = []
for case in cases['cases']:
    cands = [e for e in city['entities'] if e['canonical_name'] == case['name']]
    if len(cands) > 1:
        print(f'# 同名实体 {len(cands)} 个，取提及最多者：{case["name"]}')
    entity = max(cands, key=lambda e: sum(1 for m in city['mentions'] if m['entityId'] == e['entity_id']))
    eid = entity['entity_id']
    assert not any(r['entityId'] == eid for r in record['reviews']), case['name']
    rows = sorted([m for m in city['mentions'] if m['entityId'] == eid], key=lambda m: m['raw_note_id'])
    ids = sorted({m['raw_note_id'] for m in rows})
    assert (len(rows), len(ids)) == (case['mentions'], case['notes']), (case['name'], len(rows), len(ids))
    for nid in ids:
        assert str(nid) in desc, (case['name'], nid)
    for nid, quote in case['quotes']:
        assert nid in ids and quote in desc[str(nid)]['note_desc'], (case['name'], nid, quote)
    item = {'city': cases['city'], 'entityId': eid, 'name': entity['canonical_name'],
        'expectedRevision': entity['revision'], 'identityRetained': True, 'fullFactsReviewed': False,
        'scope': '全实体当前提及全文已读；来源/组成/定位边界分别待治理',
        'mentions': [{'mentionId': m['id'], 'inputHash': m['inputHash'], 'resolution': m['resolution']} for m in rows],
        'reviewedSourceMentionIds': [m['id'] for m in rows],
        'noteEvidence': [{'noteId': nid, 'noteDescSha256': hashlib.sha256(desc[str(nid)]['note_desc'].encode()).hexdigest(),
            'fullFrozenNoteSha256': hashlib.sha256(json.dumps(desc[str(nid)], ensure_ascii=False, sort_keys=True).encode()).hexdigest(),
            'rawNoteSha256': hashlib.sha256(json.dumps(notes[nid], ensure_ascii=False, sort_keys=True).encode()).hexdigest() if nid in notes else None} for nid in ids],
        'existingImageTextEvidence': [{'noteId': nid, 'rawNoteSha256': hashlib.sha256(json.dumps(notes[nid], ensure_ascii=False, sort_keys=True).encode()).hexdigest() if nid in notes else None,
            'textImageIndices': [i for i, value in enumerate((notes.get(nid) or {}).get('img_analysis') or []) if isinstance(value, dict) and value.get('has_text')]} for nid in ids],
        'rawNoteEvidenceAvailable': bool(notes),
        'readSnapshotFile': record['snapshotFile'],
        'reusedAfterFullEntityMentionsAndNotesComparison': True,
        'noteQuotes': [{'noteId': nid, 'quote': quote} for nid, quote in case['quotes']],
        'conclusion': case['conclusion'], 'pendingMentionIds': case.get('pendingMentionIds', []),
        'businessMutationByThisRecord': False, 'userAcceptance': False}
    items.append(item)
record['reviews'] += items
count = sum(len(r['mentions']) for r in record['reviews'])
assert (len(record['reviews']), count) == (cases['expectedToItems'], cases['expectedToMentions']), (len(record['reviews']), count)
record['limits'] = (f"{len(record['reviews'])}项/{count}当前有效提及已读；阅读不等于全来源、同体/组成/定位问题闭合，"
    '也不等于各城语义已完成。七城batch-120、北京济南run-79为各自最新完整验证；未验收、不提交、不归档。')
write(cases['to'], record)
next_evidence = read(ROOT / cases['nextFrom'])
next_evidence.update(semanticReadthrough=cases['to'])
if 'nextBatch' in cases:
    next_evidence['nextBatch'] = cases['nextBatch']
if cases.get('remainingReview'):
    next_evidence['remainingReview'][0] = cases['remainingReview']
for item in items:
    next_evidence['nextEvidence'].append({'city': cases['city'], 'entityId': item['entityId'],
        'pendingMentionIds': item['pendingMentionIds'],
        'conclusion': f"[{item['name']}]" + item['conclusion']})
write(cases['nextTo'], next_evidence)
lines = ['# 本轮逐项原文阅读记录', '', record['limits'], '', '| 城市 | 地点 | 当前有效提及 | 结论与待办 |', '| --- | --- | --- | --- |']
for review in record['reviews']:
    lines.append('| ' + ' | '.join([review['city'], review['name'],
        '、'.join(str(m['mentionId']) for m in review['mentions']), review['conclusion'].replace('|', '／')]) + ' |')
lines += ['', f"证据：[阅读台账](research/{cases['to']})、[下一证据](research/{cases['nextTo']})。", '']
(TASK / DOC).write_text('\n'.join(lines), encoding='utf-8')
note = record['limits'] + f"新增{cases['city']}「{'、'.join(c['name'] for c in cases['cases'])}」共{sum(len(i['mentions']) for i in items)}条。"
for path in [TASK / 'task.json', PARENT / 'task.json']:
    task = read(path)
    assert task['status'] == 'in_progress'
    task['notes'] = task['notes'] + ' ' + note
    task['meta']['sevenCityContinuation'].update(
        semanticReadthrough=f'10-09-attraction-top30-governance/research/{cases["to"]}',
        workingStage=note, accepted=False)
    path.write_text(json.dumps(task, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
for name in ['进展记录.md', '七城剩余问题.md']:
    with (TASK / name).open('a', encoding='utf-8') as handle:
        handle.write(f"\n## {cases['city']}{cases['summary']}阅读断点\n\n" + note +
            f"\n\n入口：[下一证据](research/{cases['nextTo']})。\n")
print(json.dumps({'items': len(record['reviews']), 'currentMentions': count,
    'added': [c['name'] for c in cases['cases']], 'accepted': False}, ensure_ascii=False))
