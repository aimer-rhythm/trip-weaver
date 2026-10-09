"""存量同义名修复：默认预览；--apply先写备份，再事务更新，不删除地点/来源/图片。"""
from __future__ import annotations
import argparse
import asyncio
import json
import sys
from pathlib import Path
from collections import defaultdict
sys.path.insert(0, '.')
from sqlalchemy import select
from app.clean.alias import resolve_alias, canonical_display_name
from app.db import SessionFactory, engine
from app.aggregate.place_identity import load_catalog, lock_city
from app.models import CanonicalPlace, PlaceMention, RawNote


def build_alias_plan(rows: list[dict], city: str) -> list[dict]:
    groups = defaultdict(list)
    for row in rows:
        groups[resolve_alias(row['normalized_name'], city)].append(row)
    plan = []
    for canonical, members in groups.items():
        if not any(m['normalized_name'] != canonical or canonical_display_name(m['name'], city) != m['name'] for m in members):
            continue
        keeper = min(members, key=lambda m: (m['normalized_name'] != canonical, not m['is_active'], m['id']))
        for member in members:
            after = {'name': canonical, 'normalized_name': canonical, 'is_active': member['is_active']} if member is keeper else {
                'name': member['name'], 'normalized_name': member['normalized_name'], 'is_active': False}
            before = {key: member[key] for key in after}
            if after != before:
                plan.append({'id': member['id'], 'targetId': keeper['id'], 'canonicalName': canonical, 'before': before, 'after': after})
    return plan


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--city', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    async with SessionFactory() as session:
        await lock_city(session, args.city)
        if args.apply and (await load_catalog(session, args.city)).entities:
            raise ValueError('城市已注册稳定身份；请使用 govern_place_identity.py，不得绕过版本修改源记录')
        places = (await session.execute(select(CanonicalPlace).where(CanonicalPlace.city == args.city))).scalars().all()
        rows = [{key: getattr(p, key) for key in ('id', 'name', 'normalized_name', 'is_active')} for p in places]
        changes = build_alias_plan(rows, args.city)
        mentions = (await session.execute(select(PlaceMention).join(RawNote, RawNote.id == PlaceMention.raw_note_id)
            .where(RawNote.city == args.city))).scalars().all()
        mention_changes = [{'id': m.id, 'before': m.normalized_name, 'after': resolve_alias(m.normalized_name, args.city)}
            for m in mentions if m.normalized_name != resolve_alias(m.normalized_name, args.city)]
        report = {'city': args.city, 'applied': False, 'canonicalChanges': changes, 'mentionChanges': mention_changes}
        # 备份未成功写出就不得更新数据库。
        Path(args.out).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        if args.apply:
            by_id = {p.id: p for p in places}
            for change in changes:
                for field, value in change['after'].items():
                    setattr(by_id[change['id']], field, value)
            by_mention = {m.id: m for m in mentions}
            for change in mention_changes:
                by_mention[change['id']].normalized_name = change['after']
            await session.commit()
            report['applied'] = True
            Path(args.out).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps({'city': args.city, 'canonicalChanges': len(changes), 'mentionChanges': len(mention_changes),
                          'applied': report['applied']}, ensure_ascii=False))
    await engine.dispose()

if __name__ == '__main__':
    asyncio.run(main())
