"""记录本次公开类型证据与未改变业务的原文边界；不把补证当作全面完成。"""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
raw = (ROOT / 'snapshot-20261009T173835330614Z/input.json').read_bytes()
snapshot = json.loads(raw)
cities = {c['city']: c for c in snapshot['cities']}


def public(file, quote):
    data = (ROOT / file).read_bytes()
    fetched = json.loads(data)
    assert fetched['ok'] and quote in fetched['content']
    return {'file': file, 'sha256': hashlib.sha256(data).hexdigest(), 'url': fetched['url'], 'quote': quote}


def entity_evidence(city, names, quotes):
    frozen = cities[city]
    entities = [e for e in frozen['entities'] if e['canonical_name'] in names and not e['redirect_to']]
    assert len(entities) == len(names)
    for q in quotes:
        assert q['quote'] in frozen['notes'][str(q['noteId'])]['note_desc']
    ids = {e['entity_id'] for e in entities}
    return {'city': city, 'entities': [{k: e[k] for k in ['entity_id', 'canonical_name', 'revision']} for e in entities],
        'mentionHashes': {str(m['id']): m['inputHash'] for m in frozen['mentions'] if m['entityId'] in ids},
        'noteQuotes': quotes, 'businessMutation': False}


def write(name, value):
    with (ROOT / name).open('x', encoding='utf-8') as f:
        json.dump(value, f, ensure_ascii=False, indent=2)


tower = entity_evidence('广州', ['广州塔广场'], [
    {'noteId': 1873, 'quote': '出地铁过马路就是，扶手梯直冲天台花园'},
    {'noteId': 1699, 'quote': '搜索“广州塔广场”，找广场中央区域'},
    {'noteId': 1816, 'quote': '广州塔广场的阿嬷手作不好喝而且出品慢但位置不错'},
    {'noteId': 1861, 'quote': '广州塔广场游园会'},
])
e = tower.pop('entities')[0]
tower.update(entityId=e['entity_id'], name=e['canonical_name'], expectedRevision=e['revision'], effectiveType='market',
    publicSources=[public('tower-plaza-fetch-01.json', '地标商业综合体——广州塔广场正式对外开业。')],
    conclusion='四条原文对应商业广场天台花园、曲线庭院及餐饮商户；开业正文明确高端购物广场和商业综合体。仅退出本次景点配额，原业务分类、推荐分及review273保持；不与西广场、塔体或活动合并。旧ranking11为第32名，此项不替换当时Top30，仅影响边界风险。')
reviews = json.loads((ROOT / 'seven-cities-type-reviews-03.json').read_bytes())
assert not any(r['entityId'] == tower['entityId'] for r in reviews)
write('seven-cities-type-reviews-04.json', [*reviews, tower])

raffles = entity_evidence('重庆', ['来福士', '来福士商场'], [
    {'noteId': 176, 'quote': '1，来福士就一个商场，没啥亮点。'},
    {'noteId': 311, 'quote': '先打卡重庆地标来福士，再去朝天门看两江交汇'},
    {'noteId': 241, 'quote': '沿着【朝东路】走就可以拍到来福士经典机位了'},
])
raffles.update(publicSources=[public('raffles-fetch-01.json', '由8栋塔楼、底部裙楼及一座横跨天际的空中连廊组成'),
    public('raffles-fetch-01.json', '购物中心位于底部裙楼')],
    conclusion='多数原文指城市地标外观；官网区分整个塔楼建筑群、底部购物中心和探索舱观景设施。暂保留建筑地标候选，不因附设购物中心就把整座建筑判为market；不合并来福士商场、独立机位或观景设施。1068的商场负评原样保持，建筑与商场的逐提及范围仍待进一步治理。',
    reviewStatus='boundary_evidence_recorded_source_scope_pending')
jiuxi = entity_evidence('杭州', ['九溪', '九溪十八涧', '九溪烟树'], [
    {'noteId': 2254, 'quote': '沿着九溪十八涧一路走到九溪烟树'},
    {'noteId': 1940, 'quote': '九溪公交站 → 九溪烟树 → 九溪十八涧 → 龙井村'},
    {'noteId': 1940, 'quote': '九溪烟树（核心打卡点） 标志性的小瀑布+碧水+翠枫'},
    {'noteId': 1940, 'quote': '九溪十八涧 踩着溪中的石墩一路向前'},
    {'noteId': 2246, 'quote': '九溪(公交站)'},
])
jiuxi.update(conclusion='原文明确区分烟树瀑布节点与十八涧沿溪路段，不能按相近名称同义合并。裸名九溪的8750实际公交站起点，其他提及泛指溪谷；需逐提及范围隔离后再判断泛称和全称。此次不创建正式part_of关系、不移动公交或机位记录、不把全部九溪分数加给任一母项。',
    reviewStatus='boundary_evidence_recorded_source_scope_pending')
write('seven-cities-next-evidence-03.json', {'readOnly': True, 'snapshotSha256': hashlib.sha256(raw).hexdigest(),
    'reviews': [raffles, jiuxi], 'userAcceptance': False, 'taskCompleted': False})
print(json.dumps({'typeReviews': len(reviews) + 1, 'boundaryEvidenceGroups': 2}))
