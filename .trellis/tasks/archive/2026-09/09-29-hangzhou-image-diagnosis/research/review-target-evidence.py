"""记录已实际查看原图并核对明确图号/地标的四张图片；不批量批准建议。"""
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, 'D:/Project/xhs-travel-pipeline')
from sqlalchemy import select
from app.db import SessionFactory
from app.models import NoteImage, RawNote
from app.vision.assignment import VERSION, candidates_for, safe_image, image_hash

HERE = Path(__file__).resolve().parent
ROOT = Path('D:/Project/xhs-travel-pipeline')
REVIEWS = {
    226: ('雷峰塔', '已查看原图：西湖岸边山丘上的雷峰塔塔身、层檐、金色塔刹完整可辨，塔为照片主体；与同笔记雷峰塔地点候选一致。'),
    269: ('九溪烟树', '已查看原始第1张单张照片，林间石板步道与周围植被清晰；原文明确写“图片对应机位 / p1 九溪烟树”，并非按推荐清单顺序推断。'),
    270: ('太子湾公园', '已查看原始第2张照片，溪流与园林景观为主；原文明确写“图片对应机位 / p2、3 太子湾公园”，原索引1与p2一致。'),
}

async def main():
    images = []
    async with SessionFactory() as session:
        rows = (await session.execute(select(NoteImage, RawNote).join(RawNote, RawNote.id == NoteImage.raw_note_id).where(
            NoteImage.id.in_(list(REVIEWS)) | ((RawNote.note_id == '6aa820f100000000280378ee') & (NoteImage.img_index == 14))
        ))).all()
        assert len(rows) == 4
        for image, note in rows:
            name, evidence = REVIEWS.get(image.id, ('六和塔', '已查看原始第15张单张照片：木构塔内回廊与窗景，原文明确标注“p15 六和塔”；保留原始img_index=14，不由照片排序推断。'))
            candidates = await candidates_for(session, '杭州', note.id)
            place = next(p for p in candidates if p['name'] == name)
            images.append(dict(version=VERSION, image_id=image.id, raw_note_id=note.id,
                img_index=image.img_index, file_path=image.file_path,
                sha256=image_hash(safe_image(ROOT, image.file_path)), title=note.title, desc=note.desc,
                candidates=candidates, place_id=place['id'], place_name=name, status='APPROVED',
                evidence=evidence, reviewer='Codex（原图及来源图号复核）', review_kind='agent',
                image_kind='single_photo', cover_usable=True, method='caption-and-visual-review'))
    (HERE / 'hangzhou-reviewed-targets.json').write_text(json.dumps(dict(version=VERSION, city='杭州', images=images),ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps([dict(image_id=x['image_id'], place_name=x['place_name']) for x in images],ensure_ascii=True))

asyncio.run(main())
