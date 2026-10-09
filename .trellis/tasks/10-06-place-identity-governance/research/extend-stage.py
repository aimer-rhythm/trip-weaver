from pathlib import Path
import hashlib
import json
import sys

root = Path(__file__).resolve().parent
upstream = Path('D:/Project/xhs-travel-pipeline')
manifest = json.loads((root / 'upstream-base.json').read_text())
for name in sys.argv[1:]:
    target = root / 'upstream' / name
    if target.exists():
        raise RuntimeError(f'已暂存，拒绝覆盖：{name}')
    data = (upstream / name).read_bytes()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    manifest[name] = hashlib.sha256(data).hexdigest()
(root / 'upstream-base.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
