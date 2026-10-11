"""固化厦门菽庄花园16条、集美大社15条、屿见闽南14条实际全文阅读。"""
import hashlib, json, sys
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parent
PARENT = ROOT.parents[1] / '10-06-place-identity-governance'
read = lambda p: json.loads(p.read_bytes())
record = read(ROOT / 'seven-cities-semantic-readthrough-44.json')
raw = (ROOT / record['snapshotFile']).read_bytes()
assert hashlib.sha256(raw).hexdigest() == record['snapshotSha256']
city = next(c for c in json.loads(raw)['cities'] if c['city'] == '厦门')
before = next(c for c in read(ROOT / 'snapshot-20261010T025803181559Z/input.json')['cities'] if c['city'] == '厦门')
assert city['notes'] == before['notes']
notes = {n['id']: n for n in city['governanceState']['rawNotes']}
before_notes = {n['id']: n for n in before['governanceState']['rawNotes']}
S = '全实体当前提及全文已读；来源/组成/定位边界分别待治理'
N = '本批不改字段、不重排。'
cases = [
 ('b8d4d863adee19b4bf2bf5b0157bde9b', 2703, 1, 16, [],
  [(1248, '厦门会惩罚每一个不做攻略就冲来的P人'), (1259, '厦门懒人版3日行程，顺路不绕路'),
   (1280, '厦门，福州高铁1.5h可达'), (1324, '刚从鼓浪屿踩完所有坑回来'),
   (1325, '菽庄花园（门票30/人)'), (1325, '里面好拍的景也是蛮多的'),
   (1353, '菽庄花园：枕山藏海'), (1504, '菽庄花园（钢琴博物馆）')],
  '16条/16篇正文已读（图片文字另核）。主体一致：鼓浪屿上的枕山藏海式园林，园内即钢琴博物馆（同一检票口进入、可连游），'
  '四十四桥、十二洞天与出口阳台看海是主要看点；原文门票30元、8:30-17:30，联票（五景点起购）约116元/人。主源2703未改。'
  '负评与限定保留：1325写「下午两三点非常热，实在待不了太久」；1328写里面不错、钢琴博物馆有空调但没座位；'
  '1504写「钢琴博物馆出口的阳台」看海角度好；1280写「游客只能从厦鼓码头坐船、船票35元往返、提前1-3天订」。'
  '边界单列：钢琴博物馆（园内场馆）、日光岩、皓月园、管风琴艺术中心、八卦楼与菽庄花园各自独立；'
  '本轮不把钢琴博物馆拆成独立主体、不并入鼓浪屿主体、不改坐标。' + N),
 ('dafedd5497103f30ffe872b05101fd92', 2654, 1, 15, [],
  [(1243, '广州南→深圳北→厦门站'), (1246, '厦门真的太适合松弛度假了'), (1263, '这段时间去厦门太舒服了'),
   (1265, '大社太太太好逛啦'), (1285, 'Day 1️⃣ 海上地铁+集美文艺'), (1291, '幸福来敲门 记得开厦门！'),
   (1355, '我住在中山街去哪都还挺方便的'), (1451, '马年春节，厦门精彩活动抢先看'),
   (1481, '元旦和好朋友去厦门跨年'), (1493, '厦门真的是一座很浪漫的城市！'),
   (1513, '厦门中秋活动，厦门通都为你整理好了'), (1514, 'Day 1🌿10:00出发'),
   (1517, '来厦门旅游，一定要留一天给集美！'), (1544, '厦门真的很适合慢慢逛，但景点分散＋海岸线长')],
  '15条/15篇正文已读（图片完整粘贴）。主体一致：集美学村片区的老闽南居民区（大社），嘉庚风格建筑、老厝小巷、'
  '文艺小店与金鱼冰箱贴等打卡点，适合半天Citywalk，多帖把它排在石鼓路之后、嘉庚公园之前。主源2654未改。'
  '限定与提示保留：1355写「不建议太早去，会发现店都没开门」；1265写「来厦门很值得花半天时间来走走逛逛」；'
  '1481写「大社有点像南头古城，走走逛逛挺舒服」；1246给出「集美大社→嘉庚公园步行27分钟、集美大社→十里长堤步行36分钟」；'
  '1451/1513只在春节、中秋活动清单里出现「集美大社」活动条目，不作活动主体。'
  '边界单列：集美学村、石鼓路、嘉庚公园、龙舟池、南薰楼群、陈嘉庚纪念馆、十里长堤、楚雨荨家与集美大社各自独立；'
  '本轮不把大社并入集美学村主体、不新建组成关系、不改坐标。' + N),
 ('850ea2338bae971418ae9cc160de5666', 2667, 1, 14, [],
  [(1248, '厦门会惩罚每一个不做攻略就冲来的P人'), (1249, '终于整理出不赶路、不踩雷的厦门懒人旅行'),
   (1289, '暑假小尾巴安排厦门旅游'), (1291, '幸福来敲门 记得开厦门！'), (1348, '来厦门玩按片区规划路线很省心'),
   (1354, '暑假结束 马上进入淡季'), (1380, '厦门出行交通'), (1434, '和闺蜜刚从厦门旅游回来'),
   (1454, '春节假期，很适合带长辈来厦门'), (1493, '厦门真的是一座很浪漫的城市！'),
   (1519, '厦门6-7月出行天气指南'), (1520, '全干货！！端午计划来厦门旅游的速速码住！'),
   (1544, '厦门真的很适合慢慢逛，但景点分散＋海岸线长')],
  '14条/14篇正文已读（图片文字另核）。主体一致：全室内国风主题乐园（邻近东渡客运码头，步行约300米），'
  '以沉浸式穿越、NPC互动、近百场演艺与换装打卡为卖点，全馆恒温、不怕晒不怕雨，被视为正午与雨天首选，'
  '并常被安排在鼓浪屿之后的同一天。原文门票68元起、需提前预约，工作日9:30-18:30、周末与法定节假日9:30-20:30，'
  '抢票提前3天。主源2667未改。限定保留：1354写「一下动车直奔这6️⃣个地方」把它与黄厝、彩虹沙滩、山海步道、嘉庚公园并列；'
   '1434写「正午太阳毒辣时优先安排室内景点，屿见闽南全室内」；1291写「从东渡客运码头步行300m到达」。'
  '票价、场次与抢票窗口按原文保留，不核实现行政策。'
  '边界单列：鼓浪屿、东渡客运码头、海湾公园、中山路、八市与屿见闽南各自独立；'
  '屿见闽南是独立经营景区，本轮不并入鼓浪屿、不新建组成关系、不改坐标。' + N),
]
new_reviews = []
digest = lambda v: hashlib.sha256(json.dumps(v, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
for eid, sid, rev, total, pending, quotes, conclusion in cases:
    assert not any(r['entityId'] == eid for r in record['reviews'])
    e = next(x for x in city['entities'] if x['entity_id'] == eid)
    assert e == next(x for x in before['entities'] if x['entity_id'] == eid) and e['revision'] == rev and e['primary_place_id'] == sid
    rows = [m for m in city['mentions'] if m['entityId'] == eid]
    assert rows == [m for m in before['mentions'] if m['entityId'] == eid]
    ids = sorted({m['raw_note_id'] for m in rows})
    assert len(rows) == total, (e['canonical_name'], len(rows))
    for nid in ids:
        assert notes[nid] == before_notes[nid]
    for nid, q in quotes:
        assert nid in ids and q in city['notes'][str(nid)]['note_desc'], (e['canonical_name'], nid, q)
    new_reviews.append({'city': '厦门', 'entityId': eid, 'name': e['canonical_name'], 'expectedRevision': e['revision'],
        'identityRetained': True, 'fullFactsReviewed': False, 'scope': S,
        'mentions': [{'mentionId': m['id'], 'inputHash': m['inputHash'], 'resolution': m['resolution']} for m in rows],
        'reviewedSourceMentionIds': [m['id'] for m in rows],
        'noteEvidence': [{'noteId': nid, 'noteDescSha256': hashlib.sha256(city['notes'][str(nid)]['note_desc'].encode()).hexdigest(),
            'fullFrozenNoteSha256': digest(city['notes'][str(nid)]), 'rawNoteSha256': digest(notes[nid])} for nid in ids],
        'existingImageTextEvidence': [{'noteId': nid, 'rawNoteSha256': digest(notes[nid]),
            'textImageIndices': [i for i, v in enumerate(notes[nid]['img_analysis'] or []) if isinstance(v, dict) and v.get('has_text')]} for nid in ids],
        'readSnapshotFile': 'snapshot-20261010T031749976332Z/input.json',
        'reusedAfterFullEntityMentionsAndNotesComparison': True,
        'noteQuotes': [{'noteId': nid, 'quote': q} for nid, q in quotes], 'conclusion': conclusion,
        'pendingMentionIds': pending, 'businessMutationByThisRecord': False, 'userAcceptance': False})
record['reviews'].extend(new_reviews)
count = sum(len(r['mentions']) for r in record['reviews'])
assert len(record['reviews']) == 117 and count == 1841, (len(record['reviews']), count)
record['limits'] = ('117项/1841当前有效提及已读；阅读不等于全来源、同体/组成/定位问题闭合，也不等于各城语义已完成。'
    'batch-120为最新完整验证；广州缺运营输入、鼓浪屿与集美大社缺媒体方案暂缓；未验收、不提交、不归档。')
def write(n, v):
    with (ROOT / n).open('x', encoding='utf-8') as h: json.dump(v, h, ensure_ascii=False, indent=2)
write('seven-cities-semantic-readthrough-45.json', record)
ne = read(ROOT / 'seven-cities-next-evidence-47.json')
ne.update(semanticReadthrough='seven-cities-semantic-readthrough-45.json', nextBatch=122)
ne['remainingReview'][0] = ('厦门已读20个主体，继续幸福路13、嘉庚公园11、皓月园10、溪头下9、彩虹沙滩9、鼓浪屿管风琴艺术中心9、'
    '山海步道8、上李水库8、海湾公园7、盼归塔7；西安已读钟楼，待读城墙(review426)、大唐不夜城(review382)等26个主体。')
for it in new_reviews:
    ne['nextEvidence'].append({'city': '厦门', 'entityId': it['entityId'], 'pendingMentionIds': it['pendingMentionIds'], 'conclusion': it['conclusion']})
write('seven-cities-next-evidence-48.json', ne)
lines = ['# 本轮逐项原文阅读记录', '', record['limits'], '', '| 城市 | 地点 | 当前有效提及 | 结论与待办 |', '| --- | --- | --- | --- |']
for r in record['reviews']:
    lines.append('| ' + ' | '.join([r['city'], r['name'], '、'.join(str(m['mentionId']) for m in r['mentions']), r['conclusion'].replace('|', '／')]) + ' |')
lines += ['', '证据：[阅读台账](research/seven-cities-semantic-readthrough-45.json)、[下一证据](research/seven-cities-next-evidence-48.json)。', '']
(ROOT.parent / '七城本轮原文复核.md').write_text('\n'.join(lines), encoding='utf-8')
note = record['limits'] + '新增厦门菽庄花园16条、集美大社15条、屿见闽南14条。'
for p in [ROOT.parent / 'task.json', PARENT / 'task.json']:
    t = read(p); assert t['status'] == 'in_progress'
    t['notes'] += ' ' + note
    t['meta']['sevenCityContinuation'].update(semanticReadthrough='10-09-attraction-top30-governance/research/seven-cities-semantic-readthrough-45.json', workingStage=note, accepted=False)
    p.write_text(json.dumps(t, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
for n in ['进展记录.md', '七城剩余问题.md']:
    with (ROOT.parent / n).open('a', encoding='utf-8') as h:
        h.write('\n## 厦门菽庄花园等三主体阅读断点\n\n' + note + '\n\n入口：[下一证据](research/seven-cities-next-evidence-48.json)。\n')
print(json.dumps({'readEntities': len(record['reviews']), 'currentMentions': count, 'xiamenRead': 20, 'accepted': False}, ensure_ascii=False))
