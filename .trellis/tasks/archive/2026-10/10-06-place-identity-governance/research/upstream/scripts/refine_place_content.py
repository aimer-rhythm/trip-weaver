"""搜索网页并结合模型知识生成完整介绍；默认预览，--apply保存，不重新采集小红书。"""
from __future__ import annotations
import argparse
import asyncio
import json
import re
import unicodedata
import sys
from datetime import datetime, timezone
from pathlib import Path
sys.path.insert(0, '.')
from sqlalchemy import select
from app.clean.alias import aliases_for, resolve_alias
from app.clean.place_content import intro_rejection
from app.db import SessionFactory, engine
from app.extract.llm_extract import LlmClient
from app.models import CanonicalPlace, PlaceMention, RawNote

from app.extract.place_profiles import PROMPT, validate_profile, stable_sources, refine_profiles, validate_profile_identity
from app.aggregate.place_identity import lock_city
from app.aggregate.mention_identity import load_mention_catalog
from app.extract.place_research import DEFAULT_SEARCH_MODEL


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--city', required=True)
    parser.add_argument('--names', nargs='+')
    parser.add_argument('--out', required=True)
    parser.add_argument('--sources-file', help='可选的已抓取补充正文；介绍默认主动搜索与抓取网页')
    parser.add_argument('--search-model', default=DEFAULT_SEARCH_MODEL)
    parser.add_argument('--apply-report', help='复核后应用已有预览，逐行比较before，避免再次调模型')
    parser.add_argument('--restore-report', help='按已应用报告恢复before；当前值须等于after')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--limit', type=int, default=20, help='本次最多处理1～200个缺失介绍的景点')
    args = parser.parse_args()
    if args.apply_report and args.restore_report:
        parser.error('应用与恢复报告不能同时指定')
    if args.apply_report or args.restore_report:
        source_path = args.apply_report or args.restore_report
        report = json.loads(Path(source_path).read_text(encoding='utf-8'))
        if report['city'] != args.city:
            raise RuntimeError('报告城市不匹配')
        if Path(args.out).exists():
            raise RuntimeError('输出已存在，禁止覆盖修复记录')
        restoring = bool(args.restore_report)
        async with SessionFactory() as session:
            await lock_city(session, args.city)
            catalog = await load_mention_catalog(session, args.city)
            changes = []
            for update in report['updates']:
                place = (await session.execute(select(CanonicalPlace).where(
                    CanonicalPlace.id == update['id'], CanonicalPlace.city == args.city).with_for_update())).scalar_one()
                expected, target = (update['after'], update['before']) if restoring else (update['before'], update['after'])
                if place.content_profile != expected:
                    raise RuntimeError(f'内容已被并发更新，拒绝覆盖: {place.name}')
                await validate_profile_identity(session, args.city, place, update, restoring=restoring, catalog=catalog)
                if not restoring and (target.get('qualityVersion') != 2 or intro_rejection(target['intro'])):
                    raise RuntimeError(f'旧版或未通过质量校验: {place.name}')
                changes.append({**update, 'before': expected, 'after': target})
                place.content_profile = target
            audit = {'city': args.city, 'applied': False, 'updates': changes, 'sourceReport': source_path}
            Path(args.out).write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding='utf-8')
            await session.commit()
            audit['applied'] = True
            Path(args.out).write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding='utf-8')
            print(json.dumps({'updated': len(changes), 'restored': restoring, 'applied': True}))
        await engine.dispose()
        return
    supplemental = json.loads(Path(args.sources_file).read_text(encoding='utf-8')) if args.sources_file else None
    try:
        result = await refine_profiles(args.city, names=args.names, limit=args.limit,
            preview=not args.apply, report_path=Path(args.out), supplemental=supplemental, search_model=args.search_model)
        print(json.dumps(result, ensure_ascii=False))
    finally:
        await engine.dispose()

if __name__ == '__main__':
    asyncio.run(main())
