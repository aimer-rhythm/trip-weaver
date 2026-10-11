"""固化滨海三候选及音乐广场全称旧根59条实际全文阅读，不执行业务决定。"""
import hashlib
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parent
PARENT = ROOT.parents[1] / '10-06-place-identity-governance'
read = lambda p: json.loads(p.read_bytes())
record = read(ROOT / 'seven-cities-semantic-readthrough-25.json')
raw = (ROOT / record['snapshotFile']).read_bytes()
assert hashlib.sha256(raw).hexdigest() == record['snapshotSha256']
city = next(c for c in json.loads(raw)['cities'] if c['city'] == '厦门')
read_city = next(c for c in read(ROOT / 'snapshot-20261010T012326125575Z/input.json')['cities'] if c['city'] == '厦门')
assert city['notes'] == read_city['notes']
notes = {n['id']: n for n in city['governanceState']['rawNotes']}
old_notes = {n['id']: n for n in read_city['governanceState']['rawNotes']}
cases = [
    ('0d488a92ea70a2dc794f5a6b0dab6d71', 19, [],
     [(1342, '1️⃣2⃣️-1️⃣3⃣️ 音乐广场：涨潮时候比较好拍，这边还有鹅卵石沙滩'),
      (1278, '音乐广场对面就是天泉步道广场'), (1355, '拍照好看的地方都要排队')],
     '19条/19篇正文及既有图片文字已读。海边绿道、鹅卵石沙滩、长椅、珍珠湾至天泉步道路线高度一致；5439排队负评保留，5513的photo_spot标签不等于另一个经营场所。'
     '旧主源2544却在湖滨南路/斗西路，坐标24.467453/118.084312与滨海文字冲突；另有曾厝垵音乐广场2698旧根3条，不能将两个可疑坐标之一直接当正确位置。'
     '须结合公开位置依据核定全简称及旧来源身份；当前不并根、不改坐标、不宣称定位可用。5489音乐氛围等弱推断和5513全程概述仍不等于逐事实已核。'),
    ('78c1fde81fb990a665712a8547b66f4b', 19, [5663, 6322, 6918],
     [(1260, '✅神仙机位：别挤沙滩入口！往椰风寨方向走100米，人比入口少80%，整条无遮挡海平线都是你的'),
      (1580, '椰风寨🥥（环岛路必打卡，星空营地绝美！）'),
      (1243, '4️⃣椰风寨：有“你好厦门”地标和一国两制标语')],
     '19条/19篇全文及既有图片文字已读。5663只在黄厝日出攻略中作朝向参照，正文没有椰风寨独立游览，图片文字为空，拟隔离为待审来源，不新建机位。'
     '其余明确路线、骑行起点与海边体验先保留。5407/6113把椰风寨—黄厝海滨及店名并列，5515用off work作定位但有独立沿海路线，不能仅因咖啡关键词整条隔离。'
     '6322露营清单的星空营地未具唯一经营主体；6918把你好厦门及一国两制标语混写，两条边界继续核查，不将营地或标语自动并入景点，也不确认当前露营政策。'),
    ('adc546a8c2cabb013f3ddcb54ab170f2', 18, [5517, 5738, 6599],
     [(1347, '3️⃣玩月坡:定位不在书店，孤独树面朝大海，外围草坪不用消费也能取景，氛围感直接拉满。'),
      (1351, '椰风寨 ➡️ 玩月坡 ➡️ 海韵台'),
      (1501, '这边有一些比较好看的书店和咖啡店')],
     '18条/18篇全文及既有图片文字已读，均有明确路线、玩月坡地名或坡地/草坪/沙滩游览语境；photo_spot抽取类型不据此移出景点。'
     '5517原文兼具路线与书店外草坪，保留地点身份，外围草坪与店内消费边界继续核定；5634/6499明确有海边路/草坪，也提周边咖啡，不能整条转给咖啡店。'
     '5738引用横跨椰风寨、玩月坡、海韵台的全路段设施，6599书店咖啡未具名，具体设施归属待核；不扩写事实，不确认营业或露营。当前不并入黄厝沙滩或不在书店。'),
    ('4ef6b7e0cbd40af6165e47205223f7a6', 3, [],
     [(1247, '4️⃣曾厝垵音乐广场（📍曾厝垵音乐广场/曾山站）'),
      (1351, '📍定位：曾厝垵音乐广场（记住不是曾厝垵！坐公交认准曾山站❗）'),
      (1487, '4️⃣曾厝垵音乐广场（📍曾厝垵音乐广场/曾山站）')],
     '作为音乐广场相关旧根补读3条/3篇全文，均指向曾山站、海岸长椅和鹅卵石沙滩。1351先介绍邻近餐厅再明确饭后广场出发，保留独立游览身份，不把餐厅菜品移入。'
     '旧地址曾厝垵与坐标24.447955/118.063212存在冲突，全简称同体及正确定位待公开补证；不能把它并入曾厝垵村落。此项为候选边界阅读，不冒充新增Top30名额。'),
]

def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()

