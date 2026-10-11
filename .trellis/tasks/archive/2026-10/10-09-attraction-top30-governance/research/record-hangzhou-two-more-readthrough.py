"""固化杭州龙井村21条、虎跑公园20条实际全文阅读。"""
import hashlib
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parent
PARENT = ROOT.parents[1] / '10-06-place-identity-governance'
read = lambda p: json.loads(p.read_bytes())
record = read(ROOT / 'seven-cities-semantic-readthrough-38.json')
raw = (ROOT / record['snapshotFile']).read_bytes()
assert hashlib.sha256(raw).hexdigest() == record['snapshotSha256']
city = next(c for c in json.loads(raw)['cities'] if c['city'] == '杭州')
before_city = next(c for c in read(ROOT / 'snapshot-20261010T025803181559Z/input.json')['cities'] if c['city'] == '杭州')
assert city['notes'] == before_city['notes'], '既有笔记在冻结前后不一致'
notes = {n['id']: n for n in city['governanceState']['rawNotes']}
before_notes = {n['id']: n for n in before_city['governanceState']['rawNotes']}
NO_CHANGE = '本批不改字段、不重排。'

cases = [
    ('b7f272ec1e9a497b8a43bb3eda6ae247', 4050, 1, 21, [9337],
     [(1940, '满山茶田+白墙黛瓦'), (2092, '龙井村地势高，一路往下走，体能消耗极低'),
      (2092, '❌ 别买高价茶：龙井村路边有很多拉客卖茶的'), (2250, '龙井村：满山梯田茶园，村子里茶铺林立'),
      (2246, '新手走到龙井村这里就可以结束了'), (2099, '龙井茶山都很有氛围')],
     '21条提及/20篇正文已读（图片文字另核）。主体一致：西湖以西的龙井茶核心产区村落，满山梯田茶园、白墙黛瓦、'
     '茶铺茶室林立，可喝明前龙井与桂花龙井、吃桂花糕，免费开放；因地势高，被普遍安排为「龙井进、九溪出」的徒步起点，'
     '一路下坡省力；主源4050未改。负评与避坑全部保留：2092明确「别买高价茶：龙井村路边有很多拉客卖茶的，'
     '不懂行建议只喝茶不买茶，容易被宰」，并提示防蚊、护膝、上午9点前出发；1988/8460写要辨别真假、'
     '有喝茶避坑细节；2246写新手走到龙井村即可结束返程。'
     '边界单列：十里琅珰、三分岔、茶山顶凉亭、九溪十八涧、九溪烟树、满觉陇、梅家坞、真际院各自独立；'
     '龙井村是村落本身，不与这些步道或景点合并；本轮不新建组成关系、不改坐标。'
     '拟隔离待审1条：9337所在整篇为「西湖边四家平价酒店」推荐帖，龙井村只作为「茶园山野民宿」的定位参照，无独立村落游览描述。'),
    ('89a1b6c43752013aac4b68bcafe8a7cf', 3996, 1, 20, [],
     [(1939, '虎跑的幽静和禅意 才是江南松弛感的正确打开方式'), (1987, '🎫门票：15元/人，公园年卡免费'),
      (1987, '以天下第三泉虎跑泉为核心'), (2011, '虎跑公园：山林安静，泉水叮咚，水杉秋景好看'),
      (2254, '3️⃣虎跑公园 → 九溪｜难度⭐⭐⭐⭐'), (1979, '虎跑公园、西溪湿地等早晨7:30之前免门票')],
     '20条/20篇正文已读（图片文字另核）。主体一致：新西湖十景「虎跑梦泉」，以虎跑泉（文中称天下第三泉）为核心，'
     '园内古树遮天、青石板林荫道、梦虎雕像、济公塔苑、弘一法师纪念馆与钟楼花窗，可接泉水用虎跑泉泡龙井茶；'
     '原文门票15元、开放约6:00-18:00，且「早晨7:30之前免门票」；主源3996未改。'
     '限定与提示保留：1939/2134写园内台阶多、蚊虫多、自备水与零食（园内售卖价格偏高），'
     '2254把「虎跑公园→九溪」列为全长约7.5公里、爬升高的困难线（含贵人阁陡台阶，膝盖不好带登山杖），'
     '与「杨梅岭→九溪」轻松线区分；雨天氛围与红枫王、水杉秋景属季节观察。'
     '边界单列：贵人阁、满觉陇、杨梅岭、九溪十八涧、九溪烟树、云栖竹径、六和塔、太子湾公园、丝绸博物馆与虎跑公园各自独立；'
     '虎跑公园是公园本体，不与上述步道或景点合并；本轮不新建组成关系、不改坐标，票价与免票时段按原文保留。' + NO_CHANGE),
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
assert len(record['reviews']) == 92 and count == 1482, (len(record['reviews']), count)
record['limits'] = ('92项/1482当前有效提及已读；阅读不等于全来源、同体/组成/定位问题闭合，也不等于各城语义已完成。'
    'batch-120为最新完整验证；广州缺运营输入、鼓浪屿与集美大社缺媒体方案、杭州住宿参照待决；未验收、不提交、不归档。')


def write(name, value):
    with (ROOT / name).open('x', encoding='utf-8') as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)


