"""只对试点中曾通过门槛的缓存候选重新复核；不搜索、不改攻略库。"""
from __future__ import annotations
import asyncio
import json
import logging
import sys
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / 'upstream-stage'))
import httpx
from app.photography.pipeline import Options, Budget, Pipeline, now
from app.photography.store import PhotoStore, fingerprint
from app.photography.review import VERSION, choose
from app.photography.report import render_report
from app.vision.extract import VisionClient


async def main():
    store = PhotoStore(HERE / 'live' / 'photography', '北京')
    options = Options(mode='refresh', vision_budget=60, download_budget=20)
    old_run = '95d46f62397a47d1'
    with store.locked():
        snapshot = store.read(f'runs/{old_run}/snapshot.json')
        candidates = store.read(f'runs/{old_run}/candidates.json')
        previous = store.read('selected.json')
        run_id = uuid.uuid4().hex[:16]
        snapshot.update(run_id=run_id, source_run=old_run, version=VERSION, created_at=now())
        snapshot['options']['mode'] = 'refresh'
        store.write(f'runs/{run_id}/snapshot.json', snapshot)
        store.write(f'runs/{run_id}/previous-selected.json', previous)
        budget = Budget(options)
        async with VisionClient() as vision, httpx.AsyncClient(timeout=30) as http:
            pipeline = Pipeline(store, options, None, vision, http, budget)
            for place in snapshot['places']:
                pid = str(place['id'])
                for index, item in enumerate(candidates[pid]):
                    if item['review']['status'] != 'eligible':
                        continue
                    print(f'复核 {place["name"]} 原图 {item["image_index"] + 1}', flush=True)
                    note = store.read(f'notes/{fingerprint(item["note_id"])}.json')
                    candidates[pid][index] = await pipeline.candidate(place, note, item['image_index'])
                    store.write(f'runs/{run_id}/candidates.json', candidates)
            selected = {'city': '北京', 'places': {str(place['id']): {
                'place': place, 'images': choose(candidates[str(place['id'])], [], 'refresh'), 'run_id': run_id,
            } for place in snapshot['places']}}
            if pipeline.errors:
                raise RuntimeError('复核出现模型错误，保留原选择，请查看缓存候选')
            store.write('selected.json', selected)
            report = {'city': '北京', 'run_id': run_id, 'status': 'complete', 'failure': None,
                      'requests': budget.used, 'cache_hits': pipeline.cache_hits, 'errors': pipeline.errors,
                      'targets': 5, 'covered': sum(bool(g['images']) for g in selected['places'].values()),
                      'finished_at': now()}
            store.write(f'runs/{run_id}/report.json', report)
            page = store.path(f'runs/{run_id}/review.html')
            page.write_text(render_report(store, snapshot, report, candidates, selected), encoding='utf-8')
            store.write('pilot-latest.json', {'run_id': run_id, 'review_file': str(page)})
            print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)
    logging.getLogger('httpx').setLevel(logging.WARNING)
    asyncio.run(main())
