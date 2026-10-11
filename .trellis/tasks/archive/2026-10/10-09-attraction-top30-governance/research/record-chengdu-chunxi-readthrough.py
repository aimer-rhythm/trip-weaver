"""固化成都春熙路20条与文殊院19条实际全文阅读，不执行业务决定。"""
import hashlib
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parent
PARENT = ROOT.parents[1] / '10-06-place-identity-governance'
read = lambda p: json.loads(p.read_bytes())
record = read(ROOT / 'seven-cities-semantic-readthrough-30.json')
raw = (ROOT / record['snapshotFile']).read_bytes()
assert hashlib.sha256(raw).hexdigest() == record['snapshotSha256']
city = next(c for c in json.loads(raw)['cities'] if c['city'] == '成都')
before_city = next(c for c in read(ROOT / 'snapshot-20261010T025803181559Z/input.json')['cities'] if c['city'] == '成都')
assert city['notes'] == before_city['notes'], '既有笔记在冻结前后不一致'
notes = {n['id']: n for n in city['governanceState']['rawNotes']}
before_notes = {n['id']: n for n in before_city['governanceState']['rawNotes']}

cases = [
    ('ed4be252613b69e09ac7125eda97b159', 1697, 20, [4137],
     [(877, '春熙路那种挑担子卖水果的别买，专坑游客'), (889, '时间紧可跳过'),
      (940, '来成都不要再去春熙路人挤人啦'), (920, '➡️春熙路（老成都步行街）'),
      (921, '📍春熙路→📍IFS国金中心'), (956, '春熙路地铁站D口出来'),
      (957, '1. 起点：春熙路'), (961, '每条街都是去了不踩雷'),
      (904, '春熙路8点或8点35出发至都江堰直通车'), (1026, '毗邻文殊院，步行200米即达')],
     '20条/20篇正文已读（图片文字另核）。主体一致：成都核心商业步行街，与IFS国金中心、太古里、大慈寺、镗钯街、'
     '望平街、九眼桥步行串联，地铁2/3号线春熙路站，住宿与逛街首选；主源1697未改，未新增别名。'
     '负评与警示全部保留：877挑担子卖水果专坑游客，940人挤人劝退，889时间紧可跳过并归为偏购物打卡，'
     '950游客多且熊猫正面打卡需排队，902房价偏高人流大。边界单列：春熙路步行街与其周边IFS、太古里、大慈寺、镗钯街、'
     '熊猫书店、熊猫邮局、望平街、九眼桥、春熙路地铁站各为独立对象，不合并、不改坐标。'
     '拟隔离待审1条：4137整篇为空隐禅院民宿试睡招募，正文只有「近春熙路、太古里」的住宿参照，无商圈独立游览文字。'
     '各帖的门票、营业与拥堵描述属原作者观察，不核实现行政策。'),
    ('b9717f74336999b71337e66cd5e0f8d8', 1700, 19, [4136],
     [(879, '文殊院很出片'), (882, '文殊院免费香不用额外花钱请，院内素点心可以浅尝'),
      (899, '📍熊猫基地、成都博物馆、三星堆、东郊记忆、文殊院、九眼桥、玉林路、都江堰、青城山'), (926, '文殊院比文殊坊更值得专门去'),
      (936, '文殊院｜祈福+拍照'), (953, '2️⃣文殊院、武侯祠适合穿新中式 / 素色衣服'),
      (961, '整理了春熙路/玉林路/文殊院/东郊记忆/宽窄巷子/抚琴/望平街'), (1026, '毗邻文殊院，步行200米即达')],
     '19条/19篇正文已读（图片文字另核）。主体一致：千年佛教寺院，免费入园、院内可免费领三支香、素点心与茶馆，'
     '红墙与古建适合拍照祈福，位于成都老城并与文殊坊相邻；主源1700未改，未新增别名。'
     '警示与负评保留：899的既有图片文字提醒不要信门口算命看相的，正文把文殊院列为精华景点；926记录门口有推销、可免费领香但要理性消费、周边商业街易逛成普通步行街。'
     '边界单列：文殊坊是相邻历史文化街区、文殊院地铁站与院内素餐厅/香园各自独立，'
     '926同帖明确「文殊院比文殊坊更值得专门去」，本轮不把两者合并，也不据单帖新增正式组成关系。'
     '拟隔离待审1条：4136整篇为空隐禅院民宿试睡招募，正文只有「毗邻文殊院，步行200米即达」的住宿参照，无寺院独立游览文字。'
     '免费香、开放时间与素斋价格属原作者描述，不核实现行政策。'),
]

