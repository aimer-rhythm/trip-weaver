"""以实际抓取的项目案例正文补证CPI商业属性，保持业务记录只读。"""
import hashlib
import json
from pathlib import Path
from rank import build_city

ROOT = Path(__file__).resolve().parent
snapshot = json.loads((ROOT / 'snapshot-20261009T163355404046Z/input.json').read_bytes())
city = next(c for c in snapshot['cities'] if c['city'] == '成都')
entity = next(e for e in city['entities'] if e['entity_id'] == '2fa5249189e48255eab59d0ecbae4c62')
mentions = [m for m in city['mentions'] if m['entityId'] == entity['entity_id']]
raw = (ROOT / 'cpi-fetch-01.json').read_bytes()
page = json.loads(raw)
quote = '麓湖CPI岛商业更新项目是位于成都“麓湖生态城”中的麓客岛东侧的别墅样板间集合岛。'
assert page['ok'] and quote in page['content'] and '项目类型：商业' in page['content']
reviews = json.loads((ROOT / 'seven-cities-type-reviews-02.json').read_bytes())
reviews.append({'city': '成都', 'entityId': entity['entity_id'], 'name': entity['canonical_name'],
    'expectedRevision': entity['revision'], 'effectiveType': 'market',
    'mentionHashes': {str(m['id']): m['inputHash'] for m in mentions},
    'noteQuotes': [{'noteId': 890, 'quote': 'DAY3：麓客岛-麓湖cpi-三色路夜市'}, {'noteId': 892, 'quote': '杜甫草堂、麓湖CPI'}],
    'publicSources': [{'file': 'cpi-fetch-01.json', 'sha256': hashlib.sha256(raw).hexdigest(), 'url': page['url'], 'quote': quote}],
    'conclusion': '原始两篇提及命名为麓湖CPI；金盘网万华集团项目案例实际正文明确CPI岛为商业更新项目、项目类型商业及商业集群。按本任务排除商业体配额，保留既有景观体验和业务记录，不把麓客岛或其内艺展中心归为同一实体。不采用search-05生成答案中未经原页支持的CBD、武侯区或中海万科说法。',
    'businessMutation': False})
build_city(city, reviews)
with (ROOT / 'seven-cities-type-reviews-03.json').open('x', encoding='utf-8') as handle:
    json.dump(reviews, handle, ensure_ascii=False, indent=2)
print('13 type reviews; CPI commercial classification verified against fetched project text; no business mutation')
