"""Codex 已查看两张原始照片，并核对作者明确图号；准备审核，不直接写入。"""
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
 '69ac58f7000000000e03d45f': ('西湖断桥', '已查看原始第18张：完整单张桥梁近景，夕阳下石桥护岸与桥面灯柱清晰，作者明确标注“西湖断桥（图18）”，原索引17一致。'),
 '6aa820f100000000280378ee': ('苏堤', '已查看原始第18张：苏堤临湖草地、树荫与长椅单张实拍，作者明确标注“p18 西湖苏堤”；不根据正文地点顺序猜测，原索引17一致。'),
}
async def main():
    images=[]
    async with SessionFactory() as session:
        rows=(await session.execute(select(NoteImage,RawNote).join(RawNote,RawNote.id==NoteImage.raw_note_id).where(RawNote.note_id.in_(list(REVIEWS)),NoteImage.img_index==17))).all()
        assert len(rows)==2
        for image,note in rows:
            name,evidence=REVIEWS[note.note_id]
            candidates=await candidates_for(session,'杭州',note.id)
            place=next((p for p in candidates if p['name']==name),None)
            assert place, f'{name} 不在当前候选中'
            images.append(dict(version=VERSION,image_id=image.id,raw_note_id=note.id,img_index=image.img_index,
                file_path=image.file_path,sha256=image_hash(safe_image(ROOT,image.file_path)),
                title=note.title,desc=note.desc,candidates=candidates,place_id=place['id'],place_name=name,
                status='APPROVED',evidence=evidence,reviewer='Codex（原图与原文图号复核）',review_kind='agent',
                image_kind='single_photo',cover_usable=True,method='caption-and-visual-review'))
    (HERE/'hangzhou-reviewed-caption-additions.json').write_text(json.dumps(dict(version=VERSION,city='杭州',images=images),ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps([dict(image_id=i['image_id'],place_name=i['place_name']) for i in images],ensure_ascii=True))
asyncio.run(main())
