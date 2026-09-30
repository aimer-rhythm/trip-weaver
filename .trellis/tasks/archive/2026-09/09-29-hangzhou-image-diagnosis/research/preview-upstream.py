"""对真实杭州素材运行候选准备，只读上游数据库。"""
import asyncio
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / 'upstream-stage'))
import app
from scripts import review_place_images

review_place_images.ROOT = Path('D:/Project/xhs-travel-pipeline')
sys.argv = ['review', 'prepare', '--city', '杭州', '--limit', '30', '--out',
            str(HERE / 'hangzhou-review.json')]
asyncio.run(review_place_images.main())