new_reviews = []
for eid, total, pending, quotes, conclusion in cases:
    assert not any(r['entityId'] == eid for r in record['reviews'])
    entity = next(e for e in city['entities'] if e['entity_id'] == eid)
    assert entity == next(e for e in read_city['entities'] if e['entity_id'] == eid)
    rows = [m for m in city['mentions'] if m['entityId'] == eid]
    assert rows == [m for m in read_city['mentions'] if m['entityId'] == eid]
    ids = sorted({m['raw_note_id'] for m in rows})
    assert len(rows) == len(ids) == total
    for nid in ids:
        assert notes[nid] == old_notes[nid]
    for nid, quote in quotes:
        assert nid in ids and quote in city['notes'][str(nid)]['note_desc']
    item = {'city': '厦门', 'entityId': eid, 'name': entity['canonical_name'], 'expectedRevision': entity['revision'],
        'identityRetained': True, 'fullFactsReviewed': False, 'scope': '全文及已有图片文字已读；来源/组成/定位边界分别待治理',
        'mentions': [{'mentionId': m['id'], 'inputHash': m['inputHash'], 'resolution': m['resolution']} for m in rows],
        'reviewedSourceMentionIds': [m['id'] for m in rows],
        'noteEvidence': [{'noteId': nid, 'noteDescSha256': hashlib.sha256(city['notes'][str(nid)]['note_desc'].encode()).hexdigest(),
            'fullFrozenNoteSha256': digest(city['notes'][str(nid)]), 'rawNoteSha256': digest(notes[nid])} for nid in ids],
        'existingImageTextEvidence': [{'noteId': nid, 'rawNoteSha256': digest(notes[nid]),
            'textImageIndices': [i for i, value in enumerate(notes[nid]['img_analysis'] or []) if isinstance(value, dict) and value.get('has_text')]} for nid in ids],
        'readSnapshotFile': 'snapshot-20261010T012326125575Z/input.json', 'reusedAfterFullEntityMentionsAndNotesComparison': True,
        'noteQuotes': [{'noteId': nid, 'quote': quote} for nid, quote in quotes], 'conclusion': conclusion,
        'pendingMentionIds': pending, 'businessMutationByThisRecord': False, 'userAcceptance': False}
    if eid == '78c1fde81fb990a665712a8547b66f4b':
        item['nextProposedBatch'] = 'batch-120'
    new_reviews.append(item)
record['reviews'].extend(new_reviews)
count = sum(len(r['mentions']) for r in record['reviews'])
assert len(record['reviews']) == 51 and count == 789
record['limits'] = '51项/789当前有效提及已读（含音乐广场全称旧根3条边界阅读）；阅读不等于全来源、同体/组成/定位问题闭合。119-v2为最新完整验证；未验收。'

def write(name, value):
    with (ROOT / name).open('x', encoding='utf-8') as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)

write('seven-cities-semantic-readthrough-26.json', record)
next_evidence = read(ROOT / 'seven-cities-next-evidence-28.json')
next_evidence.update(semanticReadthrough='seven-cities-semantic-readthrough-26.json', nextBatch=120)
next_evidence['remainingReview'][0] = '椰风寨5663黄厝方向参照先完整scope预演；音乐广场/曾厝垵音乐广场同体与两个旧坐标待核，玩月坡及海滨商店/设施边界保留。其余厦门候选及广州、成都、杭州、西安、重庆继续全文治理。'
for item in new_reviews:
    next_evidence['nextEvidence'].append({'city': '厦门', 'entityId': item['entityId'],
        'pendingMentionIds': item['pendingMentionIds'], 'conclusion': item['conclusion']})
write('seven-cities-next-evidence-29.json', next_evidence)
lines = ['# 本轮逐项原文阅读记录', '', record['limits'], '', '| 城市 | 地点 | 当前有效提及 | 结论与待办 |', '| --- | --- | --- | --- |']
for item in record['reviews']:
    lines.append('| ' + ' | '.join([item['city'], item['name'], '、'.join(str(m['mentionId']) for m in item['mentions']), item['conclusion'].replace('|', '／')]) + ' |')
lines += ['', '证据：[阅读台账](research/seven-cities-semantic-readthrough-26.json)、[下一证据](research/seven-cities-next-evidence-29.json)。', '']
(ROOT.parent / '七城本轮原文复核.md').write_text('\n'.join(lines), encoding='utf-8')
note = record['limits'] + '已补读三候选56条及音乐广场全称旧根3条；不直接改可疑定位。'
for path in [ROOT.parent / 'task.json', PARENT / 'task.json']:
    task = read(path)
    assert task['status'] == 'in_progress' and task['meta']['sevenCityContinuation']['latestValidatedEntityBatch'] == '119-v2'
    task['notes'] += ' ' + note
    task['meta']['sevenCityContinuation'].update(semanticReadthrough='10-09-attraction-top30-governance/research/seven-cities-semantic-readthrough-26.json', workingStage=note, accepted=False)
    path.write_text(json.dumps(task, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
for name in ['进展记录.md', '七城剩余问题.md']:
    with (ROOT.parent / name).open('a', encoding='utf-8') as handle:
        handle.write('\n## 滨海三候选及音乐广场旧根复核\n\n' + note + '\n')
print(json.dumps({'readEntities': 51, 'currentMentions': count, 'newReadMentions': 59, 'latestValidatedBatch': '119-v2', 'accepted': False}))
