"""阅读冻结证据；不写数据库，不从相似名生成合并决定。"""
import argparse
import json
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--start', type=int, default=1)
parser.add_argument('--end', type=int, default=57)
parser.add_argument('--notes', nargs='*', default=[])
parser.add_argument('--all-mentions', action='store_true')
args = parser.parse_args()
data = json.loads((Path(__file__).parent/'retained-place-sources-1791366327590.json').read_text(encoding='utf-8'))
notes = {str(n['id']): n for n in data['notes']}
if args.notes:
    for key in args.notes:
        print(json.dumps(notes[key], ensure_ascii=False, indent=2))
else:
    for i, group in enumerate(data['groups'], 1):
        if not args.start <= i <= args.end:
            continue
        row = group['stored']
        print(f'\n===== {i} {row["city"]} {row["name"]} {row["source"]} =====')
        print(json.dumps({'stored': row, 'candidates': group['candidates'], 'sources': group['sources'], 'goldset': group['goldset']}, ensure_ascii=False))
        exact = [m for m in group['mentions'] if m['name'].strip() == row['name'].strip()]
        selected = group['mentions'] if args.all_mentions else exact or [m for m in group['mentions'] if row['name'] in (m.get('evidence_text') or '') or row['name'] in (m.get('reason') or '')]
        print('exact raw mentions:', len(exact))
        for m in selected:
            print(json.dumps(m, ensure_ascii=False))
        print('literal note ids:', group['literalNoteIds'])
        print('review ids:', [r['id'] for r in group['reviews']])
