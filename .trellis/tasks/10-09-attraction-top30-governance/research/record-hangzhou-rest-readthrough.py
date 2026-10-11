"""固化杭州最后10个主体共105条实际全文阅读，完成杭州全城阅读覆盖。"""
import hashlib
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parent
PARENT = ROOT.parents[1] / '10-06-place-identity-governance'
read = lambda p: json.loads(p.read_bytes())
record = read(ROOT / 'seven-cities-semantic-readthrough-41.json')
raw = (ROOT / record['snapshotFile']).read_bytes()
assert hashlib.sha256(raw).hexdigest() == record['snapshotSha256']
city = next(c for c in json.loads(raw)['cities'] if c['city'] == '杭州')
before_city = next(c for c in read(ROOT / 'snapshot-20261010T025803181559Z/input.json')['cities'] if c['city'] == '杭州')
assert city['notes'] == before_city['notes'], '既有笔记在冻结前后不一致'
notes = {n['id']: n for n in city['governanceState']['rawNotes']}
before_notes = {n['id']: n for n in before_city['governanceState']['rawNotes']}
NO_CHANGE = '本批不改字段、不重排。'
SCOPE = '全实体当前提及全文已读；来源/组成/定位边界分别待治理'

cases = [
    ('30c38a874f46124d8d150cf6b6493c50', 4124, 3, 12, [],
     [(1941, '梧桐树下慢慢走'), (2000, '路两边都是树荫'), (2244, '梧桐树荫遮住整条青石板路'),
      (2204, '大兜路：兜来运转'), (2170, '运河边老街，茶馆多')],
     '12条/12篇正文已读（图片文字另核）；该主体此前已有治理修订，当前revision=3、别名含大兜路历史街区。'
     '主体一致：运河边历史街区，梧桐树荫青石板路，沿途甜品店、咖啡店、私房菜与茶馆，免费、无需预约、全天可逛；'
     '主源4124未改。限定保留：2204仅在跨年活动清单里出现「大兜路：兜来运转」市集；'
     '2000写「路两边都是树荫」属城市漫步帖。边界单列：香积寺、小河直街、小河公园、桥西历史街区、拱宸桥、'
     '大运河紫檀博物馆各自独立。' + NO_CHANGE),
    ('200953adc03ce7b1b876584afd57d81c', 4051, 1, 12, [],
     [(1966, '推荐你去西湖以西的茶园秘境——十里琅珰'), (1993, '俯瞰万亩茶园环形山谷'),
      (2246, '十里琅珰石板路雨天湿滑'), (2249, '十里琅珰还是很美的'), (1993, '别踩茶田')],
     '12条提及/11篇正文已读。主体一致：西湖以西的茶园山脊徒步线（梅家坞→三分岔→龙井村），'
     '免费、可俯瞰西湖群山与万亩茶园，是龙井茶核心产区；主源4051未改。'
     '提示与警示保留：2246写「十里琅珰石板路雨天湿滑，怕滑者不建议走」；1993写「别踩茶田、别乱扔垃圾」；'
     '2250写环线约11.5公里、爬升500米；1966给出新手友好与自我挑战两条路线。'
     '边界单列：三分岔、茶山顶凉亭、龙井村、梅家坞、五云山、真际院、九溪十八涧、云栖竹径各自独立。' + NO_CHANGE),
    ('1229a10e95d8414a260e3953e845dc42', 4097, 1, 11, [],
     [(2002, '人不算多，很宁静'), (2118, '羡鹄亭附近'), (2135, '霁虹桥倒影绝美，小众人少景美'),
      (2176, '一步一景，绿意盎然，很洗眼睛')],
     '11条/11篇正文已读（图片文字另核）。主体一致：杨公堤旁的里西湖水湾，霁虹桥倒影、羡鹄亭、武状元坊与'
     '碇步桥为看点，24小时免费开放，多帖强调「人少、宁静、可看流水」；主源4097未改。'
     '限定保留：2180写只是「匆匆走了一圈」、2181写「花偏少但绿意盎然」，属原作者体感；'
     '2002写「最喜欢浴鹄湾，廊桥很有水墨江南意境」。边界单列：杨公堤、茅家埠、乌龟潭、太子湾公园、'
     '花港观鱼、三台山与浴鹄湾各自独立。' + NO_CHANGE),
    ('081c7742f47eaa80675fc74446ed89e2', 4105, 2, 11, [],
     [(1940, '踩着溪中的石墩一路向前'), (2089, '踩石头过溪太有秋游感了'), (2092, '画风从茶山变成溪水'),
      (2093, '涧水通透见底'), (2249, '有很多小溪流')],
     '11条/11篇正文已读（图片文字另核）；该主体此前已有治理修订，当前revision=2。'
     '主体一致：九溪的溪涧玩水路段，石墩过溪、两侧茶园层叠、古树遮阴，免费；曾被记为「雨天青苔湿滑」需防滑；'
     '主源4105未改。限定保留：2092写「别穿薄底鞋或小白鞋」「一定要防蚊」「膝盖不好带登山杖」；'
     '2249写「12.18公里、爬升约500米、补给多、亲子友好」。'
     '边界单列：九溪烟树、九溪公交站、理安寺、杨梅岭、龙井村、十里琅珰、云栖竹径与九溪十八涧各自独立，'
     '本轮不与九溪烟树合并（此前已按「两个同源不同名主体」分开登记）。' + NO_CHANGE),
    ('dbcc0fc49d813f1e241d528553db5bfd', 3988, 1, 11, [],
     [(2217, '成人票60r/人，在“良渚古城遗址公园”提前预约'), (2219, '▫️全程不限次通票：20元/人'),
      (2219, '⏰ 开放时间：9:00—17:00'), (2220, '小鹿比较活跃，16:30就闭园别跑空'),
      (2223, '（良渚古城东门旁，不在遗址公园里面）'), (2217, '小鹿下午4点半就回窝了')],
     '11条/11篇正文已读（图片文字另核）。主体一致：世界文化遗产良渚古城遗址公园，五千年文明实证，'
     '鹿苑、莫角山宫殿遗址、池中寺粮仓、雉山「孤独的树」、反山展示馆为主要点位；'
     '成人票60元、杭州市民与在杭缴满6个月社保免费，须在官方公众号提前实名预约，9:00-17:00、周一闭园'
     '（法定节假日正常开放），园区大建议买20元不限次观光车；主源3988未改。'
     '限定与提示保留：2217写「小鹿下午4点半就回窝」「园内小摊又贵又一般，建议自带干粮和水」；'
     '2219写「暑期太热优先春秋入园」；2223明确粉黛花海在「美人地台地」、位于古城东门旁、不在遗址公园内、'
     '免费无需预约——两处不得互相计入。边界单列：良渚博物院、美人地台地、玉鸟集与国家版本馆各自独立；'
     '票价、闭园日与预约方式按原文保留，不核实现行政策。' + NO_CHANGE),
    ('89004bf26b389ddee3b94fc020d1688d', 4113, 3, 10, [],
     [(1941, '白墙黛瓦、石板路、老屋、红灯笼'), (2236, '一条很常规的步行街'),
      (2238, '清末民初老街，烟火气很足'), (2239, '青石板老街、老民居'), (2153, '桥西历史街区→手工艺活态馆')],
     '10条/10篇正文已读（图片文字另核）；该主体此前已有治理修订，当前revision=3、'
     '别名含拱宸桥西历史文化街区、桥西历史街区。主体一致：京杭大运河畔的清末民初老街，白墙黛瓦青石板，'
     '与拱宸桥相连，街区内有中国刀剪剑/伞/扇博物馆、杭州工艺美术博物馆与大运河博物馆（均免费）；主源4113未改。'
     '限定保留：2236把它写成「一条很常规的步行街」、2241写「四馆须在工艺美术博物馆公众号预约、'
     '周二或周一闭馆」，属原作者与场馆安排。边界单列：拱宸桥（桥体）、博物馆群、小河公园、小河直街、'
     '大兜路历史文化街区各自独立；本轮不把博物馆群并入街区主体、不新建组成关系、不改坐标。' + NO_CHANGE),
    ('ab364fbb29edadc9f019ae4aa771e2d8', 4111, 1, 10, [],
     [(1936, '杨公堤有几个大坡'), (1956, '“过山车”公交车也是不一样的体验'), (1988, '水杉林，秋冬最美'),
      (2074, '杨公堤傍晚18:30后亮灯'), (2180, '沿杨公堤骑车，满眼绿色')],
     '10条/10篇正文已读（图片文字另核）。主体一致：西湖西线堤岸，有独立自行车道、水杉林与起伏坡道，'
     '夜间18:30后亮灯适合夜骑夜游，免费；主源4111未改。'
     '限定保留：1936写「杨公堤有几个大坡，注意体力」；1956把公交起伏形容为「过山车」；'
     '2074写「西湖夜游选杨公堤段，湖滨主街人挤人」；1988写水杉林秋冬最美。'
     '边界单列：苏堤、白堤、茅家埠、乌龟潭、浴鹄湾、曲院风荷与杨公堤各自独立；'
     '杨公堤是堤岸本体，本轮不新建组成关系、不改坐标。' + NO_CHANGE),
    ('865815172fbf7fdf6e1d6bd3339114ae', 4087, 1, 10, [],
     [(2004, '✖️河坊街/南宋御街'), (2036, '南宋御街，实话说没啥好逛的'), (1955, '腊梅掩祠宇，疏影落重门'),
      (2030, '鼓楼 → 南宋御街 → 河坊街 → 大井巷'), (2086, '河坊街/南宋御街')],
     '10条/10篇正文已读（图片文字另核）。主体一致：杭州老城的南宋御街历史街区，与河坊街相连，'
     '青砖黑瓦、老建筑光影、南宋书房与铜雕博物馆为看点，免费开放；主源4087未改。'
     '负评全部保留：2004把「河坊街/南宋御街」列入「不值得去的景点」清单；'
     '2036写「南宋御街，实话说没啥好逛的，路过打个卡就可以走了」，同帖仍推荐望仙阁夜景与鼓楼机位。'
     '边界单列：河坊街、鼓楼、望仙阁、大井巷、十五奎巷、德寿宫、胡雪岩故居、吴山与南宋御街各自独立；'
     '南宋御街与河坊街是两条相连但不同的街，本轮不合并、不新建组成关系、不改坐标。' + NO_CHANGE),
    ('63da99ffcf75b4a333e4b1ea9413ae91', 4096, 1, 9, [],
     [(2011, '桂花品种丰富，红枫、水杉成片'), (2051, '逛逛、深呼吸还是挺畅快的，雨天没什么人'),
      (2118, '品梅苑7：00-17：00'), (2135, '出片的佛头，玉泉鱼跃很好拍'), (2163, '📍p7 杭州植物园')],
     '9条/9篇正文已读（图片文字另核）。主体一致：城北的杭州植物园，玉泉观锦鲤、池边睡莲、灵峰探梅与品梅苑、'
     '桂花品种丰富、林荫大道适合慢逛，佛头与玉泉鱼跃是出片机位；主源4096未改。'
     '限定保留：2051写「第一次去没什么花，但雨天没人、深呼吸畅快，想找的杜鹃园其实是出口」，属原作者体验；'
     '2118写植物园24小时开放、品梅苑7:00-17:00且门票10元。'
     '边界单列：灵峰探梅、品梅苑、玉泉、杭州花圃、郭庄、西溪湿地与植物园各自独立；'
     '梅花节等活动不新建主体；门票与开放时间按原文保留，不核实现行政策。' + NO_CHANGE),
    ('7e8cdca3eac556fd6c5ebdce6d2aef99', 4125, 1, 9, [],
     [(2236, '很清静的木质寺庙'), (2238, '素斋很好吃，手串很好看'), (2239, '铜质唐风建筑，适合顺路收尾'),
      (2241, '打卡运河边唐风古寺'), (2244, '仿唐式的殿宇庄重大气')],
     '9条/9篇正文已读（图片文字另核）。主体一致：京杭大运河边的仿唐/铜质唐风寺庙，殿宇庄重、青灰石塔，'
     '供奉食神（国内少见），寺内素斋（香积斋面）与手串口碑较好；原文门票20元、现场购票、8:00-17:00'
     '（16:30停止入园）、地铁3号线香积寺站C口可达；主源4125未改。'
     '限定保留：2241写「打卡运河边唐风古寺，可顺路体验寺内素餐」；8833写旁边素斋评价高但本人未去；'
     '门票与开放时间按原文保留，不核实现行政策。'
     '边界单列：大兜路历史文化街区、胜利河美食街、香积寺地铁站与香积寺各自独立；'
     '不把「供奉食神」扩写为独立主体或餐饮实体。' + NO_CHANGE),
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
assert len(record['reviews']) == 111 and count == 1737, (len(record['reviews']), count)
record['limits'] = ('111项/1737当前有效提及已读；杭州30行全部主体已入账，阅读不等于全来源、同体/组成/定位问题闭合，'
    '也不等于各城语义已完成。batch-120为最新完整验证；广州缺运营输入、鼓浪屿与集美大社缺媒体方案暂缓；未验收、不提交、不归档。')


def write(name, value):
    with (ROOT / name).open('x', encoding='utf-8') as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)


