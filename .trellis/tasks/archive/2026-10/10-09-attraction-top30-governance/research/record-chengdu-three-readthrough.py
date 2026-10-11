"""固化成都人民公园19条、成都博物馆18条、杜甫草堂16条实际全文阅读，不执行业务决定。"""
import hashlib
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parent
PARENT = ROOT.parents[1] / '10-06-place-identity-governance'
read = lambda p: json.loads(p.read_bytes())
record = read(ROOT / 'seven-cities-semantic-readthrough-31.json')
raw = (ROOT / record['snapshotFile']).read_bytes()
assert hashlib.sha256(raw).hexdigest() == record['snapshotSha256']
city = next(c for c in json.loads(raw)['cities'] if c['city'] == '成都')
before_city = next(c for c in read(ROOT / 'snapshot-20261010T025803181559Z/input.json')['cities'] if c['city'] == '成都')
assert city['notes'] == before_city['notes'], '既有笔记在冻结前后不一致'
notes = {n['id']: n for n in city['governanceState']['rawNotes']}
before_notes = {n['id']: n for n in before_city['governanceState']['rawNotes']}

cases = [
    ('c59fb8b0967139fdc1bbf231b57283b1', 1687, 2, 19, [],
     [(927, '免费开放'), (929, '而且桌子之间挨的无敌近，又吵又热'), (932, '茶社里面的餐食口味普通'),
      (895, '10:00-11:30步行10分钟人民公园'), (876, '去了人民公园 可以喝盖碗茶 看京剧表演'),
      (925, '祠堂街民国骑楼➡️木木美术馆➡️方池街➡️柿子巷➡️斌升街➡️人民公园➡️百年银杏长廊')],
     '19条/19篇正文已读（图片文字另核）。该主体此前已有治理修订，当前revision=2、别名含成都人民公园与祠堂街人民公园；'
     '本轮按全实体当前提及重读。主体一致：始建1911年的百年公园（原少城公园），园内有鹤鸣茶社、辛亥秋保路死事纪念碑、'
     '相亲角、人工湖游船、少城苑与盆景园，免费开放、无需预约、地铁2号线人民公园站。'
     '负评与警示全部保留：929鹤鸣茶社人头攒动没有位置、桌子挨得近又吵又热，932茶社餐食口味普通不建议吃正餐，'
     '950节假日茶社一座难求、周末人多嘈杂，902提醒采耳要找正规茶馆，876只作走马观花式记录。'
     '边界单列：925同帖把祠堂街民国骑楼、木木美术馆、方池街、柿子巷、斌升街与人民公园、百年银杏长廊串成祠堂街citywalk，'
     '这些相邻街区与人民公园地铁站各自独立，不合并入园；鹤鸣茶社、少城苑、盆景园属园内设施，不新建独立主体。'
     '本批无拟隔离提及，不改字段、不重排；免费与营业时刻属原作者描述，不核实现行政策。'),
    ('e35dd8c5d493408a525edee193c816d4', 1686, 1, 18, [],
     [(876, '然后去了成都博物馆 走马观花一个小时'), (891, '两者取一只用去成博就行'),
      (899, '热门景点需要提前予约'), (947, '提前14天晚上19:00放票，基本准点蹲都能抢到'),
      (949, '成都博物馆负一楼'), (936, '成都博物馆｜打卡表情包天团')],
     '18条/18篇正文已读（图片文字另核）。主体一致：位于天府广场旁的市立综合博物馆，免费但需预约、周一闭馆、'
     '地铁1/2号线天府广场站；馆内有古蜀文物、蜀锦、皮影、老成都复原街景、负一楼动物展与常设特展，文创与讲解口碑较好；'
     '主源1686未改，未新增别名。负评与中性保留：876走马观花仅约一小时，950提示周一闭馆易跑空、节假日人多，'
     '早期帖把预约与放票规则写成多种版本。边界单列：891同帖明确「成都博物馆与四川博物院两者取一」，'
     '与成都自然博物馆、金沙遗址博物馆（现闭馆提升）、成都市美术馆、天府广场各自独立，不合并、不改坐标。'
     '预约放票时间（提前7/14天、19:00放票等）在各帖间不一致，保持原抽取与原文，不确认现行预约政策。'
     '本批无拟隔离提及，不改字段、不重排。'),
    ('e307964bde2737b002300db65cdfb7df', 1704, 1, 16, [],
     [(891, '杜甫草堂：门票50，湿地公园很好看，比浣花溪公园好看'), (900, '真正跟杜甫有关的史迹很少'),
      (926, '喜欢安静园林感可以去杜甫草堂博物馆'),
      (912, '✅顺路可逛（8.5 分左右）杜甫草堂｜成都 IFS 国金中心'),
      (910, '诗圣故居古木清幽'), (911, '意外成为成都市区行最惊艳之处'),
      (913, '预约了何鸿老师的讲解'), (947, '杜甫草堂提前14天放票，50元')],
     '16条/16篇正文已读（图片文字另核）。主体一致：诗圣杜甫故居与川西园林式博物馆，别名杜甫草堂博物馆；'
     '门票50元、9:00-18:00全年无休、地铁4号线草堂北路站，园内以竹林、花径、茅屋故居、盆景为主，'
     '适合慢逛、古风拍照与请讲解；主源1704未改。负评与限定保留：891写杜甫相关不算多、游客多但湿地园林比浣花溪公园好看，'
     '900明确真正与杜甫有关的史迹很少、更像历代共建纪念园林，912只给8.5分顺路可逛，950认为可玩内容少、只适合闲逛拍照，'
     '910的教师节免票与913的讲解体验属活动与个人服务，不作为常设事实。'
     '边界单列：浣花溪公园、青羊宫、武侯祠、四川博物院为相邻独立对象，891同帖把浣花溪与草堂并列比较而不合并；'
     '花径、茅屋故居、盆景园属园内景点，不新建独立主体。门票与免票活动按原文保留，不核实现行票价或优惠。'
     '本批无拟隔离提及，不改字段、不重排。'),
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
    assert len(rows) == len(ids) == total, (entity['canonical_name'], len(rows))
    for nid in ids:
        assert notes[nid] == before_notes[nid], f'笔记{nid}在冻结前后不一致'
    for nid, quote in quotes:
        assert nid in ids and quote in city['notes'][str(nid)]['note_desc'], (entity['canonical_name'], nid, quote)
    new_reviews.append({'city': '成都', 'entityId': eid, 'name': entity['canonical_name'],
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
assert len(record['reviews']) == 60 and count == 1029, (len(record['reviews']), count)
record['limits'] = ('60项/1029当前有效提及已读；阅读不等于全来源、同体/组成/定位问题闭合，也不等于各城语义已完成。'
    'batch-120为最新完整验证；广州缺运营输入、鼓浪屿与集美大社缺媒体方案暂缓；未验收、不提交、不归档。')


def write(name, value):
    with (ROOT / name).open('x', encoding='utf-8') as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)


write('seven-cities-semantic-readthrough-32.json', record)
next_evidence = read(ROOT / 'seven-cities-next-evidence-34.json')
next_evidence.update(semanticReadthrough='seven-cities-semantic-readthrough-32.json', nextBatch=122)
next_evidence['remainingReview'][0] = ('成都已读6个主体，继续大慈寺、望平街、九眼桥、都江堰、玉林、青羊宫、熊猫谷、博客楼、文殊坊、'
    '东门码头、永陵、灌县古城、浣花溪公园、南桥、四大会馆、永陵博物馆、安仁古镇、四川科技馆；'
    '民宿招募帖1026给春熙路4137与文殊院4136两条住宿参照仍待决；广州塔8100/8108/8133/7693与永庆坊7694待决。')
for item in new_reviews:
    next_evidence['nextEvidence'].append({'city': '成都', 'entityId': item['entityId'],
        'pendingMentionIds': item['pendingMentionIds'], 'conclusion': item['conclusion']})
write('seven-cities-next-evidence-35.json', next_evidence)
lines = ['# 本轮逐项原文阅读记录', '', record['limits'], '', '| 城市 | 地点 | 当前有效提及 | 结论与待办 |', '| --- | --- | --- | --- |']
for review in record['reviews']:
    lines.append('| ' + ' | '.join([review['city'], review['name'],
        '、'.join(str(m['mentionId']) for m in review['mentions']), review['conclusion'].replace('|', '／')]) + ' |')
lines += ['', '证据：[阅读台账](research/seven-cities-semantic-readthrough-32.json)、[下一证据](research/seven-cities-next-evidence-35.json)。', '']
(ROOT.parent / '七城本轮原文复核.md').write_text('\n'.join(lines), encoding='utf-8')
note = record['limits'] + '新增成都人民公园19条、成都博物馆18条、杜甫草堂16条；三主体本批均无待决隔离。'
for path in [ROOT.parent / 'task.json', PARENT / 'task.json']:
    task = read(path)
    assert task['status'] == 'in_progress' and task['meta']['sevenCityContinuation']['latestValidatedEntityBatch'] == '120'
    task['notes'] = task['notes'] + ' ' + note
    task['meta']['sevenCityContinuation'].update(
        semanticReadthrough='10-09-attraction-top30-governance/research/seven-cities-semantic-readthrough-32.json',
        workingStage=note, accepted=False)
    path.write_text(json.dumps(task, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
for name in ['进展记录.md', '七城剩余问题.md']:
    with (ROOT.parent / name).open('a', encoding='utf-8') as handle:
        handle.write('\n## 成都三主体阅读断点\n\n' + note + '\n\n入口：[下一证据](research/seven-cities-next-evidence-35.json)。\n')
print(json.dumps({'readEntities': len(record['reviews']), 'currentMentions': count, 'newMentions': 53,
    'chengduRead': 6, 'pending': {r['name']: r['pendingMentionIds'] for r in new_reviews}, 'accepted': False}, ensure_ascii=False))
