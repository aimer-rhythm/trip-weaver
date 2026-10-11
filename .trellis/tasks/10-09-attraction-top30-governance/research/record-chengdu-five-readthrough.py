"""固化成都武侯祠、熊猫基地、东郊记忆、四川博物院、洛带古镇共80条实际全文阅读。"""
import hashlib
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parent
PARENT = ROOT.parents[1] / '10-06-place-identity-governance'
read = lambda p: json.loads(p.read_bytes())
record = read(ROOT / 'seven-cities-semantic-readthrough-34.json')
raw = (ROOT / record['snapshotFile']).read_bytes()
assert hashlib.sha256(raw).hexdigest() == record['snapshotSha256']
city = next(c for c in json.loads(raw)['cities'] if c['city'] == '成都')
before_city = next(c for c in read(ROOT / 'snapshot-20261010T025803181559Z/input.json')['cities'] if c['city'] == '成都')
assert city['notes'] == before_city['notes'], '既有笔记在冻结前后不一致'
notes = {n['id']: n for n in city['governanceState']['rawNotes']}
before_notes = {n['id']: n for n in before_city['governanceState']['rawNotes']}
NO_CHANGE = '本批无拟隔离提及，不改字段、不重排。'

cases = [
    ('300d2ae16b4e2787a84d7661a06f580e', 1688, 2, 26, [],
     [(903, '武侯祠精简游览路线'),
      (903, '👉 惠陵出来进入 锦里古街（免费，不用再次买票）'), (876, '武侯祠吃了闭门羹'),
      (900, '造景比较一般'), (894, '国内罕见的君臣合祀祠庙，红墙竹影很好拍'),
      (912, '⭐必冲高分（9.0+）成都大熊猫繁育研究基地｜东郊记忆｜武侯祠｜人民公园｜文殊院'),
      (913, '下午参观武侯祠，预约了一个小红书推荐的讲解'), (891, '武侯祠门票50，人非常多，顶流'),
      (947, '武侯祠博物馆提前14天预售，50元')],
     '26条/26篇正文已读（图片文字另核）；该主体此前已有治理修订，当前revision=2、别名含武侯祠博物馆。'
     '主体一致：君臣合祀祠庙，红墙竹影是核心机位，门票50元、17:00停止检票，孔明苑（出师表玻璃墙）、惠陵（刘备墓）是园内点位，'
     '东侧紧邻锦里古街（4031明确惠陵出来进锦里、无需再次买票）。主源1688未改。'
     '负评全部保留：876到访时已闭门、吃了闭门羹；900认为本体造景一般、适合三国狂热爱好者；'
     '4062/3579明确对三国无感可跳过、会觉得是普通公园；4172认为讲解太深、景点小人多、体验一般；891写人非常多属顶流。'
     '边界单列：锦里古街、刘湘陵园（选项）、高升桥与武侯祠地铁站、成都武侯祠大街商圈各自独立，'
     '园内孔明苑、惠陵、刘备殿不新建主体；本轮不合并、不改坐标、不新增组成关系。' + NO_CHANGE),
    ('1b93567a71a81d2a0929c921179d5fff', 1693, 3, 25, [],
     [(876, '园区很大 七点半开园 尽量早点来看花花'), (891, '暑假不建议，热且熊猫活动少'),
      (894, '建议留一个上午的时间'), (955, '熊猫基地门票提前3天抢！'),
      (947, '熊猫基地建议提前预约，成人55元，地铁3号线熊猫大道站D口出来打车10分钟就可以到南门'),
      (899, '📍熊猫基地、成都博物馆、三星堆、东郊记忆、文殊院、九眼桥、玉林路、都江堰、青城山')],
     '25条提及/24篇正文已读（图片文字另核）；该主体此前已有治理修订，当前revision=3、'
     '别名含大熊猫基地、大熊猫繁育研究基地、熊猫基地。主体一致：成都看大熊猫的首选园区，'
     '普遍建议上午前往（中午熊猫回屋、观赏性大减），园区大、穿舒适鞋、可买观光车，门票55元、'
     '需提前预约（各帖写3/13/14天放票不一致），花花与西门进等属原作者描述。主源1693未改。'
     '限定与负评保留：891写暑假热且熊猫活动少、不建议暑期前往；926写天气热或下雨熊猫可能不出外场、建议约上午场；'
     '912写一过11点只能看背影、节假日人多；949类长文提醒少带重物。'
     '边界单列：与都江堰熊猫谷是不同园区（921/945分别列出），成都动物园、北湖、熊猫大道地铁站各自独立；'
     '入园预约与票价按原文保留，不核实现行政策。' + NO_CHANGE),
    ('e43abd99a49ccca21dbecc07502c01e1', 1640, 2, 23, [],
     [(939, '受不了人挤人和千篇一律的景点'), (939, '只有东郊记忆才是我的舒适区'),
      (934, '但要避开节假日，不然机位拍照要排队'),
      (891, '东郊记忆有特定想逛的店可以去，纯人造拍照景点，人很多拍照排队'),
      (925, '南大门火车头广场➡️巨型涂鸦墙➡️“成都” 大字墙➡️文创手作街区➡️北街小吃街')],
     '23条/23篇正文已读（图片文字另核）；该主体此前已有治理修订，当前revision=2。'
     '主体一致：由老红光电子厂改造的工业风文创园区，火车头广场（东方红号1519与站牌）、成都墙、'
     '巨型涂鸦墙、星梦剧院、天府设计展览馆为主要点位，地铁8号线东郊记忆站直达，24小时开放、可免费进入。主源1640未改。'
     '负评与限定全部保留：3692写纯人造拍照景点、人多拍照排队；3904写更适合顺路逛、别期待过高；'
     '926写商业化明显、不爱拍照可pass；3447写避开节假日否则机位要排队；'
     '4212的既有图片文字写游客扎堆、打卡点需排队、附近美食溢价高。'
     '边界单列：中车·源STAGE、万科天荟、南大门、北2门、建设路小吃街与东郊记忆站各自独立，'
     '园区内店铺与点位不新建主体；本轮不改字段、不重排。' + NO_CHANGE),
    ('971539fddb70ccb08d4e1acee1ee3f8a', 1950, 3, 4, [],
     [(944, '在我心里，四川博物院一直是被低估的实力派'), (891, '场馆老旧交通也没成博方便'),
      (946, '▪位置：四川博物院'), (947, '四川博物院在青羊区，提前7天放票')],
     '4条/4篇正文已读（图片文字另核）；该主体此前已有治理修订，当前revision=3、别名含四川博物馆。'
     '主体一致：省级综合博物馆，馆藏文物35万件、一级文物2600件，免费但需预约（原文写提前7天放票）、'
     '周二至周日9:00-17:00、周一闭馆，距最近地铁站较远、建议公交至送仙桥站。主源1950未改。'
     '负评与限定保留：891明确「场馆老旧、交通也没成博方便，两者取一只用去成博就行」；'
     '944以永乐宫壁画特展为例肯定内容含金量，并提到中文标注「战国」与英文「Western Zhou」不一致需留意。'
     '边界单列：成都博物馆、杜甫草堂、送仙桥、青羊宫各自独立；特展展期与免费讲解时刻按原文保留，不核实现行政策。' + NO_CHANGE),
    ('99cafde5d39982daf23019eaa6e82032', 1868, 2, 2, [],
     [(1014, '成都以东免费的洛带古镇，更有特色'), (1016, '披着古镇外衣的商业街')],
     '2条/2篇正文已读（图片文字另核）；该主体此前已有治理修订，当前revision=2。'
     '主体一致：成都东部的客家古镇（4A），免费开放，古塔流水、客家土楼、簪花体验与小茶馆被列为看点；主源1868未改。'
     '负评全部保留：1016整篇给出「过度商业化、主街千篇一律、除了博客楼真的没必要去」的负面测评；'
     '1015在同批古镇对比里把洛带排在最末、写「这么个破地方居然能成为4A景区」，两帖立场保留，不因负面而清除古镇身份。'
     '边界单列：博客楼、四大会馆、四方塔、博客小镇、七十二院、五凤楼、洛带大字墙、金龙长城均为古镇内点位，'
     '本轮不新建主体、不合并、不改坐标、不把「一街七巷」拆成独立主体。' + NO_CHANGE),
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
assert len(record['reviews']) == 81 and count == 1189, (len(record['reviews']), count)
record['limits'] = ('81项/1189当前有效提及已读；成都30行全部主体已入账，阅读不等于全来源、同体/组成/定位问题闭合，'
    '也不等于各城语义已完成。batch-120为最新完整验证；广州缺运营输入、鼓浪屿与集美大社缺媒体方案暂缓；未验收、不提交、不归档。')


def write(name, value):
    with (ROOT / name).open('x', encoding='utf-8') as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)


