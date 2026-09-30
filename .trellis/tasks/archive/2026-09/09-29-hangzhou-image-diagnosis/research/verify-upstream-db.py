"""在专用临时 PostgreSQL 数据库验证审核、幂等、导出与迁移；不写业务数据。"""
from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
import uuid
from pathlib import Path

import asyncpg
from PIL import Image
from sqlalchemy import select, update
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

sys.path.insert(0, 'D:/Project/xhs-travel-pipeline')
from app.config import settings
from app.models import Base, RawNote, CanonicalPlace, PlaceMention, PlaceSummary, NoteImage
from scripts import review_place_images as review, export_place_images as export, migrate_image_assignment as migration

HERE = Path(__file__).resolve().parent


async def main():
    database = 'xhs_image_test_' + uuid.uuid4().hex[:12]
    assert re.fullmatch(r'xhs_image_test_[0-9a-f]{12}', database)
    original = make_url(settings.database_url)
    admin_url = original.set(drivername='postgresql', database='postgres')
    admin = await asyncpg.connect(admin_url.render_as_string(hide_password=False))
    engine = None
    try:
        await admin.execute(f'CREATE DATABASE "{database}"')
        engine = create_async_engine(original.set(database=database))
        factory = async_sessionmaker(engine, expire_on_commit=False)
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        review.SessionFactory = export.SessionFactory = migration.SessionFactory = factory
        root = HERE / 'db-fixture' / database
        root.mkdir(parents=True)
        review.ROOT = export.ROOT = root
        await migration.main()
        await migration.main()
        async with factory() as session:
            note = RawNote(note_id='fixture', city='杭州', keyword='测试', title='测试笔记', desc='雷峰塔与曲院风荷', status='EXTRACTED')
            tower = CanonicalPlace(name='雷峰塔', normalized_name='雷峰塔', city='杭州', latitude=30.2, longitude=120.1, quality_score=50)
            garden = CanonicalPlace(name='曲院风荷', normalized_name='曲院风荷', city='杭州', latitude=30.3, longitude=120.2, quality_score=50)
            session.add_all([note, tower, garden])
            await session.flush()
            for place in (tower, garden):
                session.add(PlaceSummary(canonical_place_id=place.id, recommend_score=10))
                session.add(PlaceMention(raw_note_id=note.id, name=place.name, normalized_name=place.name))
            relative = 'data/images/杭州/fixture/00.jpg'
            path = root / relative
            path.parent.mkdir(parents=True)
            Image.new('RGB', (90, 60), 'green').save(path)
            image = NoteImage(raw_note_id=note.id, city='杭州', img_index=0, file_path=relative, img_type='scenery')
            session.add(image)
            await session.commit()
            image_id, tower_id = image.id, tower.id
        bundle_path = root / 'review.json'
        await review.prepare(argparse.Namespace(city='杭州', limit=10, place=[], out=str(bundle_path)))
        bundle = json.loads(bundle_path.read_text(encoding='utf-8'))
        assert len(bundle['images']) == 1
        item = bundle['images'][0]
        assert len(item['candidates']) == 2
        item.update(status='APPROVED', place_id=tower_id, place_name='雷峰塔', reviewer='fixture-test',
                    evidence='测试专用图，不是真实审核', cover_usable=True, image_kind='single_photo')
        bundle_path.write_text(json.dumps(bundle, ensure_ascii=False), encoding='utf-8')
        args = argparse.Namespace(input=str(bundle_path), apply=False)
        await review.apply_reviews(args)
        async with factory() as session:
            assert (await session.get(NoteImage, image_id)).canonical_place_id is None
        args.apply = True
        await review.apply_reviews(args)
        async with factory() as session:
            saved = await session.get(NoteImage, image_id)
            assert saved.canonical_place_id == tower_id
            assert saved.assignment['status'] == 'APPROVED'
            stamp = saved.assignment['reviewed_at']
        await review.apply_reviews(args)
        async with factory() as session:
            assert (await session.get(NoteImage, image_id)).assignment['reviewed_at'] == stamp
        manifest = root / 'manifest.json'
        sys.argv = ['export', '--city', '杭州', '--out', str(manifest), '--media-root', str(root / 'media')]
        await export.main()
        assert json.loads(manifest.read_text(encoding='utf-8'))['count'] == 1
        async with factory() as session:
            await session.execute(update(CanonicalPlace).where(CanonicalPlace.id == tower_id).values(is_active=False))
            await session.commit()
        try:
            await review.apply_reviews(args)
        except ValueError:
            pass
        else:
            raise AssertionError('停用地点必须拒绝绑定')
        await export.main()
        assert json.loads(manifest.read_text(encoding='utf-8'))['count'] == 0
        print('临时库验证通过：迁移幂等、候选、预览回滚、审核绑定、重复幂等、停用拒绝、真实导出')
    finally:
        if engine is not None:
            await engine.dispose()
        # 只清理本函数创建、固定前缀且随机命名的临时测试库。
        await admin.execute(f'DROP DATABASE IF EXISTS "{database}"')
        await admin.close()


asyncio.run(main())
