"""暂存上游补丁；保留原文件哈希供安装时拒绝覆盖并发修改。"""
from pathlib import Path
import hashlib
import json

root = Path(__file__).resolve().parent
upstream = Path('D:/Project/xhs-travel-pipeline')
files = ['app/models.py', 'app/clean/alias.py', 'app/clean/place_export.py',
    'app/aggregate/summary.py', 'scripts/export_to_tripweaver.py',
    'scripts/export_place_images.py', 'app/photography/export.py']
manifest = {}
for name in files:
    data = (upstream / name).read_bytes()
    target = root / 'upstream' / name
    if target.exists():
        raise RuntimeError(f'暂存文件已存在，拒绝覆盖：{name}')
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    manifest[name] = hashlib.sha256(data).hexdigest()
(root / 'upstream-base.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
print(f'已暂存 {len(files)} 个文件；未修改上游仓库')
