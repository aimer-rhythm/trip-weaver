"""固化西安钟楼24条实际全文阅读。"""
import hashlib
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parent
PARENT = ROOT.parents[1] / '10-06-place-identity-governance'
read = lambda p: json.loads(p.read_bytes())
record = read(ROOT / 'seven-cities-semantic-readthrough-42.json')
raw = (ROOT / record['snapshotFile']).read_bytes()
assert hashlib.sha256(raw).hexdigest() == record['snapshotSha256']
city = next(c for c in json.loads(raw)['cities'] if c['city'] == '西安')
before_city = next(c for c in read(ROOT / 'snapshot-20261010T025803181559Z/input.json')['cities'] if c['city'] == '西安')
assert city['notes'] == before_city['notes'], '既有笔记在冻结前后不一致'
notes = {n['id']: n for n in city['governanceState']['rawNotes']}
before_notes = {n['id']: n for n in before_city['governanceState']['rawNotes']}
EID, SID = '4e4defe90dcdd9dc78c1ef92cc904def', 5558
entity = next(e for e in city['entities'] if e['entity_id'] == EID)
assert entity == next(e for e in before_city['entities'] if e['entity_id'] == EID)
assert entity['revision'] == 3 and entity['primary_place_id'] == SID and entity['aliases'] == ['西安钟楼', '钟楼']
rows = [m for m in city['mentions'] if m['entityId'] == EID]
assert rows == [m for m in before_city['mentions'] if m['entityId'] == EID]
ids = sorted({m['raw_note_id'] for m in rows})
assert len(rows) == 24 and len(ids) == 22, (len(rows), len(ids))
for nid in ids:
    assert notes[nid] == before_notes[nid], f'笔记{nid}在冻结前后不一致'
quotes = [
    (2625, '钟楼 → 鼓楼 → 回民街/洒金桥 → 书院门/碑林 → 永宁门城墙'),
    (2629, 'Day1：西安城墙（54r）→西安钟楼（50r）'),
    (2633, '顺带看钟楼夜景'), (2634, '1、钟楼和鼓楼挨一起的'),
    (2646, '推荐路线[二R]：德福巷→西安钟楼→西安鼓楼'),
    (2648, '推荐到开元商场5楼的观景台，俯拍钟楼鼓楼同框'),
    (2695, '灯火从钟楼亮起'), (2701, '琉璃瓦在暮色中缓缓亮起'),
    (2703, '灯光沿着钟楼的轮廓一盏盏亮起'),
    (2711, 'Day3️⃣：鼓楼——钟楼——城墙——赳赳大秦'),
    (2716, '图2️⃣：霸王🍵姬钟楼旗舰店3层窗景'),
    (2719, '图1｜钟楼 · 开元商场楼顶观景台（免费）'),
    (2721, '🏯西安钟楼开灯时间'), (2724, '来了几次西安，每次必拍的都是钟楼'),
    (2733, '📍图8：开元商场楼顶观景台（钟楼）'),
    (2739, '站在西安城市中轴线上，俯瞰四条大街全景'),
]
for nid, quote in quotes:
    assert nid in ids and quote in city['notes'][str(nid)]['note_desc'], (nid, quote)

conclusion = (
    '24条提及/22篇正文已读（图片文字另核）；该主体此前已有治理修订，当前revision=3、别名含「钟楼」。'
    '主体一致：位于西安城市中轴线十字的钟楼地标，夜晚亮灯后是夜景核心机位（夏季周日-周四19:30-23:00、'
    '周五周六至24:00，冬季提前至19:00），登楼需与鼓楼联票50元（单买各35元），20:30停止检票、21:00闭园；'
    '最常被推荐的免费机位是开元商城5楼/7楼观景台与霸王茶姬2-3楼窗景，可俯拍钟鼓楼同框；主源5558未改。'
    '负评与限定保留：2634写「钟楼和鼓楼挨一起的，拍拍照片代表去过了就可以了，没必要花钱登楼」；'
    '2628写「夜景打卡拍照，个人感觉没必要买票上去，开元商城有观景平台」；2692把「钟楼/鼓楼」列为精华景点同时'
    '写「钟楼鼓楼别登楼，去开元商城5楼观景台免费拍照」；2721写明「每年3月28日地球一小时20:30-21:30熄灯」。'
    '边界单列：钟楼与鼓楼是两座不同建筑（原文反复写「挨一起」），开元商城、霸王茶姬旗舰店、钟楼地铁站、'
    '回民街、城墙各有独立主体；本轮不合并钟鼓楼、不把商场观景台并入钟楼、不改坐标，登楼票价与亮灯时刻按原文保留。')

