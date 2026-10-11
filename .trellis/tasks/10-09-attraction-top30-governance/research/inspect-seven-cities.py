"""按城市/名称读取冻结证据，控制台只展示主体与原文，不输出笔记链接或图片地址。"""
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parent


def emit(value):
    # 正文或嵌套分析也可能含采集链接；所有控制台投影统一去除URL。
    def clean(item):
        if isinstance(item, str):
            return re.sub(r'https?://[^\s<>\"\u3000]+', '[URL已省略]', item)
        if isinstance(item, list):
            return [clean(v) for v in item]
        if isinstance(item, dict):
            return {k: clean(v) for k, v in item.items()}
        return item
    print(json.dumps(clean(value), ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('city')
    parser.add_argument('names', nargs='*')
    parser.add_argument('--mention-ids', nargs='+', type=int, default=[])
    parser.add_argument('--snapshot', default='snapshot-20261009T141514441892Z/input.json')
    parser.add_argument('--notes', action='store_true')
    parser.add_argument('--image-text', action='store_true', help='读取既有图片文字分析，仍不输出图片或来源URL')
    parser.add_argument('--compact', action='store_true')
    parser.add_argument('--exact', action='store_true', help='只选完整主名，避免搜索外滩时输出所有餐厅和酒店')
    parser.add_argument('--offset', type=int, default=0)
    parser.add_argument('--limit', type=int)
    parser.add_argument('--omit-entities', action='store_true')
    parser.add_argument('--reuse-notes-from', help='按台账全文hash及完整冻结字段比较复用已读笔记；图片文字须另有明确阅读证据')
    args = parser.parse_args()
    assert args.names or args.mention_ids
    city = next(c for c in json.loads((ROOT / args.snapshot).read_bytes())['cities'] if c['city'] == args.city)
    known_notes, known_image_notes = {}, set()
    old_city = None
    if args.reuse_notes_from:
        record = json.loads((ROOT / args.reuse_notes_from).read_bytes())
        old_raw = (ROOT / record['snapshotFile']).read_bytes()
        assert hashlib.sha256(old_raw).hexdigest() == record['snapshotSha256']
        old_city = next(c for c in json.loads(old_raw)['cities'] if c['city'] == args.city)
        for review in record['reviews']:
            if review['city'] != args.city:
                continue
            for evidence in review['noteEvidence']:
                nid = evidence['noteId']
                note = old_city['notes'][str(nid)]
                assert hashlib.sha256(note['note_desc'].encode()).hexdigest() == evidence['noteDescSha256']
                known_notes[nid] = evidence['noteDescSha256']
            for evidence in review.get('existingImageTextEvidence', []):
                if not evidence.get('rawNoteSha256'):
                    continue
                raw_note = next(n for n in old_city['governanceState']['rawNotes'] if n['id'] == evidence['noteId'])
                assert hashlib.sha256(json.dumps(raw_note, ensure_ascii=False, sort_keys=True).encode()).hexdigest() == evidence['rawNoteSha256']
                known_image_notes.add(evidence['noteId'])
    assert args.offset >= 0 and (args.limit is None or args.limit > 0)
    def matches(name):
        return name in args.names if args.exact else any(n in name for n in args.names)
    selected = [e for e in city['entities'] if matches(e['canonical_name'])]
    ids = {e['entity_id'] for e in selected}
    for e in ([] if args.omit_entities else selected):
        sources = [s for s in city['sources'] if city['members'].get(str(s['id'])) == e['entity_id']]
        shown = {k: e[k] for k in ['entity_id', 'canonical_name', 'revision', 'primary_place_id', 'aliases', 'overrides']} if args.compact else e
        emit({'entity': shown, 'sources': [{k: s.get(k) for k in ['id', 'name', 'normalized_name', 'place_type', 'address', 'latitude', 'longitude']} for s in sources]})
    for r in city['reviews']:
        if not args.omit_entities and ids.intersection(r['detail'].get('entityIds', [])):
            detail = r['detail'].get('assessment', {}).get('explanation') if args.compact else r['detail']
            emit({'reviewId': r['id'], 'status': r['status'], 'detail': detail})
    seen = set()
    matches_mentions = [m for m in city['mentions'] if m['id'] in args.mention_ids or m['entityId'] in ids or matches(m['name'])]
    shown_mentions = matches_mentions[args.offset:None if args.limit is None else args.offset + args.limit]
    emit({'matchedMentions': len(matches_mentions), 'offset': args.offset, 'shownMentionIds': [m['id'] for m in shown_mentions],
          'remainingAfterPage': max(0, len(matches_mentions) - args.offset - len(shown_mentions))})
    for m in shown_mentions:
        n = city['notes'][str(m['raw_note_id'])]
        shown = {k: m[k] for k in ['id', 'raw_note_id', 'name', 'place_type', 'reason', 'evidence_text']} if args.compact else m
        emit({'mention': shown, 'noteTitle': n['note_title']})
        if (args.notes or args.image_text) and m['raw_note_id'] not in seen:
            if args.notes:
                if m['raw_note_id'] in known_notes:
                    assert old_city['notes'][str(m['raw_note_id'])] == n
                    emit({'noteId': m['raw_note_id'], 'reusedFullText': args.reuse_notes_from,
                        'fullFrozenFieldsEqual': True, 'noteDescSha256': known_notes[m['raw_note_id']]})
                else:
                    emit({'noteId': m['raw_note_id'], 'noteText': n['note_desc'], 'analysis': n.get('note_analysis')})
            if args.image_text:
                raw = next(r for r in city['governanceState']['rawNotes'] if r['id'] == m['raw_note_id'])
                if raw['id'] in known_image_notes:
                    assert raw == next(n for n in old_city['governanceState']['rawNotes'] if n['id'] == raw['id'])
                    emit({'noteId': raw['id'], 'reusedExistingImageText': args.reuse_notes_from, 'fullRawNoteEqual': True})
                else:
                    emit({'noteId': raw['id'], 'existingImageText': [{'imageIndex': index, 'keyInfo': item.get('key_info')}
                        for index, item in enumerate(raw.get('img_analysis') or []) if isinstance(item, dict) and item.get('has_text')]})
            seen.add(m['raw_note_id'])


if __name__ == '__main__':
    main()
