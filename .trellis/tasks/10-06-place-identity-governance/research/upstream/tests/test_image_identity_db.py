"""逐图分配保留原审核，校验两类图库的原文件、版本、空目标及倒序回滚。"""
from __future__ import annotations

import copy
import hashlib

import pytest
from PIL import Image
from sqlalchemy import select

from app.aggregate.image_identity import apply_image_decision, load_image_catalog, load_image_rows, refresh_image_reviews
from app.aggregate.mention_identity import apply_scope_decision
from app.aggregate.place_identity import load_catalog, rollback_decision
from app.clean.image_identity import image_fingerprint
from app.models import NoteImage, PlaceEntityReview, PlaceImageAssignment, RawNote
from app.photography.store import PhotoStore
from test_mention_identity_db import branch_ids, request, run, seed


async def image_seed(session, root, city='逐图分配测试'):
    places, note, _ = await seed(session, city)
    targets = await branch_ids(session, places)
    scope = await request(session, places[0], targets, key=f'{city}-scope')
    await apply_scope_decision(session, scope)
    images = []
    for index, color in enumerate(['blue', 'green']):
        path = root / f'{index}.jpg'
        Image.new('RGB', (80, 60), color).save(path)
        photo = NoteImage(raw_note_id=note.id, city=city, img_index=index, file_path=path.name,
            img_type='scenery', canonical_place_id=places[0].id,
            assignment={'version': 2, 'review': '原有模型审核不得覆盖', 'confidence': .99})
        session.add(photo)
        images.append(photo)
    await session.flush()
    store = PhotoStore(root / 'photos', city)
    file = store.path('images/curated.jpg')
    file.parent.mkdir(parents=True, exist_ok=True)
    Image.new('RGB', (80, 60), 'red').save(file)
    item = {'place_id': places[0].id, 'note_id': 'external-photo-note', 'image_index': 3,
        'file': 'images/curated.jpg', 'sha256': hashlib.sha256(file.read_bytes()).hexdigest(),
        'source_url': 'https://www.xiaohongshu.com/explore/abc123', 'author': '测试摄影师', 'author_id': 'author123',
        'rights': 'permission-needed', 'model': 'test', 'review_version': 'test',
        'review_method': 'model', 'review': {'status': 'eligible', 'identity': 'match', 'evidence': '原始精选审核'}}
    store.write('selected.json', {'city': city, 'places': {str(places[0].id): {
        'place': {'id': places[0].id, 'name': places[0].name}, 'images': [item]}}})
    return places, targets, scope, images, store


async def image_request(session, city, root, target_ids, key='assign-images'):
    roots = {'source_root': root, 'photography_root': root / 'photos'}
    catalog = await load_image_catalog(session, city)
    rows = await load_image_rows(session, city, **roots)
    assert len(rows) == len(target_ids)
    affected = {eid for eid in target_ids if eid}
    for row in rows:
        source = catalog.mentions.catalog.resolve(place_id=row['source_place_id'])
        if source:
            affected.add(source['entity_id'])
        old = catalog.assignments.get(row['image_key'])
        if old and old['entity_id']:
            affected.add(catalog.mentions.catalog.root(old['entity_id'])['entity_id'])
    return {'key': key, 'city': city, 'evidence': [{'source': '逐图核对门头、主体与原始图片序号'}],
        'expectedRevisions': {eid: catalog.mentions.catalog.entities[eid]['revision'] for eid in affected},
        'images': [{'imageKey': row['image_key'], 'inputHash': image_fingerprint(row), 'entityId': target,
                    'expectedRevision': catalog.assignments.get(row['image_key'], {}).get('revision', 0)}
                   for row, target in zip(rows, target_ids)]}


def test_两类图片默认待审_逐图分配不覆盖原审核_支持空目标与倒序回滚(tmp_path):
    async def check(factory):
        async with factory() as session:
            places, targets, scope, images, store = await image_seed(session, tmp_path)
            city = places[0].city
            roots = {'source_root': tmp_path, 'photography_root': tmp_path / 'photos'}
            before_reviews = [copy.deepcopy(image.assignment) for image in images]
            before_selected = store.read('selected.json')
            rows = await load_image_rows(session, city, **roots)
            catalog = await load_image_catalog(session, city)
            assert len(rows) == 3 and all(catalog.resolve(row)['status'] == 'review' for row in rows)
            first = await image_request(session, city, tmp_path, [targets[0], targets[1], None])
            after = await apply_image_decision(session, first, **roots)
            assert await apply_image_decision(session, first, **roots) == after
            catalog = await load_image_catalog(session, city)
            results = [catalog.resolve(row) for row in rows]
            assert [r['status'] for r in results] == ['resolved', 'resolved', 'review']
            assert results[0]['entity']['entity_id'] == targets[0] and results[1]['entity']['entity_id'] == targets[1]
            assert all(len(catalog.policies(rows)[eid]['approved']) == 1 for eid in targets)
            for _ in range(2):
                assert await refresh_image_reviews(session, city, **roots) == {'controlled': 3, 'pending': 1}
            pending = (await session.scalars(select(PlaceEntityReview).where(PlaceEntityReview.city == city,
                PlaceEntityReview.detail['reason'].astext == 'image_scope', PlaceEntityReview.status == 'PENDING'))).all()
            assert len(pending) == 1 and pending[0].detail['imageKey'].startswith('photography:')
            assert [image.assignment for image in images] == before_reviews
            assert store.read('selected.json') == before_selected
            second = await image_request(session, city, tmp_path, [targets[1], None, targets[0]], key='images-second')
            await apply_image_decision(session, second, **roots)
            with pytest.raises(ValueError, match='后续'):
                await rollback_decision(session, first['key'], image_roots=roots)
            with pytest.raises(ValueError, match='后续'):
                await rollback_decision(session, scope['key'])
            await rollback_decision(session, second['key'], image_roots=roots)
            await rollback_decision(session, first['key'], image_roots=roots)
            assert not (await load_image_catalog(session, city)).assignments
            await rollback_decision(session, scope['key'])
            assert [image.assignment for image in images] == before_reviews
            with pytest.raises(ValueError, match='key'):
                await apply_image_decision(session, first, **roots)
    run(check)


