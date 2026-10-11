"""固化成都大慈寺15条、望平街14条、九眼桥11条、都江堰7条、玉林4条、青羊宫4条实际全文阅读。"""
import hashlib
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parent
PARENT = ROOT.parents[1] / '10-06-place-identity-governance'
read = lambda p: json.loads(p.read_bytes())
record = read(ROOT / 'seven-cities-semantic-readthrough-32.json')
raw = (ROOT / record['snapshotFile']).read_bytes()
assert hashlib.sha256(raw).hexdigest() == record['snapshotSha256']
city = next(c for c in json.loads(raw)['cities'] if c['city'] == '成都')
before_city = next(c for c in read(ROOT / 'snapshot-20261010T025803181559Z/input.json')['cities'] if c['city'] == '成都')
assert city['notes'] == before_city['notes'], '既有笔记在冻结前后不一致'
notes = {n['id']: n for n in city['governanceState']['rawNotes']}
before_notes = {n['id']: n for n in before_city['governanceState']['rawNotes']}

cases = [
    ('7b3b4ea71ece5af546bdb526c6d7f096', 1734, 15, [],
     [(922, '大慈寺庙免费开放，无需预约'), (923, '北门入口直接打卡古寺网红红墙'),
      (941, '📷拍可爱小和尚'), (894, '探访藏于闹市中的千年古寺'),
      (905, '把春熙路深度逛法、大慈寺拜佛顺序等避坑细节都梳理好了')],
     '15条/15篇正文已读（图片文字另核）。主体一致：位于太古里旁的千年古寺，别名大慈寺庙，免费开放、无需预约，'
     '红墙、飞檐、百年银杏与园内大头和尚塑像是主要打卡点，也可祈福喝茶；主源1734未改。'
     '负评与限定保留：926的既有图片文字记「单独跑大慈寺不值得，无功无过」，905把开放时间写作8:00-17:30，'
     '属原作者观察，不核实现行开放与香火政策。边界单列：太古里、IFS国金中心、春熙路、镗钯街、熊猫书店、望平街'
     '与大慈寺各为独立对象，本轮不合并、不新建正式组成关系。本批无拟隔离提及，不改字段、不重排。'),
    ('5ee7b4685ba2b83646041935c2524b92', 1694, 14, [],
     [(915, '望平街：滨水休闲、时髦烟火、从早逛到晚'), (925, '望平滨河路➡️几何书店'),
      (941, '📷拍倒立熊猫 绿色成都墙'), (902, '第1⃣️天：太古里-大慈寺-IFS-春熙路-望平街-玉林路')],
     '14条/14篇正文已读（图片文字另核）。主体一致：府南河畔的滨水休闲街，咖啡馆、文创小店与美食密集，'
     '几何书店、香香巷、倒立熊猫与绿色成都墙是主要点位，适合citywalk与夜间散步；主源1694未改。'
     '限定保留：899的既有图片文字记「望平街街道很短，十分钟走完，集市下午才开摊」，作为原作者体感保留，'
     '不据此改字段。边界单列：915同帖把望平街、镗钯街、东顺南街三条并列描述，'
     '几何书店、香香巷、熊猫邮局、大慈寺、太古里、东郊记忆各自独立，不合并、不改坐标。'
     '本批无拟隔离提及，不改字段、不重排。'),
    ('59dcf789eba7329886b594d1abc50ceb', 1702, 11, [],
     [(894, '夜晚散步好去处，一边是古廊桥的诗意'), (953, '九眼桥夜景建议 20:00 以后去'),
      (945, 'Day1：春熙路→太古里→大慈寺→望平街→九眼桥')],
     '11条/11篇正文已读（图片文字另核）。主体一致：锦江边的夜景与酒吧街地标，与安顺廊桥相邻，'
     '明确宜晚上亮灯后前往；主源1702未改。负评全部保留：950的既有图片文字写「九眼桥白天没看头、酒吧消费偏高」，'
     '926写「白天很普通，酒吧段晚上吵，不喜欢夜生活可不去」，3578写「只适合晚上看夜景，不喝酒没必要专门去，十分钟走完」。'
     '边界单列：安顺廊桥、东门码头、府南河沿岸、九眼桥地铁站各自独立，857同帖只把廊桥与九眼桥写成紧挨着的两站；'
     '本轮不合并、不新建正式组成关系、不改坐标。本批无拟隔离提及，不改字段、不重排。'),
    ('59e252f7df75a1778dfb3db5b456c46e', 1785, 7, [],
     [(926, '都江堰景区我觉得一定要去，鱼嘴、飞沙堰、宝瓶口一路走下来很长见识'),
      (910, '打卡世界文化遗产千年水利奇观'), (904, '春熙路8点或8点35出发至都江堰直通车')],
     '7条/7篇正文已读（图片文字另核）。主体一致：世界文化遗产级古代水利工程，别名都江堰景区；'
     '鱼嘴、飞沙堰、宝瓶口为核心看点是多帖一致意见，作者普遍提示景区大、费腿、建议请讲解，南桥蓝眼泪宜晚上7点后；'
     '主源1785未改。门票80元、8:00-18:00与教师节免大门票等属原作者与活动描述，不核实现行票价或优惠。'
     '边界单列：945把熊猫谷→仰天窝广场→灌县古城→都江堰→南桥串成一条线，斜杠两侧各为独立对象，'
     '南桥、灌县古城、青城山、熊猫谷与都江堰不合并、不改坐标。本批无拟隔离提及，不改字段、不重排。'),
    ('152e23c5d2a78351317d41bf9400fd4b', 1812, 4, [],
     [(879, '一半人文历史，一半市井烟火'),
      (925, 'citywalk路线：芳华横街➡️芳华街➡️玉林综合市场➡️玉林东路➡️玉林西路'),
      (941, '玉林街➠熊猫书店➠IFS国金➠大慈寺➠熊猫邮局➠望平街➠东郊记忆➠中车·源STAGE')],
     '4条/4篇正文已读（图片文字另核）。主体一致：老成都烟火气街区，别名玉林街；'
     '芳华横街、芳华街、玉林综合市场、玉林东路、玉林西路的citywalk路线与街边门头大字墙是主要看点；主源1812未改。'
     '限定与保留：926的既有图片文字写「玉林路没必要排队」，899写「玉林路很多小店上午不开门，别去太早」，'
     '均作原作者体感保留。边界单列：赵雷歌里的小酒馆、玉林综合市场、熊猫书店、芳华街是街区内点位而非独立主体，'
     '本轮不新建主体；地铁8号线芳草街站在原文中作为到达方式，不并入街区。本批无拟隔离提及，不改字段、不重排。'),
    ('ab0e5c469b7e56bdc8d497acb47ed949', 1761, 4, [],
     [(878, 'Day3：成都博物馆—宽窄巷子—奎星楼街—青羊宫—泡桐树街'),
      (891, '青羊宫：门票5元，清幽去处'), (928, 'DAY3：青羊宫→宽窄巷子→人民公园→武侯祠博物馆→玉林街')],
     '4条/4篇正文已读（图片文字另核）。主体一致：川西著名道教宫观，清幽、可求签，适合与杜甫草堂、'
     '四川博物院、浣花溪顺路安排；主源1761未改。门票在各帖写作5元或10元、解签免费等不一致，'
     '保持原抽取与原文，不确认现行票价或求签规则。负评与限定保留：950的既有图片文字写「青羊宫院内指向不明、容易迷路」，'
     '926写「不建议专程跨城来」，均作原作者体感保留。边界单列：杜甫草堂、四川博物院、浣花溪公园、宽窄巷子、'
     '奎星楼街与青羊宫地铁站各自独立，本轮不合并、不改坐标。本批无拟隔离提及，不改字段、不重排。'),
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
assert len(record['reviews']) == 66 and count == 1084, (len(record['reviews']), count)
record['limits'] = ('66项/1084当前有效提及已读；阅读不等于全来源、同体/组成/定位问题闭合，也不等于各城语义已完成。'
    'batch-120为最新完整验证；广州缺运营输入、鼓浪屿与集美大社缺媒体方案暂缓；未验收、不提交、不归档。')


def write(name, value):
    with (ROOT / name).open('x', encoding='utf-8') as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)


