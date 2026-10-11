"""固化成都宽窄巷子22条实际全文阅读，不执行业务决定。"""
import hashlib
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parent
PARENT = ROOT.parents[1] / '10-06-place-identity-governance'
read = lambda p: json.loads(p.read_bytes())
EID = '485c9143678e70a03c3fda50d6d1da20'
record = read(ROOT / 'seven-cities-semantic-readthrough-29.json')
raw = (ROOT / record['snapshotFile']).read_bytes()
assert hashlib.sha256(raw).hexdigest() == record['snapshotSha256']
city = next(c for c in json.loads(raw)['cities'] if c['city'] == '成都')
before_city = next(c for c in read(ROOT / 'snapshot-20261010T025803181559Z/input.json')['cities'] if c['city'] == '成都')
assert city['notes'] == before_city['notes'], '既有笔记在冻结前后不一致'
notes = {n['id']: n for n in city['governanceState']['rawNotes']}
before_notes = {n['id']: n for n in before_city['governanceState']['rawNotes']}
entity = next(e for e in city['entities'] if e['entity_id'] == EID)
assert entity['revision'] == 1 and entity['primary_place_id'] == 1692 and entity['aliases'] == ['宽窄巷子']
assert entity == next(e for e in before_city['entities'] if e['entity_id'] == EID)
rows = [m for m in city['mentions'] if m['entityId'] == EID]
ids = sorted({m['raw_note_id'] for m in rows})
assert rows == [m for m in before_city['mentions'] if m['entityId'] == EID]
assert len(rows) == 22 and len(ids) == 21, (len(rows), len(ids))
for nid in ids:
    assert notes[nid] == before_notes[nid], f'笔记{nid}在冻结前后不一致'
quotes = [
    (880, '全天免费、无需预约，直接入园，别信门口黄牛的预约收费骗局'),
    (880, '宽巷子：老成都院落氛围感'),
    (876, '宽窄巷子 商业街'),
    (892, '成都不值得去的景点'),
    (955, '唯一踩雷：宽窄巷子别买吃的！'),
    (957, '比较商业化'),
    (961, '每条街都是去了不踩雷'),
    (882, '宽窄巷子主街商业化偏重，想拍照安静点直接走井巷子'),
    (895, '宽巷子逛院落、窄巷子拍照、井巷子人最少'),
    (912, '锦里小吃溢价高，浅尝就行'),
    (1025, '距离宽窄巷子不远，步行就能前往'),
]
for nid, quote in quotes:
    assert nid in ids and quote in city['notes'][str(nid)]['note_desc'], (nid, quote)

conclusion = ('22条提及/21篇正文已读（note880两条提及）。主体一致：宽巷子、窄巷子、井巷子三条巷子组成的老成都院落'
    '商业街区，全天免费、无需预约、地铁4号线宽窄巷子站；主源1692未改，未新增别名。'
    '负评与劝退全部保留：3504与3758把它列为商业街／不值得去，3746警示门口黄牛预约收费骗局与主街特产溢价，'
    '3816/957/912明确主街商业化偏重、井巷子或小岔巷人少更安静，3996/955提醒别在巷内吃饭或买吃的，'
    '4154/3905只给8.0随缘打卡并建议浅尝。正面体验与院内%Arabica、砖文化墙机位保持。'
    '边界单列：宽巷子、窄巷子、井巷子是同址三条子巷，不拆成三个独立主体，也不把奎星楼街／魁星楼美食街、小通巷、'
    '泡桐树街、宽窄巷子地铁站并入；880的免费/营业9:00–22:00与12小时开放属原作者描述，不核实现行运营政策。'
    '拟隔离待审1条：4116整篇是民宿推荐，正文只有「距离宽窄巷子不远，步行就能前往」的住宿参照，没有街区独立游览文字。'
    '成都其余候选与同城边界继续逐项阅读，本批不做业务修改、不改坐标、不声称全部来源已清。')

