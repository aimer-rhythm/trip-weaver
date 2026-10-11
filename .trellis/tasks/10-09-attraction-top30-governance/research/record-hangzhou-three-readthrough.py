"""固化杭州西湖断桥25条、法喜寺23条、拱宸桥22条实际全文阅读。"""
import hashlib
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parent
PARENT = ROOT.parents[1] / '10-06-place-identity-governance'
read = lambda p: json.loads(p.read_bytes())
record = read(ROOT / 'seven-cities-semantic-readthrough-37.json')
raw = (ROOT / record['snapshotFile']).read_bytes()
assert hashlib.sha256(raw).hexdigest() == record['snapshotSha256']
city = next(c for c in json.loads(raw)['cities'] if c['city'] == '杭州')
before_city = next(c for c in read(ROOT / 'snapshot-20261010T025803181559Z/input.json')['cities'] if c['city'] == '杭州')
assert city['notes'] == before_city['notes'], '既有笔记在冻结前后不一致'
notes = {n['id']: n for n in city['governanceState']['rawNotes']}
before_notes = {n['id']: n for n in before_city['governanceState']['rawNotes']}
NO_CHANGE = '本批不改字段、不重排。'

cases = [
    ('072594881c58508fb7b76c320f3c8c20', 4135, 2, 25, [9449],
     [(1966, '人挤人的断桥'), (2150, '📍西湖断桥'), (2168, '拍白堤+宝石山同框机位，早去避开人海'),
      (1988, '早上 8 点前到断桥，人少好拍照'), (2033, '清晨或傍晚去断桥最舒服'), (2004, '✖️断桥'),
      (2145, '别死磕断桥、灵隐❗挤到寸步难行'), (2166, '断桥、雷峰塔、三潭印月都能步行到')],
     '25条/25篇正文已读（图片文字另核）；该主体此前已有治理修订，当前revision=2、别名含断桥、断桥残雪。'
     '主体一致：西湖十景之一的断桥残雪，白堤步道起点，可拍白堤与宝石山同框、傍晚看晚霞与保俶塔，'
     '周边串联北山街、孤山、平湖秋月、西泠桥与大石佛院造像；主源4135未改。'
     '负评与限定全部保留：2004把断桥列入「不值得去的景点」清单；2145写「别死磕断桥、灵隐❗挤到寸步难行」；'
     '1966写「人挤人的断桥、排队登雷峰塔」都不是推荐选项；1988/2033/8651给出「早8点前、清晨或傍晚、晚上步行」的错峰建议。'
     '边界单列：白堤、孤山、平湖秋月、北山街、宝石山、西泠桥、大石佛院造像、湖滨与断桥地铁站各自独立，'
     '断桥作为西湖十景之一独立成行，不与西湖本体或白堤合并；本轮不新建组成关系、不改坐标。'
     '拟隔离待审1条：9449所在整篇为西湖边酒店广告，断桥只作为「步行可达」的住宿参照，无独立游览描述。'),
    ('e20edd33a6085a9108fa1a9d29bfbf08', 4008, 3, 23, [],
     [(2003, '法喜寺黄墙拍照超出片'), (2168, '拍网红黄墙+“莫向外求”石刻，求御守超灵'),
      (2170, '法喜寺：黄墙出片，500年玉兰盛开，求御守吃素面'), (2172, '灵隐寺、法喜寺旺季无现场票，要提前线上约'),
      (2020, '可可爱爱的菩提莲花、软萌小猫爪'), (2200, '两寺之间有 10 块钱的景区接驳车')],
     '23条提及/22篇正文已读（图片文字另核）；该主体此前已有治理修订，当前revision=3、别名含法喜讲寺。'
     '主体一致：上天竺法喜讲寺，依山而建、白墙黛瓦，网红黄墙与「莫向外求」石刻是主要拍照点，'
     '可求御守、吃素面，寺内手串（菩提莲花、小猫爪、草莓晶）与灵隐、永福、韬光、法镜、法净各有特色；'
     '与灵隐寺之间有约10元景区接驳车，从法喜寺回程往灵隐方向为下坡；主源4008未改。'
     '限定保留：2172与9647明确「灵隐、法喜旺季无现场票，须提前线上预约」；8881/8580等把它安排在灵隐之后的第二天行程。'
     '边界单列：灵隐寺、永福寺、韬光寺、法镜寺、法净寺、云栖竹径、龙井村、梅家坞与法喜寺各自独立；'
     '法喜寺后山步道是徒步入口而非新主体；本轮不合并、不改坐标、不新增组成关系。' + NO_CHANGE),
    ('d7bd1ad6688c4f1a670eabe2d7a6e9f2', 4010, 1, 22, [],
     [(2236, '大运河南端的代表性桥梁'), (2239, '明代古石拱桥，登桥看运河全景'),
      (2244, '一座拱宸桥，半部杭州史'), (2054, '运河夜游的标志性终点'), (2241, '漫步这座运河标志性古桥')],
     '22条/22篇正文已读（图片文字另核）。主体一致：京杭大运河南端标志，明代石拱桥，杭州现存最高最长的三孔古石桥，'
     '桥身可看两岸老街与运河流水，桥底两侧有镇水蚣蝮，晚间亮轮廓灯；水上巴士1号线（3元）自武林门直达拱宸桥为终点站，'
     '地铁5号线大运河站/拱宸桥东站可达；主源4010未改。'
     '限定保留：「一座拱宸桥，半部杭州史」「人少清静」等属原作者描述；桥面夜游与水上巴士班次按原文保留，不核实现行政策。'
     '边界单列：桥西历史街区、京杭大运河博物馆、中国刀剪剑/伞/扇/工艺美术博物馆、小河公园、小河直街、'
     '大兜路历史文化街区、香积寺、大运河紫檀博物馆与拱宸桥各自独立；'
     '拱宸桥是桥体本身，不与其西侧博物馆群或小河公园合并；本轮不新建组成关系、不改坐标。' + NO_CHANGE),
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
    new_reviews.append({'city': '杭州', 'entityId': eid, 'name': entity['canonical_name'],
        'expectedRevision': entity['revision'], 'identityRetained': True, 'fullFactsReviewed': False,
        'scope': '全实体当前提及全文已读；来源/组成/定位边界分别待治理',
        'mentions': [{'mentionId': m['id'], 'inputHash': m['inputHash'], 'resolution': m['resolution']} for m in rows],
        'reviewedSourceMentionIds': [m['id'] for m in rows],
        'noteEvidence': [{'noteId': nid, 'noteDescSha256': hashlib.sha256(city['notes'][str(nid)]['note_desc'].encode()).hexdigest(),
            'fullFrozenNoteSha256': digest(city['notes'][str(nid)]), 'rawNoteSha256': digest(notes[nid])} for nid in ids],
        'existingImageTextEvidence': [{'noteId': nid, 'rawNoteSha256': digest(notes[nid]),
            'textImageIndices': [i for i, value in enumerate(notes[nid]['img_analysis'] or []) if isinstance(value, dict) and value.get('has_text')]} for nid in ids],
        'readSnapshotFile': 'snapshot-20261010T031749976332Z/input.json',
        'reusedAfterFullEntityMentionsAndNotesComparison': True,
        'noteQuotes': [{'noteId': nid, 'quote': quote} for nid, quote in quotes],
        'conclusion': conclusion, 'pendingMentionIds': pending,
        'businessMutationByThisRecord': False, 'userAcceptance': False})

record['reviews'].extend(new_reviews)
count = sum(len(r['mentions']) for r in record['reviews'])
assert len(record['reviews']) == 90 and count == 1441, (len(record['reviews']), count)
record['limits'] = ('90项/1441当前有效提及已读；阅读不等于全来源、同体/组成/定位问题闭合，也不等于各城语义已完成。'
    'batch-120为最新完整验证；广州缺运营输入、鼓浪屿与集美大社缺媒体方案、杭州住宿参照待决；未验收、不提交、不归档。')


def write(name, value):
    with (ROOT / name).open('x', encoding='utf-8') as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)


