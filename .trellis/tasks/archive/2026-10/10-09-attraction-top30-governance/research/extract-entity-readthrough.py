"""按城市与完整主名导出冻结原文，供逐条阅读；只输出主体与正文。"""
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parent
clean = lambda s: re.sub(r'https?://[^\s<>"\u3000]+', '[URL已省略]', s if isinstance(s, str) else json.dumps(s, ensure_ascii=False))

parser = argparse.ArgumentParser()
parser.add_argument('city')
parser.add_argument('names', nargs='+', help='完整主名')
parser.add_argument('--snapshot', default='snapshot-20261010T031749976332Z/input.json')
parser.add_argument('--reuse-notes-from', help='已读台账：同城已读且笔记未变的note只标注已读，不重复输出正文')
args = parser.parse_args()
raw = (ROOT / args.snapshot).read_bytes()
city = next(c for c in json.loads(raw)['cities'] if c['city'] == args.city)
notes = {n['id']: n for n in (city.get('governanceState') or {}).get('rawNotes') or []}
read_notes = set()
if args.reuse_notes_from:
    record = json.loads((ROOT / args.reuse_notes_from).read_bytes())
    for review in record['reviews']:
        if review['city'] != args.city:
            continue
        read_notes |= {e['noteId'] for e in review['noteEvidence']}
print(f'# snapshot {args.snapshot} sha256 {hashlib.sha256(raw).hexdigest()} | 已读台账note数 {len(read_notes)}')
for name in args.names:
    candidates = [e for e in city['entities'] if e['canonical_name'] == name]
    if not candidates:
        raise SystemExit(f'未找到主名：{name}')
    if len(candidates) > 1:
        print(f'# 同名实体 {len(candidates)} 个：' + '; '.join(
            f'{e["entity_id"]} rev={e["revision"]} aliases={e["aliases"]} '
            f'mentions={len([m for m in city["mentions"] if m["entityId"] == e["entity_id"]])}'
            for e in candidates))
    entity = max(candidates, key=lambda e: len([m for m in city['mentions'] if m['entityId'] == e['entity_id']]))
    rows = sorted([m for m in city['mentions'] if m['entityId'] == entity['entity_id']], key=lambda m: m['raw_note_id'])
    print(f'\n## entity {name} | {entity["entity_id"]} | rev={entity["revision"]} | primary={entity["primary_place_id"]} '
          f'| aliases={entity["aliases"]} | mentions={len(rows)} | notes={len({m["raw_note_id"] for m in rows})}'
          + ('' if notes else ' | rawNote不可用（该快照不含 governanceState）'))
    for m in rows:
        nid = m['raw_note_id']
        note = notes.get(nid) or {}
        image_text = [f'[{i}]{clean(v.get("key_info") or v.get("text") or "")}'
            for i, v in enumerate(note.get('img_analysis') or []) if isinstance(v, dict) and v.get('has_text')]
        print(f'\n=== mention {m["id"]} | note {nid} | {m["mention_type"]}/{m["sentiment"]} | conf={m["confidence"]} '
              f'| fact={m.get("fact_type")}:{json.dumps(m.get("fact_value"), ensure_ascii=False)}')
        print(f'reason: {clean(m.get("reason"))}')
        print(f'evidence: {clean(m.get("evidence_text"))}')
        print(f'title: {clean(note.get("title"))}')
        if image_text:
            print('img_text: ' + ' || '.join(image_text))
        if nid in read_notes:
            desc = city['notes'][str(nid)]['note_desc']
            print(f'desc: [已读复用] ' + clean(desc[:160]).replace('\n', ' ⏎ '))
        else:
            print('desc: ' + clean(city['notes'][str(nid)]['note_desc']).replace('\n', ' ⏎ '))
