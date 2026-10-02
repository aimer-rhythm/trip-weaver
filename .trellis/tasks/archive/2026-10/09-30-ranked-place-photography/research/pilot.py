"""在暂存代码上做北京有界试点；只读攻略表，产物全部保存到当前任务目录。"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / 'upstream-stage'))
from sqlalchemy import func, select
from app.config import settings
from app.db import SessionFactory, engine
from app.models import RawNote, PlaceMention, CanonicalPlace, PlaceSummary
from app.photography.pipeline import Options, ranked_places, run
from app.photography.store import atomic_json, fingerprint
from app.vision.extract import is_vision_configured


async def signature():
    async with SessionFactory() as session:
        notes = await session.scalar(select(func.count()).select_from(RawNote).where(RawNote.city == '北京'))
        mentions = await session.scalar(select(func.count()).select_from(PlaceMention)
            .join(RawNote, RawNote.id == PlaceMention.raw_note_id).where(RawNote.city == '北京'))
        rows = (await session.execute(select(CanonicalPlace.id, CanonicalPlace.quality_score, CanonicalPlace.is_active,
            PlaceSummary.recommend_score).join(PlaceSummary, PlaceSummary.canonical_place_id == CanonicalPlace.id)
            .where(CanonicalPlace.city == '北京').order_by(CanonicalPlace.id))).all()
        return {'raw_notes': notes, 'mentions': mentions, 'ranking_hash': fingerprint([list(row) for row in rows])}


async def main(args):
    try:
        before = await signature()
        if args.inspect:
            print(json.dumps({'configured': {'xhs': bool(settings.xhs_cookie), 'vision': is_vision_configured()},
                'before': before, 'top20': await ranked_places('北京', Options())}, ensure_ascii=False, default=str))
            return
        options = {'places': args.places, 'run_id': args.run_id, 'max_keywords': args.max_keywords, 'max_notes': 3,
                   'max_images': 4, 'xhs_budget': 20, 'vision_budget': 60, 'download_budget': 60}
        result = await run('北京', options, root=HERE / 'live' / 'photography')
        after = await signature()
        evidence = {'before': before, 'after': after, 'ranking_unchanged': before == after, 'result': result}
        atomic_json(HERE / 'live' / ('pilot-' + result['run_id'] + '-' + uuid.uuid4().hex[:8] + '.json'), evidence)
        print(json.dumps(evidence, ensure_ascii=False))
        if before != after:
            raise RuntimeError('试点前后攻略数据变化，必须检查是否有并行攻略任务')
    finally:
        await engine.dispose()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inspect', action='store_true')
    parser.add_argument('--places', default='')
    parser.add_argument('--run-id', default='')
    parser.add_argument('--max-keywords', type=int, choices=(1, 2), default=1)
    args = parser.parse_args()
    if not args.inspect and not args.places and not args.run_id:
        parser.error('真实试点必须指定景点或续跑标识')
    logging.basicConfig(level=logging.INFO)
    logging.getLogger('httpx').setLevel(logging.WARNING)
    logging.getLogger('httpcore').setLevel(logging.WARNING)
    asyncio.run(main(args))
