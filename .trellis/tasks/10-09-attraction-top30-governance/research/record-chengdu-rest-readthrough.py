"""固化成都剩余12个主体的29条实际全文阅读，完成成都全城阅读覆盖。"""
import hashlib
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parent
PARENT = ROOT.parents[1] / '10-06-place-identity-governance'
read = lambda p: json.loads(p.read_bytes())
record = read(ROOT / 'seven-cities-semantic-readthrough-33.json')
raw = (ROOT / record['snapshotFile']).read_bytes()
assert hashlib.sha256(raw).hexdigest() == record['snapshotSha256']
city = next(c for c in json.loads(raw)['cities'] if c['city'] == '成都')
before_city = next(c for c in read(ROOT / 'snapshot-20261010T025803181559Z/input.json')['cities'] if c['city'] == '成都')
assert city['notes'] == before_city['notes'], '既有笔记在冻结前后不一致'
notes = {n['id']: n for n in city['governanceState']['rawNotes']}
before_notes = {n['id']: n for n in before_city['governanceState']['rawNotes']}
SCOPE = '全实体当前提及全文已读；来源/组成/定位边界分别待治理'
NO_CHANGE = '本批无拟隔离提及，不改字段、不重排。'

cases = [
    ('b623859a239f7c5c7c9fea1ce4365a70', 1900, 4, [],
     [(921, '👉熊猫谷'), (904, '中午灌县古城或南桥吃饭'), (945, '📍Day4：熊猫谷→仰天窝广场→灌县古城→都江堰→南桥')],
     '4条/4篇正文已读。主体一致：与都江堰相邻的熊猫观赏园区，可近距离看大熊猫与小熊猫，作者普遍建议顶门早去、人少熊猫活跃，'
     '游玩2-3小时；多帖的门票55元与8:00-18:00属原作者描述，不核实现行政策。边界单列：与成都大熊猫繁育研究基地是两个不同园区，'
     '945把熊猫谷→仰天窝广场→灌县古城→都江堰→南桥串成整条行程，各点不合并。' + NO_CHANGE),
    ('c53303041a21a3d538f513c3b8549137', 1869, 4, [],
     [(1014, '《大鱼海棠》同款客家土楼！红灯笼+环形建筑'), (1014, '⚠️周一闭馆！不要跑空啦！'),
      (1016, '这个圆形的客家土楼确实很出片'), (1017, '✅博客楼二楼边角回廊')],
     '4条提及/3篇正文已读。主体一致：洛带古镇内的圆形客家土楼（《大鱼海棠》同款），红灯笼与环形建筑为主打卡点，'
     '周一闭馆；主源1869未改。负评保留：1016整篇是对洛带古镇商业化的负评，同时明确「唯一的安慰就是那个博客楼」、'
     '只拍楼别逛街，该立场与本主体的正面拍照体验并存，不因同篇负评清除博客楼身份。'
     '边界单列：博客楼位于洛带古镇之内，与四方塔、博客小镇、七十二院、五凤楼、洛带大字墙、金龙长城同为古镇内点位；'
     '洛带古镇、四大会馆各为独立对象，本轮不新建组成关系、不改坐标。' + NO_CHANGE),
    ('1230fc10ede026b790089fdae1636d05', 1685, 3, [4135],
     [(876, '文殊坊是个寺庙没进去 外面红墙很多人打卡'), (926, '文殊院比文殊坊更值得专门去'),
      (1026, '空隐殊院 | 文殊坊试睡体验官招募')],
     '3条/3篇正文已读。主体一致：与文殊院相邻的历史文化街区，红墙等外观打卡点多；主源1685未改。'
     '负评保留：926同帖明确「文殊院比文殊坊更值得专门去」，876只在外围拍红墙、未入内。'
     '边界单列：文殊院与文殊坊是两个对象，本轮不合并；926的对比结论登记为原作者体感，不据此改任何字段。'
     '拟隔离待审1条：4135整篇为空隐禅院民宿试睡招募，正文只有「坐落于文殊坊景区之内」的住宿参照，无街区独立游览文字；'
     '该民宿招募帖同时给出春熙路4137与文殊院4136两条同类参照，一并待决。'),
    ('06e9472910fd74264169c40bf4bcf179', 1701, 2, [],
     [(882, 'Day1：春熙路→IFS国金→太古里→文殊院→东门码头→九眼桥'), (953, 'day1：春熙路→ifs国金→太古里→文殊院→东门码头→九眼桥')],
     '2条/2篇正文已读。主体一致：锦江夜游线路上的码头节点，被两条Day1路线安排在文殊院之后、九眼桥之前；'
     '主源1701未改，无独立游览描述以外的负评。边界单列：与九眼桥、文殊院、锦江夜游船码头（天字码头等）各自独立，' + NO_CHANGE),
    ('158823e73d49619475aa595299f5ef3c', 1926, 2, [],
     [(900, '永陵：门票要20的五代陵墓'), (944, '如果有时间可以去成都的永陵看看，首批国保')],
     '2条/2篇正文已读。主体一致：五代前蜀王建墓（永陵），首批全国重点文物保护单位，门票20元，'
     '作者提示「外面不用付钱的公园桂花很香」；主源1926未改。'
     '身份边界待核（本批只读不改）：同城另有「永陵博物馆」主体，891把两个名称都写作同一处（永陵博物馆：门票20、地上陵墓、24乐伎实物），'
     '两主体疑为同址同体的博物馆与陵墓关系，须另行按正式身份流程审核并给出结论，本轮不合并、不改坐标、不声称已闭合。' + NO_CHANGE),
    ('25b46c3a77aecd69cdcfb9760eb1e274', 1902, 2, [],
     [(904, '中午灌县古城或南桥吃饭'), (945, '📍Day4：熊猫谷→仰天窝广场→灌县古城→都江堰→南桥')],
     '2条/2篇正文已读。主体一致：都江堰景区旁的古城片区，原文作为行程中途就餐与顺路游览点；主源1902未改。'
     '边界单列：与都江堰、南桥、离堆公园、仰天窝广场各自独立，945整条线路串联但不合并。' + NO_CHANGE),
    ('39e3379a5b08731446bb248722ecd6c2', 1903, 2, [],
     [(904, '中午灌县古城或南桥吃饭'), (945, '📍Day4：熊猫谷→仰天窝广场→灌县古城→都江堰→南桥')],
     '2条/2篇正文已读。主体一致：都江堰景区内的廊桥，夜景（蓝眼泪）与就餐被多帖提及，安排在都江堰行程末段；'
     '主源1903未改。边界单列：南桥属都江堰景区范围内，与灌县古城、离堆公园、仰天窝广场各自独立；'
     '本轮不新建正式组成关系、不改坐标、不确认亮灯时间。' + NO_CHANGE),
    ('417cb731eabc94c663cda20060b48c4e', 1873, 2, [],
     [(1014, '湖广会馆、江西会馆、广东会馆、川北会馆都是由清朝时期的客家人修建，岭南风情雕梁画栋，值得一逛！'),
      (1017, '▫️四大会馆＝人文精华')],
     '2条/2篇正文已读；该主体此前已有治理修订，当前revision=2。主体一致：洛带古镇内的湖广、江西、广东、川北四座清代客家会馆，'
     '原文明确其百年木雕戏台与天井古建是「人文精华，比网红土楼更值得细细品读」；主源1873未改。'
     '边界单列：四大会馆位于洛带古镇之内，与博客楼、五凤楼、七十二院、「一街七巷」各自独立；'
     '成都市区另有湖广会馆等同类名称的独立对象时须另行核对，本轮只读不改、不新建组成关系。' + NO_CHANGE),
    ('905fec24f1cf1539e9805727eca0b557', 1792, 2, [],
     [(891, '永陵博物馆：门票20，野猫多，地上陵墓有特色'), (947, '永陵博物馆地宫20元，综合馆是免费的，现场买票就行，不用抢')],
     '2条/2篇正文已读。主体一致：王建墓（永陵）的博物馆，地宫20元、综合馆免费、无需预约现场购票，'
     '地上陵墓、24乐伎实物与野猫是原文看点；主源1792未改。'
     '身份边界待核（本批只读不改）：同城另有「永陵」主体，891与900把两个名称都指向同一处五代陵墓，'
     '两主体疑为同址同体，须另行按正式身份流程审核，本轮不合并、不改坐标。'
     '开放时间与票价按原文保留，不核实现行政策。' + NO_CHANGE),
    ('edd7d3e90ac126f63ccbd66b534f9f33', 1988, 2, [],
     [(947, '安仁古镇本身免费，部分展馆会单独收费，全天开放'), (1015, '安仁古镇是成都唯一的一个5A级古镇景区')],
     '2条/2篇正文已读。主体一致：成都唯一的5A级古镇，民国风中西混搭建筑与有轨电车、公馆群落、密集博物馆，'
     '青石板小巷安静适合漫步；主源1988未改。限定保留：947写明古镇免费但刘氏庄园、建川博物馆等展馆单独收费与预约，'
     '1015同时对洛带、平乐、西来等古镇给出对比评价。边界单列：刘氏庄园博物馆、建川博物馆、有轨电车与安仁古镇各为独立对象，'
     '本轮不合并、不改坐标、不新增展馆主体。' + NO_CHANGE),
]