write('seven-cities-semantic-readthrough-35.json', record)
next_evidence = read(ROOT / 'seven-cities-next-evidence-37.json')
next_evidence.update(semanticReadthrough='seven-cities-semantic-readthrough-35.json', nextBatch=122)
next_evidence['remainingReview'][0] = ('成都30行全部读完，待核身份边界：永陵/永陵博物馆疑为同址同体；'
    '民宿招募帖1026给春熙路4137、文殊院4136、文殊坊4135三条住宿参照待决；四川科技馆3763的reason事实排除待按契约审核；'
    '广州塔8100/8108/8133/7693与永庆坊7694待决；下一步转杭州22个未读主体。')
for item in new_reviews:
    next_evidence['nextEvidence'].append({'city': '成都', 'entityId': item['entityId'],
        'pendingMentionIds': item['pendingMentionIds'], 'conclusion': item['conclusion']})
write('seven-cities-next-evidence-38.json', next_evidence)
lines = ['# 本轮逐项原文阅读记录', '', record['limits'], '', '| 城市 | 地点 | 当前有效提及 | 结论与待办 |', '| --- | --- | --- | --- |']
for review in record['reviews']:
    lines.append('| ' + ' | '.join([review['city'], review['name'],
        '、'.join(str(m['mentionId']) for m in review['mentions']), review['conclusion'].replace('|', '／')]) + ' |')
