"""准备可审阅的上游工作副本；不写上游目录。"""
import hashlib
import json
from pathlib import Path

SOURCE = Path('D:/Project/xhs-travel-pipeline')
STAGE = Path(__file__).parent / 'upstream-stage'
baseline = {}
for directory in ('app', 'scripts', 'tests'):
    for source in (SOURCE / directory).rglob('*.py'):
        if '__pycache__' in source.parts:
            continue
        relative = source.relative_to(SOURCE)
        target = STAGE / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        data = source.read_bytes()
        target.write_bytes(data)
        baseline[relative.as_posix()] = hashlib.sha256(data).hexdigest()
(STAGE / 'baseline.json').write_text(json.dumps(baseline, indent=2), encoding='utf-8')
print(f'已准备 {len(baseline)} 个文件，无上游写入')
