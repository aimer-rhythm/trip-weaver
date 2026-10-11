"""固化本轮逐项读过的原文、当前归属及剩余事实问题；不把阅读计为全面验收。"""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SOURCE = 'snapshot-20261009T193641750410Z/input.json'
raw = (ROOT / SOURCE).read_bytes()
snapshot = json.loads(raw)
entries = [
    ('上海', '1933老场坊', [10010, 10289, 10889],
     '三篇将老场坊/1933老场坊作为独立路线地点，同篇2279还明确1933全名。保留现行身份，不把相邻多伦路或四行仓库合并；未核验营业和商业类型。',
     [(2279, '•海伦路站：1933老场坊'), (2290, '人民广场➡老场坊➡多伦路'), (2435, '四行仓库→1933 老场坊')]),
    ('上海', '四行仓库', [9926, 10032, 10888],
     '三篇路线直接列四行仓库或以其为起点，保留现行建筑地点；不据此确认纪念馆入场规则或将苏州河路线并为同体。',
     [(2309, 'p7 四行仓库'), (2347, '苏州河（四行仓库→外白渡桥）'), (2435, '人民广场→四行仓库→1933 老场坊')]),
    ('上海', '愚园路', [10076, 10184, 11044],
     '原文独立列街道Citywalk与路线。美食标题不否定正文中单独景点推荐；保留街道身份，不吸收沿线店铺。',
     [(2317, '8️⃣ 愚园路：绝对的citywalk好地方'), (2291, '新天地➡️愚园路➡️思南公馆'), (2439, '静安寺→愚园路→人民广场→上海博物馆')]),
    ('上海', '田子坊', [10005, 10284, 11245],
     '三篇实际路线地点均保留；99-v2只排除11245整份三日游规划的reason/evidence_text。2290同篇住宿建议不覆盖其明确Day2游览。',
     [(2279, '新天地 → 田子坊 → 思南公馆'), (2290, 'Day2：武康路➡新天地➡田子坊'), (2474, '武康路历史文化名街→田子坊→思南公guan')]),
    ('成都', '青城山前山景区', [3929, 4120],
     '保留已治理全简称及前山范围。4120同时明确古观/登山景观，不仅是活动名称；教师免票有9.10—9.20限制，不能解释为永久免费或已核实优惠。后山不并入。',
     [(921, '👉青城山前山'), (910, '青城山前山景区：9.10‑9.20教师免票入园！道教名山古观林立')]),
    ('成都', '浣花溪公园', [3990, 4214],
     '两篇分别在杜甫草堂前后列公园，保留独立路线身份；邻近顺路不是同义证据。',
     [(902, '杜甫草堂-浣花溪公园-武侯祠'), (950, '青羊宫→浣花溪公园→杜甫草堂')]),
    ('成都', '四川科技馆', [3763, 4222],
     '3763明确负面名单、4222明确游览路线，正负身份都保留。3763原文没有设施偏旧/趣味性一般的具体解释，提取reason仍待事实治理；不能为清掉推断而删掉负评。',
     [(892, '宽窄巷子、建设路小吃街、锦里古街、成都动物园、望江楼公园、四川科技馆'), (950, '成都博物馆→四川科技馆→青羊宫')]),
    ('西安', '樊川公园', [12435, 12542],
     '两篇直接描写公园水杉、栈道及水面景观，保留现行身份。不将相邻周至水杉公路并入；季节表现未作实地或实时核实。',
     [(2754, '樊川公园成片水杉红透倒映水面'), (2761, '樊川公园\n潏河两岸水杉变红，水上栈道')]),
    ('西安', '兴庆宫公园', [12041, 12317, 12536],
     '100批后保留两篇实际到公园拍照及一篇公园景观；商户妆造与公园路线分列，不误当服务广告。12266爱心树负评已隔离，同篇11883独立爱心树负评保持。',
     [(2632, '小唐风汉服妆造+兴庆宫拍照'), (2712, '兴庆宫拍妆造（沉香亭｜迎春桥）'), (2761, '兴庆宫公园\n唐代皇家园林，满园桂香'),
      (2628, '④兴庆宫爱心树（除了拍照打卡，没啥东西，可以不去）')]),
]
reviews = []
for city_name, name, mids, conclusion, quotes in entries:
    city = next(c for c in snapshot['cities'] if c['city'] == city_name)
    entity = next(e for e in city['entities'] if e['canonical_name'] == name and not e['redirect_to'])
    mentions = [m for m in city['mentions'] if m['entityId'] == entity['entity_id']]
    assert {m['id'] for m in mentions} == set(mids)
    for nid, quote in quotes:
        assert quote in city['notes'][str(nid)]['note_desc'], (name, nid)
    assert {m['raw_note_id'] for m in mentions}.issubset({nid for nid, _ in quotes})
    reviews.append({'city': city_name, 'entityId': entity['entity_id'], 'name': name,
        'expectedRevision': entity['revision'], 'identityRetained': True, 'fullFactsReviewed': False,
        'scope': '本次完整当前已归属提及与所列笔记正文的身份语境阅读；原文可辨不代表全部资料事实可信。',
        'mentions': [{'mentionId': m['id'], 'inputHash': m['inputHash'], 'resolution': m['resolution']} for m in mentions],
        'noteEvidence': [{'noteId': nid, 'quote': quote,
            'noteDescSha256': hashlib.sha256(city['notes'][str(nid)]['note_desc'].encode()).hexdigest()} for nid, quote in quotes],
        'conclusion': conclusion, 'businessMutationByThisRecord': False, 'userAcceptance': False})
result = {'snapshotFile': SOURCE, 'snapshotSha256': hashlib.sha256(raw).hexdigest(), 'reviews': reviews,
    'limits': '仅固化本轮9项阅读，不能将其余201项或这9项所有事实标记已审核；历史治理仍以各批审计为准。'}
with (ROOT / 'seven-cities-semantic-readthrough-01.json').open('x', encoding='utf-8') as handle:
    json.dump(result, handle, ensure_ascii=False, indent=2)
lines = ['# 本轮逐项原文阅读记录', '', '绑定最新快照；9项的当前归属与原文已逐条阅读，完整资料事实及用户验收仍未完成。', '',
    '| 城市 | 地点 | 当前有效提及 | 结论与待办 |', '| --- | --- | --- | --- |']
for review in reviews:
    lines.append('| ' + ' | '.join([review['city'], review['name'],
        '、'.join(str(m['mentionId']) for m in review['mentions']), review['conclusion']]) + ' |')
lines += ['', '证据：[机器台账](research/seven-cities-semantic-readthrough-01.json)。原文指纹、完整当前归属集合和实体版本均已绑定。', '']
with (ROOT.parent / '七城本轮原文复核.md').open('x', encoding='utf-8') as handle:
    handle.write('\n'.join(lines))
print(json.dumps({'entities': len(reviews), 'currentMentions': sum(len(r['mentions']) for r in reviews), 'fullFactsReviewed': False}))