write('seven-cities-semantic-readthrough-38.json', record)
next_evidence = read(ROOT / 'seven-cities-next-evidence-40.json')
next_evidence.update(semanticReadthrough='seven-cities-semantic-readthrough-38.json', nextBatch=122)
next_evidence['remainingReview'][0] = ('杭州已读9个主体，继续龙井村、虎跑公园、云栖竹径、花港观鱼、西溪湿地、柳浪闻莺、苏堤、九溪烟树、'
    '三潭印月、茅家埠、乌龟潭、大兜路、十里琅珰、浴鹄湾、九溪十八涧、良渚古城遗址公园、桥西历史街区、杨公堤、南宋御街、'
    '杭州植物园、香积寺；杭州待决6条住宿参照：灵隐寺9338、西湖9335/9448/9216、曲院风荷9344、雷峰塔9450、西湖断桥9449。')
for item in new_reviews:
    next_evidence['nextEvidence'].append({'city': '杭州', 'entityId': item['entityId'],
        'pendingMentionIds': item['pendingMentionIds'], 'conclusion': item['conclusion']})
write('seven-cities-next-evidence-41.json', next_evidence)
lines = ['# 本轮逐项原文阅读记录', '', record['limits'], '', '| 城市 | 地点 | 当前有效提及 | 结论与待办 |', '| --- | --- | --- | --- |']
for review in record['reviews']:
    lines.append('| ' + ' | '.join([review['city'], review['name'],
        '、'.join(str(m['mentionId']) for m in review['mentions']), review['conclusion'].replace('|', '／')]) + ' |')
lines += ['', '证据：[阅读台账](research/seven-cities-semantic-readthrough-38.json)、[下一证据](research/seven-cities-next-evidence-41.json)。', '']
(ROOT.parent / '七城本轮原文复核.md').write_text('\n'.join(lines), encoding='utf-8')
note = record['limits'] + '新增杭州西湖断桥25条、法喜寺23条、拱宸桥22条；西湖断桥1条住宿参照待决。'
for path in [ROOT.parent / 'task.json', PARENT / 'task.json']:
    task = read(path)
    assert task['status'] == 'in_progress' and task['meta']['sevenCityContinuation']['latestValidatedEntityBatch'] == '120'
    task['notes'] = task['notes'] + ' ' + note
    task['meta']['sevenCityContinuation'].update(
        semanticReadthrough='10-09-attraction-top30-governance/research/seven-cities-semantic-readthrough-38.json',
        workingStage=note, accepted=False)
    path.write_text(json.dumps(task, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
for name in ['进展记录.md', '七城剩余问题.md']:
    with (ROOT.parent / name).open('a', encoding='utf-8') as handle:
        handle.write('\n## 杭州三主体阅读断点\n\n' + note + '\n\n入口：[下一证据](research/seven-cities-next-evidence-41.json)。\n')
print(json.dumps({'readEntities': len(record['reviews']), 'currentMentions': count, 'newEntities': 3,
    'newMentions': 70, 'hangzhouRead': 9, 'pending': [r['name'] for r in new_reviews if r['pendingMentionIds']],
    'accepted': False}, ensure_ascii=False))
