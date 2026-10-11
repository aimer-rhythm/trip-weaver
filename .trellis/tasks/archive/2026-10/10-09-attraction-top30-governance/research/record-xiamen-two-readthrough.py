"""固化厦门钟鼓索道18条与日光岩17条实际全文阅读。"""
import hashlib
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parent
PARENT = ROOT.parents[1] / '10-06-place-identity-governance'
read = lambda p: json.loads(p.read_bytes())
record = read(ROOT / 'seven-cities-semantic-readthrough-43.json')
raw = (ROOT / record['snapshotFile']).read_bytes()
assert hashlib.sha256(raw).hexdigest() == record['snapshotSha256']
city = next(c for c in json.loads(raw)['cities'] if c['city'] == '厦门')
before_city = next(c for c in read(ROOT / 'snapshot-20261010T025803181559Z/input.json')['cities'] if c['city'] == '厦门')
assert city['notes'] == before_city['notes'], '既有笔记在冻结前后不一致'
notes = {n['id']: n for n in city['governanceState']['rawNotes']}
before_notes = {n['id']: n for n in before_city['governanceState']['rawNotes']}
SCOPE = '全实体当前提及全文已读；来源/组成/定位边界分别待治理'
NO_CHANGE = '本批不改字段、不重排。'

cases = [
    ('ca9e08dd318c57834d8245a7784de591', 2652, 1, 18, [],
     [(1246, '厦门真的太适合松弛度假了'), (1249, '终于整理出不赶路、不踩雷的厦门懒人旅行'),
      (1279, '去了厦门十几次了'), (1471, '厦门的浪漫海占一半'), (1544, '厦门真的很适合慢慢逛，但景点分散＋海岸线长')],
     '18条/18篇正文已读（图片文字另核）。主体一致：万石植物园旁的观光索道（植物园西门步行数分钟可达），'
     '开放式缆车往返约40分钟，可俯瞰植物园、双子塔与厦门城市山海，日落时段最佳，'
     '原文票价80元往返、约8:30-17:30开放，需提前购票或现场排队（网上约不到可现场蹲票）；主源2652未改。'
     '负评与限定保留：1279写「怕高的别坐第一排透明舱」，并把钟鼓索道列入「一定去」7项之一；'
     '1281写「来回40分钟俯瞰双子塔和鼓浪屿，日落那段时间景色封顶」；'
     '1289写「下午3点至5点光线最佳」与「建议下午4点后去、能见度高的天气是出片关键」；'
     '1259写「需8:30后开放，傍晚17:30前乘坐为宜」。票价、时长与开放时刻按原文保留，不核实现行政策。'
     '边界单列：厦门园林植物园、南普陀寺、厦门大学、中山公园与钟鼓索道各自独立；'
     '索道是独立交通观光设施，不并入植物园主体，' + NO_CHANGE),
    ('c819d655bed408562a9b1d3767ae332d', 2702, 3, 17, [],
     [(1569, '日光岩（鼓浪屿）— 92.7 米'), (1325, '日光岩（门票50/人)'), (1325, '顶峰的景色非常好看'),
      (1504, '晴天的日光岩一定要上！'), (1331, '日光岩：鼓浪屿最高点，爬上去能俯瞰整个岛和厦门，这段最值'),
      (1353, '日光岩、月光岩⛰️：俯瞰“万国建筑博物馆”'), (1328, '都说鼓浪屿不值得')],
     '17条/17篇正文已读（图片文字另核）；该主体此前已有治理修订，当前revision=3、别名含「日光岩（鼓浪屿）」。'
     '主体一致：鼓浪屿制高点（海拔92.7米），登顶可俯瞰全岛红瓦与海景、远望厦门本岛，是岛上最被推荐的点位，'
     '门票原文50元、需步行上山；主源2702未改。'
     '负评与限定保留：1340写「别中午爬！晒到崩溃」，建议傍晚登顶；'
     '1504写「晴天的日光岩一定要上，是全程最值得看的风景」，但「70的门票还是略贵了点」，并说明最高观景台容纳有限需短暂排队；'
     '1328写「都说鼓浪屿不值得，因为只能步行太累了，我感觉还好」；1325写「需要爬点山」；'
     '1353给出接驳车路线（菽庄花园—三丘田半程20元、环岛50元）。票价与排队情况按原文保留，不核实现行政策。'
     '边界单列：月光岩、郑成功纪念馆（在日光岩景区范围内但另计）、鼓浪屿沙滩、菽庄花园、皓月园、'
     '八卦楼、管风琴艺术中心与日光岩各自独立；日光岩是鼓浪屿内的独立景点，本轮不并入鼓浪屿主体或厦门园林植物园、'
     '不新建组成关系、不改坐标。' + NO_CHANGE),
]

