"""本次26条错城隔离记录的配额资格；不改变业务归属或历史待审。"""
import hashlib
import json
from pathlib import Path
from rank import build_city

ROOT = Path(__file__).resolve().parent
path = ROOT / 'snapshot-20261009T163355404046Z/input.json'
raw = path.read_bytes()
city = next(c for c in json.loads(raw)['cities'] if c['city'] == '成都')
types = json.loads((ROOT / 'seven-cities-type-reviews-02.json').read_bytes())
ranked = build_city(city, types)
reviews = []
for row in ranked['rankAffectingUncertainty']:
    mids = set(row['uncertainMentionIds'])
    mentions = [m for m in city['mentions'] if m['id'] in mids]
    if not mentions or any(m['raw_note_id'] != 759 for m in mentions):
        continue
    assert not row['mentionIds'] and row['score'] == 0
    assert all(m['resolution']['status'] == 'review' for m in mentions)
    scopes = [s for s in city['scopes'] if row['entityId'] in [*s['entity_ids'], *(s.get('withdrawal_entity_ids') or [])]]
    quote = '#北京citywalk[话题]# #北京周末去哪儿[话题]# #北京旅游[话题]#'
    assert quote in city['notes']['759']['note_desc']
    assert all(m['name'] in city['notes']['759']['note_desc'] for m in mentions)
    reviews.append({'city': '成都', 'actualCity': '北京', 'entityId': row['entityId'], 'name': row['name'],
        'expectedRevision': row['revision'], 'sourceIds': row['sourceIds'], 'scopeSnapshot': scopes,
        'mentionHashes': {str(m['id']): m['inputHash'] for m in mentions},
        'noteQuotes': [{'noteId': 759, 'quote': quote}],
        'snapshotSha256': hashlib.sha256(raw).hexdigest(),
        'conclusion': '完整正文为北京八条citywalk路线，原文明确老北京胡同及北京地域标签；该来源已隔离且无有效归属，不属于成都景点配额。保持原scope、null分配、历史PENDING与旧ID，不跨城搬移或新增业务决定。',
        'businessMutation': False})
assert len(reviews) == 26
verified = build_city(city, types, reviews)
assert len(verified['excludedOtherCities']) == 26
assert verified['top30'] == ranked['top30']
with (ROOT / 'seven-cities-geography-reviews-01.json').open('x', encoding='utf-8') as handle:
    json.dump(reviews, handle, ensure_ascii=False, indent=2)
print('26 geography reviews bound; top30 unchanged; no business mutation')
