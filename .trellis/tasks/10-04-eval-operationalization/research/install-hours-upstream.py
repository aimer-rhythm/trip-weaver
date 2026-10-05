"""校验已审查的四个上游文件并应用；不提交、不迁移或修改数据库。"""
from pathlib import Path
import argparse
import hashlib
import json
import shutil

base = Path(__file__).resolve().parent
target = Path('D:/Project/xhs-travel-pipeline').resolve()
manifest = json.loads((base / 'upstream-install.json').read_text(encoding='utf-8'))
parser = argparse.ArgumentParser()
parser.add_argument('--apply', action='store_true')
args = parser.parse_args()
digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None
for item in manifest:
    destination = (target / item['file']).resolve()
    if not destination.is_relative_to(target):
        raise RuntimeError('目标越界')
    if digest(destination) != item['before']:
        raise RuntimeError(f"源文件已变化，拒绝覆盖: {item['file']}")
    if digest(base / 'upstream' / item['file']) != item['after']:
        raise RuntimeError(f"待应用文件已变化，请重新审查: {item['file']}")
for item in manifest:
    if args.apply:
        destination = target / item['file']
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(base / 'upstream' / item['file'], destination)
    print(('APPLIED ' if args.apply else 'READY ') + item['file'])
