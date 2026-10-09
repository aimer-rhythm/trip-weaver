"""全城实体审计、带版本的治理预览与可逆应用；默认只读。"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
sys.path.insert(0, '.')

from sqlalchemy import select
from app.db import SessionFactory, engine
from app.models import CanonicalPlace
from app.aggregate.place_identity import (bootstrap, load_catalog, audit_catalog, enqueue_review,
                                          apply_decision, rollback_decision)


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--city', default=None, help='默认审计全部城市')
    ap.add_argument('--bootstrap', action='store_true')
    ap.add_argument('--decisions', type=Path)
    ap.add_argument('--rollback')
    ap.add_argument('--apply', action='store_true')
    ap.add_argument('--out', type=Path, required=True)
    args = ap.parse_args()
    if args.rollback and (args.bootstrap or args.decisions):
        ap.error('回滚不能与注册或应用混用')
    report = {'apply': args.apply, 'cities': [], 'changes': []}
    async with SessionFactory() as session:
        cities = [args.city] if args.city else list((await session.scalars(select(CanonicalPlace.city).distinct().order_by(CanonicalPlace.city))).all())
        for city in cities:
            if args.bootstrap:
                # 预览事务也执行相同逻辑，结尾整体回滚；报告因此与应用完全同源。
                await bootstrap(session, city)
            catalog = await load_catalog(session, city)
            candidates = audit_catalog(catalog)
            for detail in candidates:
                if args.apply:
                    await enqueue_review(session, city, detail)
            report['cities'].append({'city': city, 'entities': len(catalog.entities),
                'members': len(catalog.members), 'reviewCount': len(candidates), 'review': candidates})
        if args.decisions:
            decisions = json.loads(args.decisions.read_text(encoding='utf-8-sig'))
            for decision in decisions:
                if args.city and decision['city'] != args.city:
                    raise ValueError('决策城市超出指定范围')
                report['changes'].append(await apply_decision(session, decision))
        if args.rollback:
            report['changes'].append(await rollback_decision(session, args.rollback))
        if args.apply:
            await session.commit()
        else:
            await session.rollback()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'apply': args.apply, 'cities': len(report['cities']), 'changes': len(report['changes']),
        'reviewCount': sum(c['reviewCount'] for c in report['cities']), 'out': str(args.out)}, ensure_ascii=False))
    await engine.dispose()


if __name__ == '__main__':
    asyncio.run(main())
