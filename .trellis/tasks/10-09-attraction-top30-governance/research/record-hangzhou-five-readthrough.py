"""固化杭州苏堤17条、九溪烟树16条、三潭印月15条、茅家埠14条、乌龟潭13条实际全文阅读。"""
import hashlib
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parent
PARENT = ROOT.parents[1] / '10-06-place-identity-governance'
read = lambda p: json.loads(p.read_bytes())
record = read(ROOT / 'seven-cities-semantic-readthrough-40.json')
raw = (ROOT / record['snapshotFile']).read_bytes()
assert hashlib.sha256(raw).hexdigest() == record['snapshotSha256']
city = next(c for c in json.loads(raw)['cities'] if c['city'] == '杭州')
before_city = next(c for c in read(ROOT / 'snapshot-20261010T025803181559Z/input.json')['cities'] if c['city'] == '杭州')
assert city['notes'] == before_city['notes'], '既有笔记在冻结前后不一致'
notes = {n['id']: n for n in city['governanceState']['rawNotes']}
before_notes = {n['id']: n for n in before_city['governanceState']['rawNotes']}
NO_CHANGE = '本批不改字段、不重排。'

cases = [
    ('78886d74e678d61a4d3e5ebd5fd9f74c', 4148, 2, 17, [9452],
     [(2074, '苏堤是禁骑区，步行或坐景区电瓶车更稳妥'), (2172, '苏堤全长3公里'),
      (2154, '走过苏堤（人巨多）'), (2003, '苏堤林荫步道很舒服'), (2166, '出门就是苏堤、白堤')],
     '17条/17篇正文已读（图片文字另核）；该主体此前已有治理修订，当前revision=2、别名含苏堤春晓、西湖苏堤。'
     '主体一致：西湖十景之一的苏堤，长堤贯穿西湖，林荫步道适合漫步、傍晚看日落；主源4148未改。'
     '限定与负评保留：2074明确「苏堤是禁骑区，步行或坐景区电瓶车更稳妥，想骑车逛西湖请选杨公堤或南山路」；'
     '2172写全长3公里、走不动只走南段到花港观鱼即可；2154写节假日「走过苏堤（人巨多）」；'
     '2180写观光车不在苏堤起点、需等中途空位，实测放弃。'
     '边界单列：白堤、杨公堤、孤山、花港观鱼、太子湾公园、雷峰塔、曲院风荷与苏堤各自独立；'
     '苏堤作为西湖十景之一独立成行，不与西湖本体合并；本轮不新建组成关系、不改坐标。'
     '拟隔离待审1条：9452所在整篇为西湖边酒店广告，苏堤只作为「出门就是」的住宿参照，无独立游览描述。'),
    ('b1fe60915782867d914bff2db22b960d', 3992, 1, 16, [],
     [(1940, '标志性的小瀑布+碧水+翠枫'), (2250, '九溪烟树：晴天宝石蓝、雨天碧玉绿'),
      (2092, '终点站 ➡️ 九溪烟树'), (2089, '彼岸花也开了，红艳艳的')],
     '16条/16篇正文已读（图片文字原核）。主体一致：九溪十八涧一带的核心景点，以清澈溪水、小瀑布、翠枫与'
     '层层茶园为看点，晴天呈宝石蓝、雨天呈碧玉绿，常被安排为九溪徒步的起点或终点（龙井进九溪出为下坡路线）；'
     '主源3992未改，本批未出现针对该主体的负面意见，各帖均为季节与强度提示。'
     '限定保留：2250写环线约11.5公里、爬升500米；9602写「杨梅岭→九溪」最轻松、「虎跑→九溪」难度最高，'
     '均属路线取舍，不改字段。边界单列：九溪十八涧、九溪公交站、理安寺、杨梅岭、满觉陇、龙井村、'
     '十里琅珰、真际院、云栖竹径、虎跑公园各自独立；九溪烟树是点位本体，本轮不新建组成关系、不改坐标。' + NO_CHANGE),
    ('60073e7d23d0ae476f605550f26cdbf9', 4004, 1, 15, [9451],
     [(1936, '绕岛一周大约1小时'), (2168, '带1R纸币拍同款，坐官方船55R含登岛'),
      (2211, '雷峰塔、三潭印月可去可不去，观感一般！'), (2031, '认准正规游船'),
      (2166, '断桥、雷峰塔、三潭印月都能步行到'), (2180, '比岛上拍的清楚点')],
     '15条/15篇正文已读（图片文字另核）。主体一致：西湖十景之一的湖心岛三潭印月，需乘船前往，'
     '是一元纸币图案取景地，岛上有九狮石、南舒亭、御碑亭、我心相印亭等，绕岛一周约1小时；'
     '官方游船票价55/70元含登岛，钱王祠、岳庙、花港观鱼等码头均可上下；主源4004未改。'
     '负评与警示全部保留：2211明确「雷峰塔、三潭印月可去可不去，观感一般」；2031写「认准正规游船，'
     '不要轻信路边黄🐂的所谓低价坐船骗局」；2180写船上看三潭印月比岛上拍更清楚；'
     '9386类帖把船票与登岛取舍单列。票价与班次按原文保留，不核实现行政策。'
     '边界单列：湖心岛本体与钱王祠码头、岳庙码头、花港观鱼码头、苏堤、雷峰塔、柳浪闻莺各自独立；'
     '本轮不新建组成关系、不改坐标。'
     '拟隔离待审1条：9451所在整篇为西湖边酒店广告，三潭印月只作为「步行可达」的住宿参照，无独立游览描述。'),
    ('01965e2d547378664b57de367449a244', 4151, 1, 14, [],
     [(2133, '一个冷门的宝藏景点'), (2153, '木栈道穿芦苇荡'),
      (2033, '本地人私藏的茅家埠看雾气未散'), (2176, '风景超好！是我觉得超乎期待的景点'),
      (2180, '成片的二月兰，像是莫奈花园')],
     '14条/14篇正文已读（图片文字另核）。主体一致：西湖西侧的清幽水乡片区（上香古道路段），'
     '以木栈道、芦苇荡、睡莲、白鹭、茶园与二月兰花海为看点，几乎全部帖子强调「人少、不用挤、有坐处」；'
     '主源4151未改，本批无针对该主体的负面意见。'
     '限定保留：2033写「本地人私藏的茅家埠看雾气未散」，属清晨时段体验；'
     '2180写「樱花虽谢但完全不影响游玩」，属季节取舍。边界单列：乌龟潭、浴鹄湾、杨公堤、上茅家埠茶园、'
     '龙井村、太子湾公园与茅家埠各自独立；茅家埠是片区本体，本轮不新建组成关系、不改坐标。' + NO_CHANGE),
    ('fbb658cc04154749cd45ef1095510388', 4108, 1, 13, [],
     [(1956, '沿途风景真的好美'), (2133, '坐摇橹船游乌龟潭实在是太多人排队了'),
      (2176, '晚樱正直盛花期，非常漂亮'), (2153, '摇进乌龟潭深处'), (2134, '西湖边的小众江南湿地')],
     '13条/13篇正文已读（图片文字另核）。主体一致：西湖西南侧的小众湿地水面，以摇橹船、茅草亭、'
     '绿树湖水、晚樱与野趣营地氛围为看点，被多帖列入「西湖西侧人少路线」；主源4108未改。'
     '限定保留：2133明确「坐摇橹船游乌龟潭太多人排队，节假日很难抢到，建议骑行路过顺便拍摇橹船」；'
     '2180写于谦祠码头附近有一大片樱花、人也稍多；2176写晚樱盛花期配游船出片。'
     '边界单列：茅家埠、浴鹄湾、杨公堤、于谦祠、太子湾公园、花港观鱼与乌龟潭各自独立；'
     '乌龟潭是水面本体，本轮不新建组成关系、不改坐标、不确认摇橹船班次或价格。' + NO_CHANGE),
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
assert len(record['reviews']) == 101 and count == 1632, (len(record['reviews']), count)
record['limits'] = ('101项/1632当前有效提及已读；阅读不等于全来源、同体/组成/定位问题闭合，也不等于各城语义已完成。'
    'batch-120为最新完整验证；广州缺运营输入、鼓浪屿与集美大社缺媒体方案、杭州住宿参照待决；未验收、不提交、不归档。')


def write(name, value):
    with (ROOT / name).open('x', encoding='utf-8') as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)


