"""固化杭州灵隐寺44条与西湖34条实际全文阅读，不执行业务决定。"""
import hashlib
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parent
PARENT = ROOT.parents[1] / '10-06-place-identity-governance'
read = lambda p: json.loads(p.read_bytes())
record = read(ROOT / 'seven-cities-semantic-readthrough-35.json')
raw = (ROOT / record['snapshotFile']).read_bytes()
assert hashlib.sha256(raw).hexdigest() == record['snapshotSha256']
city = next(c for c in json.loads(raw)['cities'] if c['city'] == '杭州')
before_city = next(c for c in read(ROOT / 'snapshot-20261010T025803181559Z/input.json')['cities'] if c['city'] == '杭州')
assert city['notes'] == before_city['notes'], '既有笔记在冻结前后不一致'
notes = {n['id']: n for n in city['governanceState']['rawNotes']}
before_notes = {n['id']: n for n in before_city['governanceState']['rawNotes']}
NO_CHANGE = '本批不改字段、不重排。'

cases = [
    ('56e268b7cdcca76052bd6359c8ffb278', 4007, 44, [9338],
     [(1938, '免费不免票，预约入园'), (1938, '（2）寺院免费提供3支清香，不要在门口高价买香'),
      (2021, '在微信或支付宝搜索“杭州灵隐飞来峰”小程序'),
      (2098, '灵隐寺其实除了名气大，真没其他'), (2145, '别死磕断桥、灵隐❗挤到寸步难行'),
      (2020, '出入口均有法物流通处，里三层外三层都是人'), (2154, '7号门只排了20分钟'),
      (2024, '重点提醒：一定要提前预约！')],
     '44条提及/41篇正文已读（图片文字另核）。主体一致：位于飞来峰景区内的千年古刹，'
     '中轴线以天王殿、大雄宝殿、药师殿、华严殿、济公殿、伽蓝殿、五百罗汉堂为主，飞来峰摩崖石刻与冷泉亭在寺前景区；'
     '原文普遍要求「免费不免票、须小程序预约、不接当日预约」，入园刷身份证或刷脸，17:00停止入园；主源4007未改。'
     '负评与警示全部保留：2098明确「灵隐寺其实除了名气大真没其他，永福跟韬光漂亮多了」；'
     '2145写「别死磕断桥、灵隐❗挤到寸步难行」；2020写真要在法物流通处里三层外三层挤着挑；'
     '2024/2099写人巨多、不预约现场进不去；1938警示门口高价香与「免费领香」谣言；'
     '9269提醒离园易遇杭州堵车、要多留时间。门票免费政策、十方苑关停、素面均价等属原作者描述，不核实现行政策。'
     '边界单列：飞来峰景区（含造像与票务）、永福寺、韬光寺、法喜寺、法镜寺、法净寺、北高峰与灵财神庙、'
     '灵隐公交总站、咫尺西天牌坊各自独立，本轮不合并、不改坐标。'
     '拟隔离待审1条：9338所在整篇为「西湖边四家平价酒店」推荐帖，灵隐寺只作为酒店定位参照、无独立游览描述。'),
    ('9e3d184e145964553e87f1c379734be7', 3991, 34, [9335, 9448, 9216],
     [(1942, '📍西湖：冬日薄雾笼湖，山水如墨'), (1980, 'Day2 西湖环湖经典线'),
      (2031, '📍西湖：杭州核心必逛景区'), (2153, '🔺 浪漫暴击：下午4点搭手划船，让船夫摇进乌龟潭深处'),
      (1949, '集贤亭（日落机位）'), (2129, '2️⃣去西湖西泠桥散步，看最像海的转角'),
      (2016, '❌不要下了高铁✈️，就直奔西湖，西湖面积很大，线路没有规划好，走一天腿就废'),
      (2193, '比起节日里的西湖 我更推荐这里')],
     '34条提及/32篇正文已读（图片文字另核）。主体一致：杭州核心景区，以西湖十景（断桥残雪、曲院风荷、三潭印月、'
     '雷峰塔、苏堤、柳浪闻莺、花港观鱼、平湖秋月等）为主，环湖步行与骑行、集贤亭与长桥公园看日落、'
     '三潭印月须坐船、音乐喷泉定时演出、地铁1号线龙翔桥可达；主源3991未改。'
     '负评与警示全部保留：2193写「比起节日里的西湖，我更推荐湘湖」，明确节假日人挤人；'
     '9376写「别只去西湖人挤人」；2016写面积大、线路没规划好会走废腿，并列出不建议自驾、雷峰塔40元性价比等避雷；'
     '8940写夏季晒闷热、环湖部分路段禁共享单车；9474写长桥机位比登塔更好；8319写不建议自驾、周边堵。'
     '船票、喷泉时刻、雷峰塔票价等按原文保留，不核实现行政策。'
     '边界单列：西湖十景各点位（断桥、白堤、苏堤、曲院风荷、花港观鱼、三潭印月、雷峰塔、柳浪闻莺、孤山、平湖秋月）'
     '与茅家埠、乌龟潭、浴鹄湾、杨公堤、太子湾公园、宝石山各自独立成行，西湖本体不与这些子项合并；'
     '三潭印月是湖心岛须乘船，本轮不新建组成关系、不改坐标。'
     '拟隔离待审3条：9335（「西湖边四家平价酒店」推荐帖的散步参照）、9448（酒店广告「步行5分钟直达西湖」）、'
     '9216（Livehouse 广告「出门就是西湖」的下班散步参照），三篇都没有独立景区游览描述。'),
]

