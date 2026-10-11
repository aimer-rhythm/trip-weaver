"""列出北京/济南 top30 各主体的提及/笔记数，用于规划阅读批次。"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SNAPSHOT = ROOT / 'snapshot-20261009T134338341037Z/input.json'
md = (ROOT.parent / '人工审核名单.md').read_text(encoding='utf-8')


def rows(section):
    out = []
    for line in section.split('\n'):
        parts = [p.strip() for p in line.split('|')]
        if len(parts) >= 7 and parts[1].isdigit():
            out.append((int(parts[1]), parts[2]))
    return out


snap = json.loads(SNAPSHOT.read_bytes())
beijing = rows(md.split('## 北京')[1].split('## 济南')[0])
jinan = rows(md.split('## 济南')[1].split('## 仍需完成')[0])
for city, listing in [('北京', beijing), ('济南', jinan)]:
    current = next(c for c in snap['cities'] if c['city'] == city)
    print(f'== {city} rows={len(listing)}')
    total = 0
    for rank, name in listing:
        cands = [e for e in current['entities'] if e['canonical_name'] == name]
        if not cands:
            print(f'{rank:>3} {name} NO-ENTITY')
            continue
        entity = max(cands, key=lambda e: sum(1 for m in current['mentions'] if m['entityId'] == e['entity_id']))
        mine = [m for m in current['mentions'] if m['entityId'] == entity['entity_id']]
        notes = len({m['raw_note_id'] for m in mine})
        total += len(mine)
        print(f'{rank:>3} {name} mentions={len(mine)} notes={notes} rev={entity["revision"]} sameName={len(cands)}')
    print(f'-- {city} total mentions {total}')
