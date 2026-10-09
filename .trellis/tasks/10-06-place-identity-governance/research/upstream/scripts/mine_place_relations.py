"""从原文逐提及身份发布完整无向关系；地点导出与关系导出共享同一来源版本。"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, ".")

from sqlalchemy import delete, text

from app.db import SessionFactory
from app.aggregate.relation_snapshot import publish_relation_snapshot, relation_document
from app.models import PlaceRelation
# 保留旧规则测试与调用方的导入入口。
from app.clean.relation_text import MAX_GAP, _build_vocab, _find_mentions, _is_related, _pair_key


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--city", required=True)
    ap.add_argument("--export", action="store_true")
    ap.add_argument("--out", type=Path)
    ap.add_argument("--min-mentions", type=int, default=None, help="端点提及数下限；默认沿用当前发布，首次为2")
    ap.add_argument("--prune", action="store_true", help="兼容旧调用；身份关系始终按完整快照替换")
    args = ap.parse_args()
    async with SessionFactory() as session:
        await session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ'))
        snapshot = await publish_relation_snapshot(session, args.city, min_mentions=args.min_mentions)
        # 新快照独立保存ID及逐篇证据；旧裸名表不能继续充当当前挖掘结果。
        await session.execute(delete(PlaceRelation).where(PlaceRelation.city == args.city))
        await session.commit()
    relations = snapshot['relations']
    print(json.dumps({'city': args.city, 'revision': snapshot['revision'], 'relations': len(relations),
        'direct': sum(r['strength'] == 'direct' for r in relations),
        'unresolved': len(snapshot['unresolved'])}, ensure_ascii=False))
    if args.export or args.out:
        out = args.out or Path('D:/Project/tripweaver/import') / f'xhs-place-relations-{args.city}.json'
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(relation_document(snapshot), ensure_ascii=False, indent=1), encoding='utf-8')
        print(f'已导出关系快照 → {out}')


if __name__ == '__main__':
    asyncio.run(main())