write('seven-cities-semantic-readthrough-33.json', record)
next_evidence = read(ROOT / 'seven-cities-next-evidence-35.json')
next_evidence.update(semanticReadthrough='seven-cities-semantic-readthrough-33.json', nextBatch=122)
next_evidence['remainingReview'][0] = ('成都已读12个主体，继续熊猫谷、博客楼、文殊坊、东门码头、永陵、灌县古城、浣花溪公园、南桥、'
    '四大会馆、永陵博物馆、安仁古镇、四川科技馆；民宿招募帖1026给春熙路4137与文殊院4136两条住宿参照仍待决；'
    '广州塔8100/8108/8133/7693与永庆坊7694待决。')
for item in new_reviews:
    next_evidence['nextEvidence'].append({'city': '成都', 'entityId': item['entityId'],
        'pendingMentionIds': item['pendingMentionIds'], 'conclusion': item['conclusion']})
write('seven-cities-next-evidence-36.json', next_evidence)
lines = ['# 本轮逐项原文阅读记录', '', record['limits'], '', '| 城市 | 地点 | 当前有效提及 | 结论与待办 |', '| --- | --- | --- | --- |']
for review in record['reviews']:
    lines.append('| ' + ' | '.join([review['city'], review['name'],
        '、'.join(str(m['mentionId']) for m in review['mentions']), review['conclusion'].replace('|', '／')]) + ' |')
lines += ['', '证据：[阅读台账](research/seven-cities-semantic-readthrough-33.json)、[下一证据](research/seven-cities-next-evidence-36.json)。', '']
(ROOT.parent / '七城本轮原文复核.md').write_text('\n'.join(lines), encoding='utf-8')
note = record['limits'] + '新增成都大慈寺、望平街、九眼桥、都江堰、玉林、青羊宫共55条；六主体本批均无待决隔离。'
for path in [ROOT.parent / 'task.json', PARENT / 'task.json']:
    task = read(path)
    assert task['status'] == 'in_progress' and task['meta']['sevenCityContinuation']['latestValidatedEntityBatch'] == '120'
    task['notes'] = task['notes'] + ' ' + note
    task['meta']['sevenCityContinuation'].update(
        semanticReadthrough='10-09-attraction-top30-governance/research/seven-cities-semantic-readthrough-33.json',
        workingStage=note, accepted=False)
    path.write_text(json.dumps(task, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
for name in ['进展记录.md', '七城剩余问题.md']:
    with (ROOT.parent / name).open('a', encoding='utf-8') as handle:
        handle.write('\n## 成都六主体阅读断点\n\n' + note + '\n\n入口：[下一证据](research/seven-cities-next-evidence-36.json)。\n')
print(json.dumps({'readEntities': len(record['reviews']), 'currentMentions': count, 'newMentions': 55,
    'chengduRead': 12, 'accepted': False}, ensure_ascii=False))