write('seven-cities-semantic-readthrough-41.json', record)
next_evidence = read(ROOT / 'seven-cities-next-evidence-43.json')
next_evidence.update(semanticReadthrough='seven-cities-semantic-readthrough-41.json', nextBatch=122)
next_evidence['remainingReview'][0] = ('杭州已读20个主体，继续大兜路、十里琅珰、浴鹄湾、九溪十八涧、良渚古城遗址公园、桥西历史街区、'
    '杨公堤、南宋御街、杭州植物园、香积寺；杭州待决住宿参照累计10条（灵隐寺9338、西湖9335/9448/9216、'
    '曲院风荷9344、雷峰塔9450、西湖断桥9449、龙井村9337、苏堤9452、三潭印月9451）。')
for item in new_reviews:
    next_evidence['nextEvidence'].append({'city': '杭州', 'entityId': item['entityId'],
        'pendingMentionIds': item['pendingMentionIds'], 'conclusion': item['conclusion']})
write('seven-cities-next-evidence-44.json', next_evidence)
lines = ['# 本轮逐项原文阅读记录', '', record['limits'], '', '| 城市 | 地点 | 当前有效提及 | 结论与待办 |', '| --- | --- | --- | --- |']
for review in record['reviews']:
    lines.append('| ' + ' | '.join([review['city'], review['name'],
        '、'.join(str(m['mentionId']) for m in review['mentions']), review['conclusion'].replace('|', '／')]) + ' |')
lines += ['', '证据：[阅读台账](research/seven-cities-semantic-readthrough-41.json)、[下一证据](research/seven-cities-next-evidence-44.json)。', '']
(ROOT.parent / '七城本轮原文复核.md').write_text('\n'.join(lines), encoding='utf-8')
note = record['limits'] + '新增杭州苏堤17条、九溪烟树16条、三潭印月15条、茅家埠14条、乌龟潭13条；苏堤与三潭印月各1条住宿参照待决。'
for path in [ROOT.parent / 'task.json', PARENT / 'task.json']:
    task = read(path)
    assert task['status'] == 'in_progress' and task['meta']['sevenCityContinuation']['latestValidatedEntityBatch'] == '120'
    task['notes'] = task['notes'] + ' ' + note
    task['meta']['sevenCityContinuation'].update(
        semanticReadthrough='10-09-attraction-top30-governance/research/seven-cities-semantic-readthrough-41.json',
        workingStage=note, accepted=False)
    path.write_text(json.dumps(task, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
for name in ['进展记录.md', '七城剩余问题.md']:
    with (ROOT.parent / name).open('a', encoding='utf-8') as handle:
        handle.write('\n## 杭州五主体阅读断点（苏堤等）\n\n' + note + '\n\n入口：[下一证据](research/seven-cities-next-evidence-44.json)。\n')
print(json.dumps({'readEntities': len(record['reviews']), 'currentMentions': count, 'newEntities': 5,
    'newMentions': 75, 'hangzhouRead': 20, 'pending': [r['name'] for r in new_reviews if r['pendingMentionIds']],
    'accepted': False}, ensure_ascii=False))