lines += ['', '证据：[阅读台账](research/seven-cities-semantic-readthrough-35.json)、[下一证据](research/seven-cities-next-evidence-38.json)。', '']
(ROOT.parent / '七城本轮原文复核.md').write_text('\n'.join(lines), encoding='utf-8')
note = record['limits'] + '新增成都武侯祠26条、熊猫基地25条、东郊记忆23条、四川博物院4条、洛带古镇2条，成都30行全部读毕。'
for path in [ROOT.parent / 'task.json', PARENT / 'task.json']:
    task = read(path)
    assert task['status'] == 'in_progress' and task['meta']['sevenCityContinuation']['latestValidatedEntityBatch'] == '120'
    task['notes'] = task['notes'] + ' ' + note
    task['meta']['sevenCityContinuation'].update(
        semanticReadthrough='10-09-attraction-top30-governance/research/seven-cities-semantic-readthrough-35.json',
        workingStage=note, accepted=False)
    path.write_text(json.dumps(task, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
for name in ['进展记录.md', '七城剩余问题.md']:
    with (ROOT.parent / name).open('a', encoding='utf-8') as handle:
        handle.write('\n## 成都30行阅读全覆盖\n\n' + note + '\n\n入口：[下一证据](research/seven-cities-next-evidence-38.json)。\n')
print(json.dumps({'readEntities': len(record['reviews']), 'currentMentions': count, 'newEntities': 5,
    'newMentions': 80, 'chengduRead': 30, 'accepted': False}, ensure_ascii=False))
