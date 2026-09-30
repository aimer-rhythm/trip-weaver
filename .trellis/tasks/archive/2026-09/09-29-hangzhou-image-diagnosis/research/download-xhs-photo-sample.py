"""留存摄影专项候选缩略图，仅供本地审阅；不关联景点、不批准许可。"""
import asyncio
import io
import json
from pathlib import Path
from urllib.parse import urlparse
import httpx
from PIL import Image, ImageOps, ImageDraw, ImageFont

BASE = Path('D:/Project/tripweaver/data/photo-pilot/xhs')
rows = json.loads((BASE / 'report.json').read_text('utf-8'))
(BASE / 'previews').mkdir(exist_ok=True)
font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 15)


async def main():
    async with httpx.AsyncClient(timeout=20, follow_redirects=False) as client:
        for place_index, row in enumerate(rows):
            photos = []
            for note in row['notes']:
                urls = note['imageUrls']
                indices = sorted(set([0, len(urls)//2, len(urls)-1]))
                for index in indices:
                    photo = {'id': f"xhs-{note['id']}-{index}", 'place': row['place'], 'index': index, 'note': note['id'], 'author': note['author'], 'sourceUrl': note['sourceUrl'], 'title': note['title'], 'description': note['description'], 'rights': 'permission-needed', 'review': 'pending'}
                    filename = BASE / 'previews' / (photo['id'] + '.webp')
                    try:
                        if not filename.exists():
                            url = urls[index]
                            parsed = urlparse(url)
                            if parsed.scheme not in ('http', 'https') or not (parsed.hostname or '').endswith('.xhscdn.com'):
                                raise ValueError('image host rejected')
                            async with client.stream('GET', url) as response:
                                response.raise_for_status()
                                chunks = bytearray()
                                async for chunk in response.aiter_bytes():
                                    chunks.extend(chunk)
                                    if len(chunks) > 8*1024*1024:
                                        raise ValueError('image too large')
                            im = ImageOps.exif_transpose(Image.open(io.BytesIO(chunks))).convert('RGB')
                            im.thumbnail((1000, 1000))
                            im.save(filename, 'WEBP', quality=88)
                            await asyncio.sleep(0.5)
                        photos.append(photo)
                    except Exception as err:
                        print(json.dumps({'id': photo['id'], 'error': type(err).__name__}), flush=True)
            row['photos'] = photos
            sheet = Image.new('RGB', (1200, 320 * max(1, (len(photos)+3)//4)), '#eeeeee')
            draw = ImageDraw.Draw(sheet)
            for n, photo in enumerate(photos):
                im = ImageOps.contain(Image.open(BASE / 'previews' / (photo['id']+'.webp')), (290, 245))
                x, y = n%4*300, n//4*320
                sheet.paste(im, (x+(300-im.width)//2,y))
                draw.text((x+5,y+248), f"{photo['note'][-6:]} 图{photo['index']+1}\n{photo['title'][:18]}", font=font, fill='black')
            sheet.save(BASE / f'{place_index:02}-sheet.jpg', quality=90)
            (BASE / 'sample.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2), 'utf-8')
            print(json.dumps({'place':row['place'], 'photos':len(photos)}, ensure_ascii=False), flush=True)


asyncio.run(main())