new_reviews = []
digest = lambda value: hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
for eid, sid, total, pending, quotes, conclusion in cases:
    assert not any(r['entityId'] == eid for r in record['reviews'])
    entity = next(e for e in city['entities'] if e['entity_id'] == eid)
    assert entity == next(e for e in before_city['entities'] if e['entity_id'] == eid)
    assert entity['primary_place_id'] == sid
    rows = [m for m in city['mentions'] if m['entityId'] == eid]
    assert rows == [m for m in before_city['mentions'] if m['entityId'] == eid]
    ids = sorted({m['raw_note_id'] for m in rows})
    assert len(rows) == total, (entity['canonical_name'], len(rows))
    for nid in ids:
        assert notes[nid] == before_notes[nid], f'笔记{nid}在冻结前后不一致'
    for nid, quote in quotes:
        assert nid in ids and quote in city['notes'][str(nid)]['note_desc'], (entity['canonical_name'], nid, quote)
    new_reviews.append({'city': '成都', 'entityId': eid, 'name': entity['canonical_name'],
        'expectedRevision': entity['revision'], 'identityRetained': True, 'fullFactsReviewed': False, 'scope': SCOPE,
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
assert len(record['reviews']) == 76 and count == 1109, (len(record['reviews']), count)
record['limits'] = ('76项/1109当前有效提及已读；成都24个主体已全部读毕（浣花溪公园与四川科技馆此前已入账），阅读不等于全来源、同体/组成/定位问题闭合，'
    '也不等于各城语义已完成。batch-120为最新完整验证；广州缺运营输入、鼓浪屿与集美大社缺媒体方案暂缓；未验收、不提交、不归档。')


def write(name, value):
    with (ROOT / name).open('x', encoding='utf-8') as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)


write('seven-cities-semantic-readthrough-34.json', record)
next_evidence = read(ROOT / 'seven-cities-next-evidence-36.json')
next_evidence.update(semanticReadthrough='seven-cities-semantic-readthrough-34.json', nextBatch=122)
next_evidence['remainingReview'][0] = ('成都24主体已读毕，待核身份边界：永陵/永陵博物馆疑为同址同体；'
    '民宿招募帖1026给春熙路4137、文殊院4136、文殊坊4135三条住宿参照待决；四川科技馆3763的reason事实排除待按契约审核；'
    '广州塔8100/8108/8133/7693与永庆坊7694待决；下一步转杭州22个主体。')
for item in new_reviews:
    next_evidence['nextEvidence'].append({'city': '成都', 'entityId': item['entityId'],
        'pendingMentionIds': item['pendingMentionIds'], 'conclusion': item['conclusion']})
write('seven-cities-next-evidence-37.json', next_evidence)
lines = ['# 本轮逐项原文阅读记录', '', record['limits'], '', '| 城市 | 地点 | 当前有效提及 | 结论与待办 |', '| --- | --- | --- | --- |']
for review in record['reviews']:
    lines.append('| ' + ' | '.join([review['city'], review['name'],
        '、'.join(str(m['mentionId']) for m in review['mentions']), review['conclusion'].replace('|', '／')]) + ' |')
lines += ['', '证据：[阅读台账](research/seven-cities-semantic-readthrough-34.json)、[下一证据](research/seven-cities-next-evidence-37.json)。', '']
(ROOT.parent / '七城本轮原文复核.md').write_text('\n'.join(lines), encoding='utf-8')
note = record['limits'] + '新增成都熊猫谷、博客楼、文殊坊、东门码头、永陵、灌县古城、南桥、四大会馆、永陵博物馆、安仁古镇共25条；浣花溪公园与四川科技馆沿用既有阅读条目。'
for path in [ROOT.parent / 'task.json', PARENT / 'task.json']:
    task = read(path)
    assert task['status'] == 'in_progress' and task['meta']['sevenCityContinuation']['latestValidatedEntityBatch'] == '120'
    task['notes'] = task['notes'] + ' ' + note
    task['meta']['sevenCityContinuation'].update(
        semanticReadthrough='10-09-attraction-top30-governance/research/seven-cities-semantic-readthrough-34.json',
        workingStage=note, accepted=False)
    path.write_text(json.dumps(task, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
for name in ['进展记录.md', '七城剩余问题.md']:
    with (ROOT.parent / name).open('a', encoding='utf-8') as handle:
        handle.write('\n## 成都全城阅读完成\n\n' + note + '\n\n入口：[下一证据](research/seven-cities-next-evidence-37.json)。\n')
print(json.dumps({'readEntities': len(record['reviews']), 'currentMentions': count, 'newEntities': 10,
    'newMentions': 25, 'chengduRead': 24, 'pending': [r['name'] for r in new_reviews if r['pendingMentionIds']],
    'accepted': False}, ensure_ascii=False))
