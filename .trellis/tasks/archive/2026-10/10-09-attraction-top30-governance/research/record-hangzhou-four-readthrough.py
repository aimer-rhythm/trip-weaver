"""固化杭州小河直街27条、曲院风荷26条、雷峰塔26条、太子湾公园25条实际全文阅读。"""
import hashlib
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parent
PARENT = ROOT.parents[1] / '10-06-place-identity-governance'
read = lambda p: json.loads(p.read_bytes())
record = read(ROOT / 'seven-cities-semantic-readthrough-36.json')
raw = (ROOT / record['snapshotFile']).read_bytes()
assert hashlib.sha256(raw).hexdigest() == record['snapshotSha256']
city = next(c for c in json.loads(raw)['cities'] if c['city'] == '杭州')
before_city = next(c for c in read(ROOT / 'snapshot-20261010T025803181559Z/input.json')['cities'] if c['city'] == '杭州')
assert city['notes'] == before_city['notes'], '既有笔记在冻结前后不一致'
notes = {n['id']: n for n in city['governanceState']['rawNotes']}
before_notes = {n['id']: n for n in before_city['governanceState']['rawNotes']}
NO_CHANGE = '本批不改字段、不重排。'

cases = [
    ('1e8e2af3f1eff3b32f78026f172768c0', 3995, 1, 27, [],
     [(1941, '河道两边都是老房子'), (2009, '到处透露着一种廉价的商业感'),
      (2009, '如果你的杭州之行时间紧凑，那真没必要专门跑这一趟'),
      (2236, '枕河延展开的步行街'), (2238, '青石板路，小巷深深，有很多特色小店'),
      (2244, '白墙黛瓦，巷子里有手作铺子、文创小店')],
     '27条/27篇正文已读（图片文字另核）。主体一致：京杭大运河边的历史街区，白墙黛瓦、青石板小巷，'
     '沿岸为咖啡馆、中古店、珍珠饰品与文创小店，免费开放、无需预约、全天可逛；主源3995未改。'
     '负评与限定保留：2009整篇《小河直街走向平庸的一些思考》明确「刺眼灯光、浮夸装修、网红小吃、廉价的商业感」，'
     '并写「时间紧凑真没必要专门跑这一趟」，同时给出「先坐水上巴士去拱宸桥、再顺便逛小河直街」的替代顺序；'
     '其余各帖把它列为运河线慢逛点，正面与负面立场并存保留。'
     '边界单列：小河公园（旧油库改造）、大兜路历史文化街区、桥西历史街区、拱宸桥、香积寺、大运河紫檀博物馆'
     '各为独立对象，本轮不合并、不改坐标、不新建组成关系。' + NO_CHANGE),
    ('42bf304ad5dc5c3a90279a09506b6044', 3994, 1, 26, [9344],
     [(1936, '耀天廊圆形拱门搭配临水枫树很出片'), (2015, '雨天的曲院风荷，才是西湖最像水墨画的地方'),
      (2117, '湛碧楼二楼的飞檐、烟雨、红梅共成一画'), (2175, '火出圈的梦核鱼缸'),
      (2131, '曲院风荷：🆓参观，岳庙的对面就是曲院风荷'), (2099, '曲院风荷看荷花')],
     '26条/26篇正文已核。主体一致：西湖十景之一，以荷文化与酒文化为主题，含岳湖、竹素园、风荷、曲院、滨湖密林等区域；'
     '免费参观、位于岳庙对面，3号门的梦核金鱼/鱼缸、蓼汀月洞门、耀天廊、湛碧楼、玉带晴虹桥是主要机位，'
     '雨天的水墨氛围与冬季枯荷、梅花各有说法；主源3994未改。'
     '限定保留：2131写「岳庙对面就是曲院风荷」、2175写3号门鱼缸火出圈、2117写年三十梅花静谧，均属原作者观察；'
     '门票与郭庄、苏堤观光车等按原文保留，不核实现行政策。'
     '边界单列：郭庄（清代园林）、岳庙、苏堤、杨公堤、茅家埠、乌龟潭、浴鹄湾、湛碧楼各为独立对象；'
     '曲院风荷作为西湖十景之一独立成行，不与西湖本体合并。'
     '拟隔离待审1条：9344所在整篇为「西湖边四家平价酒店」推荐帖，曲院风荷只作为观赏荷花的行程参照，无独立游览描述。'),
    ('65bd21fa2a000639d6238c25c2cfbb63', 4005, 1, 26, [9450],
     [(2016, '塔顶看出去大多是现代高楼'),
      (2131, '▫️雷峰塔：个人觉得没必要上去，可以去对面的净慈寺（🎫10元/人）拍到和雷峰塔同框的机位'),
      (2015, '雷峰塔隐在雨雾里，只剩一个淡淡的剪影'), (2054, '适合看夜景但晚上不能登塔观光'),
      (2168, '傍晚4点登塔看日落+6点亮灯'), (2166, '断桥、雷峰塔、三潭印月都能步行到'),
      (2211, '雷峰塔、三潭印月可去可不去，观感一般！')],
     '26条/26篇正文已读（图片文字另核）。主体一致：西湖十景之一的重建宝塔（原塔已倒塌），'
     '中国第一座彩色铜雕宝塔，塔内设电梯与扶梯，可登高俯瞰西湖，傍晚登塔看日落、6点亮灯，'
     '长桥公园是对拍倒影的机位；主源4005未改。'
     '负评与限定全部保留：9473写「花40块登雷峰塔，塔顶看出去大多是现代高楼」；2211写「可去可不去，观感一般」；'
     '2131/8892/8593写「没必要上去，外面或长桥拍全景就行」；8411写不推荐排队登塔；'
     '2054写晚间8点左右结束、晚上不能登塔观光。门票40元与亮灯时刻按原文保留，不核实现行政策。'
     '边界单列：净慈寺（可拍塔同框，另收门票）、长桥公园、南屏晚钟、夕照山、苏堤与西湖本体各自独立，'
     '本轮不合并、不新建组成关系、不改坐标。'
     '拟隔离待审1条：9450所在整篇为西湖边酒店广告，雷峰塔只作为「步行可达」的住宿参照，无独立游览描述。'),
    ('7acd0bdb6ee77ccb5586ccdbac752b2e', 3990, 3, 25, [],
     [(2057, '愿称之为杭州zui值得来的公园，任何天气都很出片'),
      (2131, '▫️太子湾公园：🆓参观，花港观鱼的南门出来对面就是太子湾公园，要去这里记得提前3天网上预约'),
      (2176, '太子湾：本来是去看郁金香的，可是大部分都已经凋谢了'),
      (1962, '再去太子湾看郁金香和樱花（郁金香季人多，其他季节人少）'), (2197, '现实版莫奈花园本园')],
     '25条/25篇正文已读（图片文字另核）；该主体此前已有治理修订，当前revision=3、别名含太子湾。'
     '主体一致：西湖西南侧的城市公园，以春季郁金香与樱花、清溪草坪、风车与放怀亭长椅为经典画面，'
     '免费开放但花期需提前预约；主源3990未改。'
     '限定与负评保留：2176写「大部分郁金香已凋谢，人是很多，但地方大仍出片」；'
     '1962写「郁金香季人多，其他季节人少」；2131写「要去记得提前3天网上预约」。'
     '边界单列：花港观鱼（南门对面）、苏堤、浴鹄湾、九曜山、净慈寺、虎跑公园、丝绸博物馆各自独立；'
     '郁金香花展等活动不新建主体；预约与花期按原文保留，不核实现行政策。' + NO_CHANGE),
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
assert len(record['reviews']) == 87 and count == 1371, (len(record['reviews']), count)
record['limits'] = ('87项/1371当前有效提及已读；阅读不等于全来源、同体/组成/定位问题闭合，也不等于各城语义已完成。'
    'batch-120为最新完整验证；广州缺运营输入、鼓浪屿与集美大社缺媒体方案、杭州住宿参照待决；未验收、不提交、不归档。')


def write(name, value):
    with (ROOT / name).open('x', encoding='utf-8') as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)