def test_图片分配迁移可重复预演_不改变旧实体(tmp_path):
    from scripts.migrate_place_identity import migrate
    async def check(factory):
        async with factory() as session:
            places, _, _, _, _ = await image_seed(session, tmp_path, '图片迁移测试')
            before = (await load_catalog(session, places[0].city)).entities
            connection = await session.connection()
            await connection.run_sync(lambda conn: PlaceImageAssignment.__table__.drop(conn))
            assert (await migrate(connection, False))['missing'] == ['place_image_assignment']
            await migrate(connection, True)
            assert not (await migrate(connection, True))['missing']
            assert (await load_catalog(session, places[0].city)).entities == before
    run(check)


@pytest.mark.parametrize('duplicate', ['note_index', 'content'])
def test_跨普通与精选图库同原图不能分给两家(duplicate, tmp_path):
    async def check(factory):
        async with factory() as session:
            places, targets, _, images, store = await image_seed(session, tmp_path)
            city = places[0].city
            selected = store.read('selected.json')
            item = next(iter(selected['places'].values()))['images'][0]
            if duplicate == 'note_index':
                item['note_id'] = (await session.get(RawNote, images[0].raw_note_id)).note_id
                item['image_index'] = 0
            else:
                content = (tmp_path / '0.jpg').read_bytes()
                store.path(item['file']).write_bytes(content)
                item['sha256'] = hashlib.sha256(content).hexdigest()
            store.write('selected.json', selected)
            decision = await image_request(session, city, tmp_path, [targets[0], targets[1], targets[1]])
            with pytest.raises(ValueError, match='不能分配给两个实体'):
                await apply_image_decision(session, decision, source_root=tmp_path, photography_root=tmp_path / 'photos')
            assert not (await load_image_catalog(session, city)).assignments
    run(check)


def test_已分配精选从清单消失时仍保留待核且刷新幂等(tmp_path):
    async def check(factory):
        async with factory() as session:
            places, targets, _, _, store = await image_seed(session, tmp_path)
            city = places[0].city
            roots = {'source_root': tmp_path, 'photography_root': tmp_path / 'photos'}
            decision = await image_request(session, city, tmp_path, [targets[0], targets[1], targets[0]])
            await apply_image_decision(session, decision, **roots)
            store.write('selected.json', {'city': city, 'places': {}})
            for _ in range(2):
                assert (await refresh_image_reviews(session, city, **roots))['pending'] == 1
            reviews = (await session.scalars(select(PlaceEntityReview).where(PlaceEntityReview.city == city,
                PlaceEntityReview.detail['reason'].astext == 'image_scope'))).all()
            assert len(reviews) == 1 and reviews[0].status == 'PENDING'
            assert reviews[0].detail['statusReason'] == 'missing_image'
            with pytest.raises(ValueError, match='后续'):
                await rollback_decision(session, decision['key'], image_roots=roots)
    run(check)


@pytest.mark.parametrize('change', ['file', 'review', 'source', 'target', 'duplicate', 'input', 'revision'])
def test_文件审核来源或实体变化拒绝旧图片决定(change, tmp_path):
    async def check(factory):
        async with factory() as session:
            places, targets, _, images, _ = await image_seed(session, tmp_path)
            city = places[0].city
            roots = {'source_root': tmp_path, 'photography_root': tmp_path / 'photos'}
            decision = await image_request(session, city, tmp_path, [targets[0], targets[1], targets[0]])
            if change == 'file':
                Image.new('RGB', (80, 60), 'yellow').save(tmp_path / '0.jpg')
            elif change == 'review':
                images[0].assignment = {'review': '后续人工审核已改'}
            elif change == 'source':
                places[0].name = '来源后来更名'
            elif change == 'target':
                decision['images'][0]['entityId'] = 'other-city-or-unknown'
            elif change == 'duplicate':
                decision['images'].append(decision['images'][0])
            elif change == 'input':
                decision['images'][0]['inputHash'] = '0' * 64
            else:
                decision['images'][0]['expectedRevision'] += 1
            await session.flush()
            with pytest.raises(ValueError):
                await apply_image_decision(session, decision, **roots)
            assert not (await load_image_catalog(session, city)).assignments
    run(check)