new_reviews = []
digest = lambda value: hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
for eid, sid, total, pending, quotes, conclusion in cases:
    assert not any(r['entityId'] == eid for r in record['reviews'])
    entity = next(e for e in city['entities'] if e['entity_id'] == eid)
    assert entity == next(e for e in before_city['entities'] if e['entity_id'] == eid)
    assert entity['revision'] == 1 and entity['primary_place_id'] == sid
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
assert len(record['reviews']) == 83 and count == 1267, (len(record['reviews']), count)
record['limits'] = ('83项/1267当前有效提及已读；阅读不等于全来源、同体/组成/定位问题闭合，也不等于各城语义已完成。'
    'batch-120为最新完整验证；广州缺运营输入、鼓浪屿与集美大社缺媒体方案、杭州住宿/经营场所参照待决；未验收、不提交、不归档。')


def write(name, value):
    with (ROOT / name).open('x', encoding='utf-8') as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)


write('seven-cities-semantic-readthrough-36.json', record)
next_evidence = read(ROOT / 'seven-cities-next-evidence-38.json')
next_evidence.update(semanticReadthrough='seven-cities-semantic-readthrough-36.json', nextBatch=122)
next_evidence['remainingReview'][0] = ('杭州已读灵隐寺、西湖2个主体，继续小河直街、曲院风荷、雷峰塔、太子湾公园、西湖断桥、法喜寺、'
    '拱宸桥、龙井村、虎跑公园、云栖竹径、花港观鱼、西溪湿地、柳浪闻莺、苏堤、九溪烟树、三潭印月、茅家埠、乌龟潭、'
    '大兜路、十里琅珰、浴鹄湾、九溪十八涧、良渚古城遗址公园、桥西历史街区、杨公堤、南宋御街、杭州植物园、香积寺；'
    '杭州拟隔离：灵隐寺9338，西湖9335/9448/9216；成都待核永陵/永陵博物馆同址；广州四条待决。')
for item in new_reviews:
    next_evidence['nextEvidence'].append({'city': '杭州', 'entityId': item['entityId'],
        'pendingMentionIds': item['pendingMentionIds'], 'conclusion': item['conclusion']})
write('seven-cities-next-evidence-39.json', next_evidence)
lines = ['# 本轮逐项原文阅读记录', '', record['limits'], '', '| 城市 | 地点 | 当前有效提及 | 结论与待办 |', '| --- | --- | --- | --- |']
for review in record['reviews']:
    lines.append('| ' + ' | '.join([review['city'], review['name'],
        '、'.join(str(m['mentionId']) for m in review['mentions']), review['conclusion'].replace('|', '／')]) + ' |')
lines += ['', '证据：[阅读台账](research/seven-cities-semantic-readthrough-36.json)、[下一证据](research/seven-cities-next-evidence-39.json)。', '']
(ROOT.parent / '七城本轮原文复核.md').write_text('\n'.join(lines), encoding='utf-8')
note = record['limits'] + '新增杭州灵隐寺44条、西湖34条；两主体共4条住宿/经营场所参照待决。'
for path in [ROOT.parent / 'task.json', PARENT / 'task.json']:
    task = read(path)
    assert task['status'] == 'in_progress' and task['meta']['sevenCityContinuation']['latestValidatedEntityBatch'] == '120'
    task['notes'] = task['notes'] + ' ' + note
    task['meta']['sevenCityContinuation'].update(
        semanticReadthrough='10-09-attraction-top30-governance/research/seven-cities-semantic-readthrough-36.json',
        workingStage=note, accepted=False)
    path.write_text(json.dumps(task, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
for name in ['进展记录.md', '七城剩余问题.md']:
    with (ROOT.parent / name).open('a', encoding='utf-8') as handle:
        handle.write('\n## 杭州两主体阅读断点\n\n' + note + '\n\n入口：[下一证据](research/seven-cities-next-evidence-39.json)。\n')
print(json.dumps({'readEntities': len(record['reviews']), 'currentMentions': count, 'newEntities': 2,
    'newMentions': 78, 'hangzhouRead': 2, 'pending': {r['name']: r['pendingMentionIds'] for r in new_reviews},
    'accepted': False}, ensure_ascii=False))
