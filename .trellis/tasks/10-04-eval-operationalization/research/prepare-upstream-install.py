"""保存原文件摘要和逐行差异，供定向安装前审查；无上游写操作。"""
from pathlib import Path
import difflib
import hashlib
import json
import subprocess

base = Path(__file__).resolve().parent
target = Path('D:/Project/xhs-travel-pipeline')
manifest, patches = [], []
for name in ['app/clean/hours.py', 'scripts/export_to_tripweaver.py', 'tests/test_hours.py', 'tests/test_hours_attribution.py']:
    before = (target / name).read_bytes() if (target / name).exists() else None
    after = (base / 'upstream' / name).read_bytes()
    compile(after, name, 'exec')
    manifest.append({'file': name, 'before': hashlib.sha256(before).hexdigest() if before else None,
                     'after': hashlib.sha256(after).hexdigest()})
    base_file = subprocess.run(['git', '-c', f'safe.directory={target.as_posix()}', '-C', str(target), 'show', f'HEAD:{name}'], capture_output=True)
    original = base_file.stdout if base_file.returncode == 0 else b''
    patches.extend(difflib.unified_diff(original.decode('utf-8').splitlines(keepends=True), after.decode('utf-8').splitlines(keepends=True),
                                      fromfile='a/' + name, tofile='b/' + name))
(base / 'upstream-install.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
(base / 'upstream-hours.patch').write_text(''.join(patches), encoding='utf-8')
print('已保存四个文件的摘要与差异')