def test_分配后原文件变化撤销可导出绑定_新图不继承旧归属(tmp_path):
    async def check(factory):
        async with factory() as session:
            places, targets, _, images, _ = await image_seed(session, tmp_path)
            city = places[0].city
            roots = {'source_root': tmp_path, 'photography_root': tmp_path / 'photos'}
            decision = await image_request(session, city, tmp_path, [targets[0], targets[1], None])
            await apply_image_decision(session, decision, **roots)
            images[0].source_url = 'https://example.test/new-signed-url'
            await session.flush()
            catalog = await load_image_catalog(session, city)
            assert len(catalog.policies(await load_image_rows(session, city, **roots))[targets[0]]['approved']) == 1
            Image.new('RGB', (80, 60), 'yellow').save(tmp_path / '0.jpg')
            policies = catalog.policies(await load_image_rows(session, city, **roots))
            assert policies[targets[0]]['approved'] == []
            assert len(policies[targets[1]]['approved']) == 1
            with pytest.raises(ValueError, match='后续'):
                await rollback_decision(session, decision['key'], image_roots=roots)
            session.add(NoteImage(raw_note_id=images[0].raw_note_id, city=city, img_index=5,
                file_path='1.jpg', img_type='scenery', canonical_place_id=places[1].id))
            await session.flush()
            rows = await load_image_rows(session, city, **roots)
            assert catalog.resolve(next(row for row in rows if row['image_index'] == 5))['status'] == 'review'
    run(check)


def test_两类图库真实导出遵守逐图分配_源停用不丢已确认分店图片(monkeypatch, tmp_path):
    import json
    import sys
    from scripts import export_place_images as images_exporter, export_to_tripweaver as places_exporter
    async def check(factory):
        city = '逐图导出测试'
        roots = {'source_root': tmp_path, 'photography_root': tmp_path / 'photos'}
        for module in [images_exporter, places_exporter]:
            monkeypatch.setattr(module, 'SessionFactory', factory)
        monkeypatch.setattr(images_exporter, 'ROOT', tmp_path)
        async def local_inputs(session, city, **kwargs):
            return await load_image_rows(session, city, **roots)
        monkeypatch.setattr(places_exporter, 'load_image_rows', local_inputs)
        async with factory() as session:
            places, targets, _, _, _ = await image_seed(session, tmp_path, city)
            places[0].is_active = False
            decision = await image_request(session, city, tmp_path, [targets[0], targets[1], None], key='image-export-first')
            await apply_image_decision(session, decision, **roots)
            await session.commit()
        manifest = tmp_path / 'images.json'
        image_args = ['export_place_images.py', '--city', city, '--out', str(manifest),
            '--media-root', str(tmp_path / 'media'), '--photography-root', str(tmp_path / 'photos')]
        monkeypatch.setattr(sys, 'argv', image_args)
        await images_exporter.main()
        exported = json.loads(manifest.read_text(encoding='utf-8'))['images']
        assert len(exported) == 2 and {p['placeId'] for p in exported} == set(targets)
        assert all(p['identityBinding']['entityId'] == p['placeId'] for p in exported)
        assert all(p['sourceSha256'] in p['key'] for p in exported)
        async with factory() as session:
            decision = await image_request(session, city, tmp_path, [targets[0], targets[1], targets[0]], key='image-export-curated')
            await apply_image_decision(session, decision, **roots)
            await session.commit()
        await images_exporter.main()
        exported = json.loads(manifest.read_text(encoding='utf-8'))['images']
        assert len(exported) == 2
        curated = next(p for p in exported if p['placeId'] == targets[0])
        assert curated['key'].startswith('xhs/photography/') and curated['imageIndex'] == 3
        assert curated['identityBinding']['imageKey'] == 'photography:external-photo-note:3'
        places_path = tmp_path / 'places.json'
        monkeypatch.setattr(sys, 'argv', ['export_to_tripweaver.py', '--city', city, '--out', str(places_path)])
        await places_exporter.main()
        place_rows = json.loads(places_path.read_text(encoding='utf-8'))['places']
        policies = {p['id']: p['payload']['imageIdentity'] for p in place_rows}
        assert all(p['identityBinding'] in policies[p['placeId']]['approved'] for p in exported)
        # 明确撤销后输出空图片清单，不能以尚存的旧图库补位。
        async with factory() as session:
            decision = await image_request(session, city, tmp_path, [None, None, None], key='image-export-revoke')
            await apply_image_decision(session, decision, **roots)
            await session.commit()
        monkeypatch.setattr(sys, 'argv', image_args)
        await images_exporter.main()
        assert json.loads(manifest.read_text(encoding='utf-8'))['images'] == []
        monkeypatch.setattr(sys, 'argv', ['export_to_tripweaver.py', '--city', city, '--out', str(places_path)])
        await places_exporter.main()
        assert all(p['payload']['imageIdentity']['approved'] == []
                   for p in json.loads(places_path.read_text(encoding='utf-8'))['places'])
    run(check)