write('seven-cities-semantic-readthrough-37.json', record)
next_evidence = read(ROOT / 'seven-cities-next-evidence-39.json')
next_evidence.update(semanticReadthrough='seven-cities-semantic-readthrough-37.json', nextBatch=122)
next_evidence['remainingReview'][0] = ('杭州已读6个主体，继续西湖断桥、法喜寺、拱宸桥、龙井村、虎跑公园、云栖竹径、花港观鱼、西溪湿地、'
    '柳浪闻莺、苏堤、九溪烟树、三潭印月、茅家埠、乌龟潭、大兜路、十里琅珰、浴鹄湾、九溪十八涧、良渚古城遗址公园、'
    '桥西历史街区、杨公堤、南宋御街、杭州植物园、香积寺；杭州待决：灵隐寺9338，西湖9335/9448/9216，曲院风荷9344，雷峰塔9450。')
for item in new_reviews:
    next_evidence['nextEvidence'].append({'city': '杭州', 'entityId': item['entityId'],
        'pendingMentionIds': item['pendingMentionIds'], 'conclusion': item['conclusion']})
write('seven-cities-next-evidence-40.json', next_evidence)
lines = ['# 本轮逐项原文阅读记录', '', record['limits'], '', '| 城市 | 地点 | 当前有效提及 | 结论与待办 |', '| --- | --- | --- | --- |']
for review in record['reviews']:
    lines.append('| ' + ' | '.join([review['city'], review['name'],
        '、'.join(str(m['mentionId']) for m in review['mentions']), review['conclusion'].replace('|', '／')]) + ' |')
lines += ['', '证据：[阅读台账](research/seven-cities-semantic-readthrough-37.json)、[下一证据](research/seven-cities-next-evidence-40.json)。', '']
(ROOT.parent / '七城本轮原文复核.md').write_text('\n'.join(lines), encoding='utf-8')
note = record['limits'] + '新增杭州小河直街27条、曲院风荷26条、雷峰塔26条、太子湾公园25条；曲院风荷与雷峰塔各1条住宿参照待决。'
for path in [ROOT.parent / 'task.json', PARENT / 'task.json']:
    task = read(path)
    assert task['status'] == 'in_progress' and task['meta']['sevenCityContinuation']['latestValidatedEntityBatch'] == '120'
    task['notes'] = task['notes'] + ' ' + note
    task['meta']['sevenCityContinuation'].update(
        semanticReadthrough='10-09-attraction-top30-governance/research/seven-cities-semantic-readthrough-37.json',
        workingStage=note, accepted=False)
    path.write_text(json.dumps(task, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
for name in ['进展记录.md', '七城剩余问题.md']:
    with (ROOT.parent / name).open('a', encoding='utf-8') as handle:
        handle.write('\n## 杭州四主体阅读断点\n\n' + note + '\n\n入口：[下一证据](research/seven-cities-next-evidence-40.json)。\n')
print(json.dumps({'readEntities': len(record['reviews']), 'currentMentions': count, 'newEntities': 4,
    'newMentions': 104, 'hangzhouRead': 6, 'pending': [r['name'] for r in new_reviews if r['pendingMentionIds']],
    'accepted': False}, ensure_ascii=False))
