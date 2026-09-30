"""只读扫描行程缺图地点的原文图号与现有图片，不把候选当作已确认归属。"""
import asyncio
import json
import sys
import re
from pathlib import Path
sys.path.insert(0, 'D:/Project/xhs-travel-pipeline')
from sqlalchemy import text
from app.db import SessionFactory
from app.vision.evidence import caption_references

HERE = Path(__file__).resolve().parent
TARGETS = ['断桥', '苏堤', '三潭印月', '宝石山', '飞来峰', '九溪', '西溪', '大运河', '水上巴士', '河坊街', '南宋御街']

async def main():
    async with SessionFactory() as session:
        await session.execute(text('SET TRANSACTION READ ONLY'))
        places = [dict(x) for x in (await session.execute(text("SELECT c.id,c.name,c.normalized_name,c.latitude,c.longitude FROM canonical_place c JOIN place_summary s ON s.canonical_place_id=c.id WHERE c.city='杭州' AND c.is_active AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL"))).mappings()]
        notes = [dict(x) for x in (await session.execute(text("SELECT id,note_id,title,\"desc\" FROM raw_note WHERE city='杭州' AND status != 'DELETED'"))).mappings()]
        images = [dict(x) for x in (await session.execute(text("SELECT id,raw_note_id,img_index,file_path,img_type,canonical_place_id FROM note_image WHERE city='杭州'"))).mappings()]
    target_places = [p for p in places if any(t in p['name'] for t in TARGETS)]
    refs = []
    for note in notes:
        for index, entries in caption_references(note['desc'], places).items():
            for evidence in entries:
                if not any(p['id'] == evidence['place_id'] for p in target_places):
                    continue
                refs.append(dict(note_id=note['note_id'], raw_note_id=note['id'], index=index,
                    evidence=evidence, local=[i for i in images if i['raw_note_id']==note['id'] and i['img_index']==index]))
    output = dict(places=target_places, references=refs)
    focused = {}
    for target in ['三潭印月','宝石山','飞来峰','九溪十八涧','西溪湿地','水上巴士','南宋御街']:
        relevant = [n for n in notes if target in (n['desc'] or '')]
        relevant.sort(key=lambda n: (sum(p['name'] in (n['desc'] or '') for p in places), -len(n['desc'] or '')))
        focused[target] = [{**n,'local':[i for i in images if i['raw_note_id']==n['id']]} for n in relevant[:3]]
    (HERE/'hangzhou-focused-notes.json').write_text(json.dumps(focused,ensure_ascii=False,indent=2),encoding='utf-8')
    (HERE/'hangzhou-deficit-captions.json').write_text(json.dumps(output,ensure_ascii=False,indent=2,default=str),encoding='utf-8')
    for p in target_places:
        local = [i for i in images if i['canonical_place_id']==p['id']]
        print(json.dumps(dict(id=p['id'],name=p['name'],linked=len(local),scenery=sum(i['img_type']=='scenery' for i in local)),ensure_ascii=True))
    for r in refs:
        print(json.dumps(r,ensure_ascii=True))
    for note in notes:
        lines = [line for line in (note['desc'] or '').splitlines() if re.search(r'(?i)(?:\bp\s*\d|图\s*\d)', line)]
        if lines:
            print(json.dumps(dict(note_id=note['note_id'],lines=lines),ensure_ascii=False))

asyncio.run(main())