item = {'city': '西安', 'entityId': EID, 'name': entity['canonical_name'], 'expectedRevision': entity['revision'],
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
    'conclusion': conclusion, 'pendingMentionIds': [], 'businessMutationByThisRecord': False, 'userAcceptance': False}
assert not any(r['entityId'] == EID for r in record['reviews'])
record['reviews'].append(item)
count = sum(len(r['mentions']) for r in record['reviews'])
assert len(record['reviews']) == 112 and count == 1761, (len(record['reviews']), count)
record['limits'] = ('112项/1761当前有效提及已读；阅读不等于全来源、同体/组成/定位问题闭合，也不等于各城语义已完成。'
    'batch-120为最新完整验证；广州缺运营输入、鼓浪屿与集美大社缺媒体方案暂缓；未验收、不提交、不归档。')


def write(name, value):
    with (ROOT / name).open('x', encoding='utf-8') as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)


write('seven-cities-semantic-readthrough-43.json', record)
next_evidence = read(ROOT / 'seven-cities-next-evidence-45.json')
next_evidence.update(semanticReadthrough='seven-cities-semantic-readthrough-43.json', nextBatch=122)
next_evidence['remainingReview'][0] = ('西安已读钟楼，继续城墙、大唐不夜城、大雁塔、鼓楼、兵马俑、小雁塔、陕历博、永宁门、书院门、'
    '碑林、德福巷、华清宫、湘子庙、唐大慈恩寺遗址公园、大唐芙蓉园、广仁寺、西安博物院、大兴善寺、水陆庵、太阳庙门、'
    '少华山、骊山、丽山园、湘子庙街、古观音禅寺、西五台云居寺、香积寺；task-3要求单列永宁门/城楼/城墙机位review426与夜市review382。')
next_evidence['nextEvidence'].append({'city': '西安', 'entityId': EID, 'pendingMentionIds': [],
    'conclusion': conclusion})
write('seven-cities-next-evidence-46.json', next_evidence)
lines = ['# 本轮逐项原文阅读记录', '', record['limits'], '', '| 城市 | 地点 | 当前有效提及 | 结论与待办 |', '| --- | --- | --- | --- |']
for review in record['reviews']:
    lines.append('| ' + ' | '.join([review['city'], review['name'],
        '、'.join(str(m['mentionId']) for m in review['mentions']), review['conclusion'].replace('|', '／')]) + ' |')
lines += ['', '证据：[阅读台账](research/seven-cities-semantic-readthrough-43.json)、[下一证据](research/seven-cities-next-evidence-46.json)。', '']
(ROOT.parent / '七城本轮原文复核.md').write_text('\n'.join(lines), encoding='utf-8')
note = record['limits'] + '新增西安钟楼24条（首条为西安，后续按城继续）。'
for path in [ROOT.parent / 'task.json', PARENT / 'task.json']:
    task = read(path)
    assert task['status'] == 'in_progress'
    task['notes'] = task['notes'] + ' ' + note
    task['meta']['sevenCityContinuation'].update(
        semanticReadthrough='10-09-attraction-top30-governance/research/seven-cities-semantic-readthrough-43.json',
        workingStage=note, accepted=False)
    path.write_text(json.dumps(task, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
for name in ['进展记录.md', '七城剩余问题.md']:
    with (ROOT.parent / name).open('a', encoding='utf-8') as handle:
        handle.write('\n## 西安钟楼阅读断点\n\n' + note + '\n\n入口：[下一证据](research/seven-cities-next-evidence-46.json)。\n')
print(json.dumps({'readEntities': len(record['reviews']), 'currentMentions': count, 'xianRead': 3,
    'accepted': False}, ensure_ascii=False))