write('seven-cities-semantic-readthrough-39.json', record)
next_evidence = read(ROOT / 'seven-cities-next-evidence-41.json')
next_evidence.update(semanticReadthrough='seven-cities-semantic-readthrough-39.json', nextBatch=122)
next_evidence['remainingReview'][0] = ('杭州已读11个主体，继续云栖竹径、花港观鱼、西溪湿地、柳浪闻莺、苏堤、九溪烟树、三潭印月、茅家埠、'
    '乌龟潭、大兜路、十里琅珰、浴鹄湾、九溪十八涧、良渚古城遗址公园、桥西历史街区、杨公堤、南宋御街、杭州植物园、香积寺；'
    '杭州待决7条住宿参照：灵隐寺9338、西湖9335/9448/9216、曲院风荷9344、雷峰塔9450、西湖断桥9449、龙井村9337。')
for item in new_reviews:
    next_evidence['nextEvidence'].append({'city': '杭州', 'entityId': item['entityId'],
        'pendingMentionIds': item['pendingMentionIds'], 'conclusion': item['conclusion']})
write('seven-cities-next-evidence-42.json', next_evidence)
lines = ['# 本轮逐项原文阅读记录', '', record['limits'], '', '| 城市 | 地点 | 当前有效提及 | 结论与待办 |', '| --- | --- | --- | --- |']
for review in record['reviews']:
    lines.append('| ' + ' | '.join([review['city'], review['name'],
        '、'.join(str(m['mentionId']) for m in review['mentions']), review['conclusion'].replace('|', '／')]) + ' |')
lines += ['', '证据：[阅读台账](research/seven-cities-semantic-readthrough-39.json)、[下一证据](research/seven-cities-next-evidence-42.json)。', '']
(ROOT.parent / '七城本轮原文复核.md').write_text('\n'.join(lines), encoding='utf-8')
note = record['limits'] + '新增杭州龙井村21条、虎跑公园20条；龙井村1条住宿参照待决。'
for path in [ROOT.parent / 'task.json', PARENT / 'task.json']:
    task = read(path)
    assert task['status'] == 'in_progress' and task['meta']['sevenCityContinuation']['latestValidatedEntityBatch'] == '120'
    task['notes'] = task['notes'] + ' ' + note
    task['meta']['sevenCityContinuation'].update(
        semanticReadthrough='10-09-attraction-top30-governance/research/seven-cities-semantic-readthrough-39.json',
        workingStage=note, accepted=False)
    path.write_text(json.dumps(task, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
for name in ['进展记录.md', '七城剩余问题.md']:
    with (ROOT.parent / name).open('a', encoding='utf-8') as handle:
        handle.write('\n## 杭州龙井村与虎跑公园阅读断点\n\n' + note + '\n\n入口：[下一证据](research/seven-cities-next-evidence-42.json)。\n')
print(json.dumps({'readEntities': len(record['reviews']), 'currentMentions': count, 'newEntities': 2,
    'newMentions': 41, 'hangzhouRead': 11, 'pending': [r['name'] for r in new_reviews if r['pendingMentionIds']],
    'accepted': False}, ensure_ascii=False))
