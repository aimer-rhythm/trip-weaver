"""固化杭州云栖竹径20条、花港观鱼19条、西溪湿地19条、柳浪闻莺17条实际全文阅读。"""
import hashlib
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parent
PARENT = ROOT.parents[1] / '10-06-place-identity-governance'
read = lambda p: json.loads(p.read_bytes())
record = read(ROOT / 'seven-cities-semantic-readthrough-39.json')
raw = (ROOT / record['snapshotFile']).read_bytes()
assert hashlib.sha256(raw).hexdigest() == record['snapshotSha256']
city = next(c for c in json.loads(raw)['cities'] if c['city'] == '杭州')
before_city = next(c for c in read(ROOT / 'snapshot-20261010T025803181559Z/input.json')['cities'] if c['city'] == '杭州')
assert city['notes'] == before_city['notes'], '既有笔记在冻结前后不一致'
notes = {n['id']: n for n in city['governanceState']['rawNotes']}
before_notes = {n['id']: n for n in before_city['governanceState']['rawNotes']}
NO_CHANGE = '本批不改字段、不重排。'

cases = [
    ('e3aa3117c504f3b961f54e0e40c96379', 3993, 1, 20, [],
     [(1947, '全程石板路，几乎没有爬坡'), (1947, '🎫门票：8元，性价比拉满'),
      (1987, '从后山进入避开了门票'), (2060, '还是经典影片卧虎藏龙的拍摄取景地'),
      (1993, '天黑前走出云栖竹径'), (1966, '不要从云栖竹径上山要门票')],
     '20条提及/19篇正文已读（图片文字另核）。主体一致：西湖西南的竹海秘境，《卧虎藏龙》取景地，'
     '千米竹径、洗心亭、木栈道、索桥与网红「孤独的树」为经典点位；全程石板路几乎无爬坡、老人小孩可走，'
     '原文门票8元、约7:00-17:00，且「从后山进入可免门票」；主源3993未改。'
     '提示与负评保留：1966明确「不要从云栖竹径上山，要门票且爬升高累」，只作为下山终点；1993提示天黑前走出竹林；'
     '9101写雨天更有江湖意境属季节观察。边界单列：五云山、真际院、十里琅珰、九溪十八涧、九溪烟树、虎跑公园、'
     '梅家坞各自独立；云栖竹径是园区本体，本轮不新建组成关系、不改坐标。' + NO_CHANGE),
    ('0a0e4083c08d59357250589999fa44cf', 4056, 1, 19, [],
     [(1936, '红鱼池的鱼巨肥'), (2131, '从三潭映月坐船在这里下船'), (2118, '马一浮纪念馆附近'),
      (2131, '花港观鱼：🆓参观'), (2180, '只能从花港观鱼等车')],
     '19条/19篇正文已读（图片文字另核）。主体一致：西湖十景之一的花港观鱼，含蒋庄（民国新中式园林）、'
     '马一浮纪念馆、红鱼池与牡丹园，可喂鱼赏花、赏腊梅王（蒋庄古井），免费开放，'
     '是从三潭印月坐船后的下船点，也在苏堤南段一线；主源4056未改。'
     '限定保留：2180写观光车只能从花港观鱼等车、这里不是起点，需等中途空位；'
     '9289写苏堤走不动只走到南段花港观鱼即可，属路线取舍而非景点负面。'
     '边界单列：苏堤、三潭印月、太子湾公园（南门对面）、雷峰塔、净慈寺、虎跑公园、蒋庄与马一浮纪念馆'
     '各自独立；花港观鱼作为西湖十景之一独立成行，不与西湖本体合并；本轮不新建组成关系、不改坐标。' + NO_CHANGE),
    ('a7f8b55fe97baed0da96f7542a1a2b40', 4009, 2, 19, [],
     [(2006, '免费区就够玩大半天'), (2006, '🔸 7-8月盛夏（闷热+蚊子能把人抬走）'),
      (2006, '第一次来直接冲周家村主入口'), (2212, '夏季草木茂盛，蚊虫超多，驱蚊液、止痒膏必备'),
      (2145, '门票船票提前公众号预约')],
     '19条提及/18篇正文已读（图片文字另核）；该主体此前已有治理修订，当前revision=2、'
     '别名含西溪国家湿地公园。主体一致：城市湿地公园，一半收费一半免费——福堤、绿堤、河渚街、高庄、'
     '莲花滩观鸟区与中国湿地博物馆免费；收费区以摇橹船钻窄水道、梅花季与芦苇季为主，'
     '门票80元、电瓶船60元、摇橹船100元/小时，地铁3号线西溪湿地南站与19号线西溪湿地北站可达；主源4009未改。'
     '负评与避坑全部保留：2006整篇《80块门票值不值》明确「免费区就够玩大半天」「7-8月盛夏闷热加蚊虫、'
     '1-2月深冬像普通水塘、只有2小时都不用买票」「千万别从龙舌嘴进主园区，会多走3公里」；'
     '2212写夏季蚊虫超多须带驱蚊液与止痒膏；2145写门票船票须提前公众号预约。'
     '边界单列：周家村、深潭口、龙舌嘴（洪园）、高庄、河渚街、中国湿地博物馆、莲花滩、福堤、绿堤'
     '为园区内点位，各自不新建主体；西溪湿地与西湖、湘湖、青山湖各自独立；本轮不新建组成关系、不改坐标。' + NO_CHANGE),
    ('07a42ae6db2b3685e045d21bb3cd75b9', 3997, 1, 17, [],
     [(2002, '柳浪闻莺可以看到一大片湖景'),
      (2057, '经典桥洞打卡机位在📍新横河桥（p2.7）周末大概率需要排队'),
      (2142, '西湖区了，相比人没有那么多，网上很火的那个桥洞机位就在这里'),
      (2131, '柳浪闻莺：🆓参观'), (2129, '去柳浪闻莺听春风拂柳')],
     '17条/17篇正文已读（图片文字另核）。主体一致：西湖十景之一的柳浪闻莺，免费开放，'
     '以成片柳树、湖上孤树、杉树林、新横河桥「绿野仙踪」桥洞机位与闻莺馆为看点，'
     '沿南山路可与花港观鱼、太子湾、雷峰塔串联；主源3997未改。'
     '限定保留：2057写经典桥洞机位周末大概率要排队；8891写早上人少、光线偏暗建议穿浅色衣服；'
     '2002明确「柳浪闻莺可以看到一大片湖景，比在断桥残雪看到的湖景更美」，属原作者对比体感。'
     '边界单列：万松岭、白蛇飞渡桥、夕影亭、长桥溪、净慈寺、钱王祠码头、吴山与柳浪闻莺各自独立；'
     '柳浪闻莺作为西湖十景之一独立成行，不与西湖本体合并；本轮不新建组成关系、不改坐标。' + NO_CHANGE),
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
assert len(record['reviews']) == 96 and count == 1557, (len(record['reviews']), count)
record['limits'] = ('96项/1557当前有效提及已读；阅读不等于全来源、同体/组成/定位问题闭合，也不等于各城语义已完成。'
    'batch-120为最新完整验证；广州缺运营输入、鼓浪屿与集美大社缺媒体方案、杭州住宿参照待决；未验收、不提交、不归档。')


def write(name, value):
    with (ROOT / name).open('x', encoding='utf-8') as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)