item = {'city': '成都', 'entityId': EID, 'name': entity['canonical_name'], 'expectedRevision': entity['revision'],
    'identityRetained': True, 'fullFactsReviewed': False, 'scope': '全实体当前提及全文已读；来源/组成/定位边界分别待治理',
    'mentions': [{'mentionId': m['id'], 'inputHash': m['inputHash'], 'resolution': m['resolution']} for m in rows],
    'reviewedSourceMentionIds': [m['id'] for m in rows],
    'noteEvidence': [{'noteId': nid, 'noteDescSha256': hashlib.sha256(city['notes'][str(nid)]['note_desc'].encode()).hexdigest(),
        'fullFrozenNoteSha256': hashlib.sha256(json.dumps(city['notes'][str(nid)], ensure_ascii=False, sort_keys=True).encode()).hexdigest(),
        'rawNoteSha256': hashlib.sha256(json.dumps(notes[nid], ensure_ascii=False, sort_keys=True).encode()).hexdigest()} for nid in ids],
    'existingImageTextEvidence': [{'noteId': nid, 'rawNoteSha256': hashlib.sha256(json.dumps(notes[nid], ensure_ascii=False, sort_keys=True).encode()).hexdigest(),
        'textImageIndices': [i for i, value in enumerate(notes[nid]['img_analysis'] or []) if isinstance(value, dict) and value.get('has_text')]} for nid in ids],
    'readSnapshotFile': 'snapshot-20261010T031749976332Z/input.json',
    'reusedAfterFullEntityMentionsAndNotesComparison': True,
    'noteQuotes': [{'noteId': nid, 'quote': quote} for nid, quote in quotes],
    'conclusion': conclusion, 'pendingMentionIds': [4116], 'businessMutationByThisRecord': False, 'userAcceptance': False}
assert not any(r['entityId'] == EID for r in record['reviews'])
record['reviews'].append(item)
count = sum(len(r['mentions']) for r in record['reviews'])
assert len(record['reviews']) == 55 and count == 937, (len(record['reviews']), count)
record['limits'] = ('55项/937当前有效提及已读；阅读不等于全来源、同体/组成/定位问题闭合，也不等于各城语义已完成。'
    'batch-120为最新完整验证；广州缺运营输入、鼓浪屿与集美大社缺媒体方案暂缓；未验收、不提交、不归档。')


def write(name, value):
    with (ROOT / name).open('x', encoding='utf-8') as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)


write('seven-cities-semantic-readthrough-30.json', record)
next_evidence = read(ROOT / 'seven-cities-next-evidence-32.json')
next_evidence.update(semanticReadthrough='seven-cities-semantic-readthrough-30.json', nextBatch=122)
next_evidence['remainingReview'][0] = ('成都宽窄巷子民宿参照4116待决（成都缺运营输入的判定同广州，先不建scope）；'
    '广州塔8100/8108/8133/7693与永庆坊7694待决；音乐广场/曾厝垵音乐广场同体与两个旧坐标、'
    '玩月坡海滨商店/设施边界保留；继续成都其余候选及杭州、西安、重庆全文治理。')
next_evidence['nextEvidence'].append({'city': '成都', 'entityId': EID, 'pendingMentionIds': item['pendingMentionIds'],
    'conclusion': conclusion})
write('seven-cities-next-evidence-33.json', next_evidence)
lines = ['# 本轮逐项原文阅读记录', '', record['limits'], '', '| 城市 | 地点 | 当前有效提及 | 结论与待办 |', '| --- | --- | --- | --- |']
for review in record['reviews']:
    lines.append('| ' + ' | '.join([review['city'], review['name'],
        '、'.join(str(m['mentionId']) for m in review['mentions']), review['conclusion'].replace('|', '／')]) + ' |')
lines += ['', '证据：[阅读台账](research/seven-cities-semantic-readthrough-30.json)、[下一证据](research/seven-cities-next-evidence-33.json)。', '']
(ROOT.parent / '七城本轮原文复核.md').write_text('\n'.join(lines), encoding='utf-8')
note = record['limits'] + '新增成都宽窄巷子22条；民宿步行参照1条待决。'
for path in [ROOT.parent / 'task.json', PARENT / 'task.json']:
    task = read(path)
    assert task['status'] == 'in_progress' and task['meta']['sevenCityContinuation']['latestValidatedEntityBatch'] == '120'
    task['notes'] = task['notes'] + ' ' + note
    task['meta']['sevenCityContinuation'].update(
        semanticReadthrough='10-09-attraction-top30-governance/research/seven-cities-semantic-readthrough-30.json',
        workingStage=note, accepted=False)
    path.write_text(json.dumps(task, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
for name in ['进展记录.md', '七城剩余问题.md']:
    with (ROOT.parent / name).open('a', encoding='utf-8') as handle:
        handle.write('\n## 成都宽窄巷子阅读断点\n\n' + note + '\n\n入口：[下一证据](research/seven-cities-next-evidence-33.json)。\n')
print(json.dumps({'readEntities': len(record['reviews']), 'currentMentions': count, 'new': 1,
    'newMentions': 22, 'pending': item['pendingMentionIds'], 'accepted': False}, ensure_ascii=False))
