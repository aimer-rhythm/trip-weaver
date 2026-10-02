"""汇总试点各轮审核与正式选择，导出可独立审阅的页面和真实三图清单。"""
from __future__ import annotations
import asyncio
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / 'upstream-stage'))
from app.photography.store import PhotoStore, atomic_json
from app.photography.report import render_report
from app.photography.export import export_selected
from app.photography.pipeline import Options, ranked_places
from app.db import engine


async def main():
    store = PhotoStore(HERE / 'live/photography', '北京')
    snapshot = store.read('runs/95d46f62397a47d1/snapshot.json')
    snapshots = [json.loads(p.read_text('utf-8')) for p in store.root.glob('runs/*/snapshot.json')]
    candidates = {}
    for run in sorted(snapshots, key=lambda item: item['created_at']):
        candidates.update(store.read(f'runs/{run["run_id"]}/candidates.json', {}))
    selected = store.read('selected.json')
    report = store.read('runs/570c8f539b074951/report.json')
    report.update(targets=5, covered=sum(bool(g['images']) for g in selected['places'].values()))
    snapshot['run_id'] = '北京试点汇总'
    preview = HERE / 'preview'
    preview.mkdir(exist_ok=True)
    (preview / 'index.html').write_text(render_report(store, snapshot, report, candidates, selected), encoding='utf-8')
    places = await ranked_places('北京', Options(top=100))
    images = export_selected('北京', HERE / 'live/photography', preview / 'media', allowed_names={p['name'] for p in places})
    atomic_json(preview / 'xhs-place-images-beijing.json', {'city': '北京', 'generatedAt': report['finished_at'], 'count': len(images), 'images': images})
    atomic_json(preview / 'targets.json', snapshot['places'])
    atomic_json(HERE / 'verification/final-candidates.json', candidates)
    print(json.dumps({'images': len(images), 'covered': report['covered'], 'targets': 5}, ensure_ascii=False))
    await engine.dispose()


asyncio.run(main())