write('seven-cities-semantic-readthrough-40.json', record)
next_evidence = read(ROOT / 'seven-cities-next-evidence-42.json')
next_evidence.update(semanticReadthrough='seven-cities-semantic-readthrough-40.json', nextBatch=122)
next_evidence['remainingReview'][0] = ('杭州已读15个主体，继续苏堤、九溪烟树、三潭印月、茅家埠、乌龟潭、大兜路、十里琅珰、浴鹄湾、'
    '九溪十八涧、良渚古城遗址公园、桥西历史街区、杨公堤、南宋御街、杭州植物园、香积寺；'
    '杭州待决8条住宿参照：灵隐寺9338、西湖9335/9448/9216、曲院风荷9344、雷峰塔9450、西湖断桥9449、龙井村9337。')
for item in new_reviews:
    next_evidence['nextEvidence'].append({'city': '杭州', 'entityId': item['entityId'],
        'pendingMentionIds': item['pendingMentionIds'], 'conclusion': item['conclusion']})
write('seven-cities-next-evidence-43.json', next_evidence)
lines = ['# 本轮逐项原文阅读记录', '', record['limits'], '', '| 城市 | 地点 | 当前有效提及 | 结论与待办 |', '| --- | --- | --- | --- |']
for review in record['reviews']:
    lines.append('| ' + ' | '.join([review['city'], review['name'],
        '、'.join(str(m['mentionId']) for m in review['mentions']), review['conclusion'].replace('|', '／')]) + ' |')
lines += ['', '证据：[阅读台账](research/seven-cities-semantic-readthrough-40.json)、[下一证据](research/seven-cities-next-evidence-43.json)。', '']
(ROOT.parent / '七城本轮原文复核.md').write_text('\n'.join(lines), encoding='utf-8')
note = record['limits'] + '新增杭州云栖竹径20条、花港观鱼19条、西溪湿地19条、柳浪闻莺17条；四主体均无待决住宿参照。'
for path in [ROOT.parent / 'task.json', PARENT / 'task.json']:
    task = read(path)
    assert task['status'] == 'in_progress' and task['meta']['sevenCityContinuation']['latestValidatedEntityBatch'] == '120'
    task['notes'] = task['notes'] + ' ' + note
    task['meta']['sevenCityContinuation'].update(
        semanticReadthrough='10-09-attraction-top30-governance/research/seven-cities-semantic-readthrough-40.json',
        workingStage=note, accepted=False)
    path.write_text(json.dumps(task, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
for name in ['进展记录.md', '七城剩余问题.md']:
    with (ROOT.parent / name).open('a', encoding='utf-8') as handle:
        handle.write('\n## 杭州四主体阅读断点（云栖竹径等）\n\n' + note + '\n\n入口：[下一证据](research/seven-cities-next-evidence-43.json)。\n')
print(json.dumps({'readEntities': len(record['reviews']), 'currentMentions': count, 'newEntities': 4,
    'newMentions': 75, 'hangzhouRead': 15, 'accepted': False}, ensure_ascii=False))