write('seven-cities-semantic-readthrough-42.json', record)
next_evidence = read(ROOT / 'seven-cities-next-evidence-44.json')
next_evidence.update(semanticReadthrough='seven-cities-semantic-readthrough-42.json', nextBatch=122)
next_evidence['remainingReview'][0] = ('杭州30行已读毕，待核边界：良渚美人地台地粉黛花海在公园外（不得互相计入）；'
    '九溪烟树与九溪十八涧保持两个主体；西湖十景各点位独立成行；杭州待决住宿参照10条。'
    '下一步转西安22个未读主体（永宁门/城楼/城墙机位与夜市review382）。')
for item in new_reviews:
    next_evidence['nextEvidence'].append({'city': '杭州', 'entityId': item['entityId'],
        'pendingMentionIds': item['pendingMentionIds'], 'conclusion': item['conclusion']})
write('seven-cities-next-evidence-45.json', next_evidence)
lines = ['# 本轮逐项原文阅读记录', '', record['limits'], '', '| 城市 | 地点 | 当前有效提及 | 结论与待办 |', '| --- | --- | --- | --- |']
for review in record['reviews']:
    lines.append('| ' + ' | '.join([review['city'], review['name'],
        '、'.join(str(m['mentionId']) for m in review['mentions']), review['conclusion'].replace('|', '／')]) + ' |')
