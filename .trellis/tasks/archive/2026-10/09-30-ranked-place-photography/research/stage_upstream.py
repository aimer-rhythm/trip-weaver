"""只读复制上游代码供工作区内实现与测试，记录安装基线。"""
from pathlib import Path
import hashlib
import json

SOURCE = Path('D:/Project/xhs-travel-pipeline')
STAGE = Path(__file__).resolve().parent / 'upstream-stage'
baseline = {}
for folder in ('app', 'tests', 'scripts', 'web/src', '.trellis/spec'):
    for src in (SOURCE / folder).rglob('*'):
        if not src.is_file() or '__pycache__' in src.parts or src.suffix not in ('.py', '.ts', '.tsx', '.md', '.css', '.ps1'):
            continue
        relative = src.relative_to(SOURCE)
        dst = STAGE / relative
        if dst.exists():
            raise RuntimeError(f'暂存已有内容，拒绝覆盖: {relative}')
        dst.parent.mkdir(parents=True, exist_ok=True)
        content = src.read_bytes()
        dst.write_bytes(content)
        baseline[relative.as_posix()] = hashlib.sha256(content).hexdigest()
(STAGE / 'baseline.json').write_text(json.dumps(baseline, indent=2), encoding='utf-8')
print(f'已暂存 {len(baseline)} 个文件')