new_reviews = []
digest = lambda value: hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
for eid, sid, total, pending, quotes, conclusion in cases:
    assert not any(r['entityId'] == eid for r in record['reviews'])
    entity = next(e for e in city['entities'] if e['entity_id'] == eid)
    assert entity == next(e for e in before_city['entities'] if e['entity_id'] == eid)
    assert entity['revision'] == 1 and entity['primary_place_id'] == sid and entity['aliases'] == [entity['canonical_name']]
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
assert len(record['reviews']) == 57 and count == 976, (len(record['reviews']), count)
record['limits'] = ('57项/976当前有效提及已读；阅读不等于全来源、同体/组成/定位问题闭合，也不等于各城语义已完成。'
    'batch-120为最新完整验证；广州缺运营输入、鼓浪屿与集美大社缺媒体方案暂缓；未验收、不提交、不归档。')


def write(name, value):
    with (ROOT / name).open('x', encoding='utf-8') as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)


write('seven-cities-semantic-readthrough-31.json', record)
next_evidence = read(ROOT / 'seven-cities-next-evidence-33.json')
next_evidence.update(semanticReadthrough='seven-cities-semantic-readthrough-31.json', nextBatch=122)
next_evidence['remainingReview'][0] = ('成都民宿招募帖1026同时给春熙路4137与文殊院4136两条住宿参照，待决；'
    '成都来源隔离同样缺运营输入，先只记录；广州塔8100/8108/8133/7693与永庆坊7694待决；'
    '音乐广场/曾厝垵音乐广场同体与旧坐标、玩月坡海滨边界保留；继续成都其余候选及杭州、西安、重庆全文治理。')
for item in new_reviews:
    next_evidence['nextEvidence'].append({'city': '成都', 'entityId': item['entityId'],
        'pendingMentionIds': item['pendingMentionIds'], 'conclusion': item['conclusion']})
write('seven-cities-next-evidence-34.json', next_evidence)
lines = ['# 本轮逐项原文阅读记录', '', record['limits'], '', '| 城市 | 地点 | 当前有效提及 | 结论与待办 |', '| --- | --- | --- | --- |']
for review in record['reviews']:
    lines.append('| ' + ' | '.join([review['city'], review['name'],
        '、'.join(str(m['mentionId']) for m in review['mentions']), review['conclusion'].replace('|', '／')]) + ' |')
lines += ['', '证据：[阅读台账](research/seven-cities-semantic-readthrough-31.json)、[下一证据](research/seven-cities-next-evidence-34.json)。', '']
(ROOT.parent / '七城本轮原文复核.md').write_text('\n'.join(lines), encoding='utf-8')
note = record['limits'] + '新增成都春熙路20条、文殊院19条；民宿招募帖两条住宿参照待决。'
for path in [ROOT.parent / 'task.json', PARENT / 'task.json']:
    task = read(path)
    assert task['status'] == 'in_progress' and task['meta']['sevenCityContinuation']['latestValidatedEntityBatch'] == '120'
    task['notes'] = task['notes'] + ' ' + note
    task['meta']['sevenCityContinuation'].update(
        semanticReadthrough='10-09-attraction-top30-governance/research/seven-cities-semantic-readthrough-31.json',
        workingStage=note, accepted=False)
    path.write_text(json.dumps(task, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
for name in ['进展记录.md', '七城剩余问题.md']:
    with (ROOT.parent / name).open('a', encoding='utf-8') as handle:
        handle.write('\n## 成都春熙路与文殊院阅读断点\n\n' + note + '\n\n入口：[下一证据](research/seven-cities-next-evidence-34.json)。\n')
print(json.dumps({'readEntities': len(record['reviews']), 'currentMentions': count, 'newMentions': 39,
    'pending': {r['name']: r['pendingMentionIds'] for r in new_reviews}, 'accepted': False}, ensure_ascii=False))