lines += ['', '证据：[阅读台账](research/seven-cities-semantic-readthrough-42.json)、[下一证据](research/seven-cities-next-evidence-45.json)。', '']
(ROOT.parent / '七城本轮原文复核.md').write_text('\n'.join(lines), encoding='utf-8')
note = record['limits'] + '新增杭州大兜路12条、十里琅珰12条、浴鹄湾11条、九溪十八涧11条、良渚古城遗址公园11条、桥西10条、杨公堤10条、南宋御街10条、杭州植物园9条、香积寺9条；杭州30行全部读毕。'
for path in [ROOT.parent / 'task.json', PARENT / 'task.json']:
    task = read(path)
    assert task['status'] == 'in_progress' and task['meta']['sevenCityContinuation']['latestValidatedEntityBatch'] == '120'
    task['notes'] = task['notes'] + ' ' + note
    task['meta']['sevenCityContinuation'].update(
        semanticReadthrough='10-09-attraction-top30-governance/research/seven-cities-semantic-readthrough-42.json',
        workingStage=note, accepted=False)
    path.write_text(json.dumps(task, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
for name in ['进展记录.md', '七城剩余问题.md']:
    with (ROOT.parent / name).open('a', encoding='utf-8') as handle:
        handle.write('\n## 杭州30行阅读全覆盖\n\n' + note + '\n\n入口：[下一证据](research/seven-cities-next-evidence-45.json)。\n')
print(json.dumps({'readEntities': len(record['reviews']), 'currentMentions': count, 'newEntities': 10,
    'newMentions': 105, 'hangzhouRead': 30, 'accepted': False}, ensure_ascii=False))