new_reviews = []
digest = lambda value: hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
for eid, sid, revision, total, pending, quotes, conclusion in cases:
    assert not any(r['entityId'] == eid for r in record['reviews'])
    entity = next(e for e in city['entities'] if e['entity_id'] == eid)
    assert entity == next(e for e in before_city['entities'] if e['entity_id'] == eid)
    assert entity['revision'] == revision and entity['primary_place_id'] == sid
    rows = [m for m in city['mentions'] if m['entityId'] == eid]
    assert rows == [m for m in before_city['mentions'] if m['entityId'] == eid]
    ids = sorted({m['raw_note_id'] for m in rows})
    assert len(rows) == total, (entity['canonical_name'], len(rows))
    for nid in ids:
        assert notes[nid] == before_notes[nid], f'笔记{nid}在冻结前后不一致'
    for nid, quote in quotes:
        assert nid in ids and quote in city['notes'][str(nid)]['note_desc'], (entity['canonical_name'], nid, quote)
    new_reviews.append({'city': '厦门', 'entityId': eid, 'name': entity['canonical_name'],
        'expectedRevision': entity['revision'], 'identityRetained': True, 'fullFactsReviewed': False, 'scope': SCOPE,
        'mentions': [{'mentionId': m['id'], 'inputHash': m['inputHash'], 'resolution': m['resolution']} for m in rows],
        'reviewedSourceMentionIds': [m['id'] for m in rows],
        'noteEvidence': [{'noteId': nid, 'noteDescSha256': hashlib.sha256(city['notes'][str(nid)]['note_desc'].encode()).hexdigest(),
            'fullFrozenNoteSha256': digest(city['notes'][str(nid)]), 'rawNoteSha256': digest(notes[nid])} for nid in ids],
        'existingImageTextEvidence': [{'noteId': nid, 'rawNoteSha256': digest(notes[nid]),
            'textImageIndices': [i for i, value in enumerate(notes[nid]['img_analysis'] or []) if isinstance(value, dict) and value.get('has_text')]} for nid in ids],
        'readSnapshotFile': 'snapshot-20261010T031749976332Z/input.json',
        'reusedAfterFullEntityMentionsAndNotesComparision': True,
        'reusedAfterFullEntityMentionsAndNotesComparison': True,
        'noteQuotes': [{'noteId': nid, 'quote': quote} for nid, quote in quotes],
        'conclusion': conclusion, 'pendingMentionIds': pending,
        'businessMutationByThisRecord': False, 'userAcceptance': False})

record['reviews'].extend(new_reviews)
count = sum(len(r['mentions']) for r in record['reviews'])
assert len(record['reviews']) == 114 and count == 1796, (len(record['reviews']), count)
record['limits'] = ('114项/1796当前有效提及已读；阅读不等于全来源、同体/组成/定位问题闭合，也不等于各城语义已完成。'
    'batch-120为最新完整验证；广州缺运营输入、鼓浪屿与集美大社缺媒体方案暂缓；未验收、不提交、不归档。')


def write(name, value):
    with (ROOT / name).open('x', encoding='utf-8') as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)


write('seven-cities-semantic-readthrough-44.json', record)
next_evidence = read(ROOT / 'seven-cities-next-evidence-46.json')
next_evidence.update(semanticReadthrough='seven-cities-semantic-readthrough-44.json', nextBatch=122)
next_evidence['remainingReview'][0] = ('厦门已读钟鼓索道、日光岩，继续菽庄花园、集美大社、屿见闽南、幸福路、嘉庚公园、皓月园、溪头下、'
    '彩虹沙滩、鼓浪屿管风琴艺术中心、山海步道、上李水库、海湾公园、盼归塔；'
    '西安已读钟楼，继续城墙（review426机位）、大唐不夜城（review382夜市）等26个主体。')
for item in new_reviews:
    next_evidence['nextEvidence'].append({'city': '厦门', 'entityId': item['entityId'],
        'pendingMentionIds': item['pendingMentionIds'], 'conclusion': item['conclusion']})
write('seven-cities-next-evidence-47.json', next_evidence)
lines = ['# 本轮逐项原文阅读记录', '', record['limits'], '', '| 城市 | 地点 | 当前有效提及 | 结论与待办 |', '| --- | --- | --- | --- |']
for review in record['reviews']:
    lines.append('| ' + ' | '.join([review['city'], review['name'],
        '、'.join(str(m['mentionId']) for m in review['mentions']), review['conclusion'].replace('|', '／')]) + ' |')
lines += ['', '证据：[阅读台账](research/seven-cities-semantic-readthrough-44.json)、[下一证据](research/seven-cities-next-evidence-47.json)。', '']
(ROOT.parent / '七城本轮原文复核.md').write_text('\n'.join(lines), encoding='utf-8')
note = record['limits'] + '新增厦门钟鼓索道18条、日光岩17条。'
for path in [ROOT.parent / 'task.json', PARENT / 'task.json']:
    task = read(path)
    assert task['status'] == 'in_progress'
    task['notes'] = task['notes'] + ' ' + note
    task['meta']['sevenCityContinuation'].update(
        semanticReadthrough='10-09-attraction-top30-governance/research/seven-cities-semantic-readthrough-44.json',
        workingStage=note, accepted=False)
    path.write_text(json.dumps(task, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
for name in ['进展记录.md', '七城剩余问题.md']:
    with (ROOT.parent / name).open('a', encoding='utf-8') as handle:
        handle.write('\n## 厦门钟鼓索道与日光岩阅读断点\n\n' + note + '\n\n入口：[下一证据](research/seven-cities-next-evidence-47.json)。\n')
print(json.dumps({'readEntities': len(record['reviews']), 'currentMentions': count, 'xiamenRead': 17, 'accepted': False}, ensure_ascii=False))
