"""119-v2：按生产读取器的datetime.isoformat规范构建冻结日期指纹。"""
import asyncio
import importlib.util
import json
import sys
import traceback
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('zengcuoan_v1', ROOT / 'govern-zengcuoan-preserved-scope.py')
original = importlib.util.module_from_spec(spec)
spec.loader.exec_module(original)
runner = original.runner
from app.clean.legacy_operational_facts import relevant_images, fact_names


def inputs():
    frozen, scopes, expected = original.inputs()
    scope, = scopes
    scope['key'] = 'top30-20261010-batch-119-v2-scope-2559'
    notes = {n['id']: n for n in frozen['governanceState']['rawNotes']}
    ordered = []
    for item in frozen['governanceState']['imageNoteOrder']:
        note = notes[item['id']]
        ordered.append((note['id'], {'city': note['city'], 'title': note['title'], 'desc': note['desc'],
            'images': note['img_analysis'], 'unavailable': note['status'] in ['DELETED', 'PRIVATE'],
            'sourceUrl': note['source_url'] or '',
            'observedAt': datetime.fromisoformat(note['created_at']).isoformat() if note['created_at'] else None,
            'publishedAt': datetime.fromisoformat(note['publish_time']).isoformat() if note['publish_time'] else None}))
    source = next(s for s in frozen['sources'] if s['id'] == original.SID)
    preservation, = scope['preserveOperationalFacts']
    refs = relevant_images(ordered, fact_names(source['name'], '厦门'))
    assert [(r['noteId'], r['imageIndex']) for r in refs] == [(r['noteId'], r['imageIndex']) for r in preservation['sources']]
    assert [(a['noteId'], a['imageIndex']) for a, b in zip(preservation['sources'], refs) if a != b] == [(1298, 1)]
    preservation['sources'] = refs
    preservation['evidence'][0]['file'] = str(Path(__file__).relative_to(ROOT.parents[3]))
    scope['evidence'].append({'kind': 'frozen_timestamp_serialization',
        'file': str(Path(__file__).relative_to(ROOT.parents[3])),
        'diagnosticFile': str((ROOT / 'batch-119-operational-diagnostic-02.json').relative_to(ROOT.parents[3])),
        'conclusion': '原JSON日期与生产datetime.isoformat精度表示不同，仅note1298/图片1的observedAt序列化改变；时间值、来源集合及顺序、全部正文和图片文字均相等。不修改原文或生产协议；119失败决定保留，以119-v2重新完整预演。'})
    diagnostic = json.loads((ROOT / 'batch-119-operational-diagnostic-02.json').read_bytes())
    assert diagnostic['sameReferences'] and all(r['datetimeIsoformatMatchesRuntime'] and r['timestampsRepresentSameValue'] for r in diagnostic['comparisons'])
    return frozen, scopes, expected


runner.BATCH = 'batch-119-v2'
runner.inputs = inputs
if __name__ == '__main__':
    try:
        asyncio.run(runner.main())
    except Exception as error:
        print(json.dumps({'failed': True, 'errorType': type(error).__name__, 'frames': [
            {'file': Path(f.filename).name, 'line': f.lineno, 'function': f.name}
            for f in traceback.extract_tb(error.__traceback__)]}, ensure_ascii=False))
        sys.exit(1)
