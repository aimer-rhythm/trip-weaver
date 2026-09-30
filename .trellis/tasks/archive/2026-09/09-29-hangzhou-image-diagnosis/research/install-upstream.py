"""按原文件哈希安装已测试补丁；保留改前备份，不提交、不删除。"""
import argparse
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
STAGE = HERE / 'upstream-stage'
TARGET = Path('D:/Project/xhs-travel-pipeline').resolve()

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--apply', action='store_true')
args = parser.parse_args()
baseline = json.loads((STAGE / 'baseline.json').read_text())
changes = []
for source in STAGE.rglob('*'):
    if not source.is_file() or source.suffix not in ('.py', '.md'):
        continue
    relative = source.relative_to(STAGE)
    if '__pycache__' in relative.parts:
        continue
    key = relative.as_posix()
    original = baseline.get(key)
    if digest(source) == original:
        continue
    target = (TARGET / relative).resolve()
    if not target.is_relative_to(TARGET) or '.git' in relative.parts:
        raise RuntimeError(f'目标越界: {relative}')
    actual = digest(target)
    if actual == digest(source):
        continue
    if actual != original:
        raise RuntimeError(f'源文件已被其他工作修改，停止安装: {relative}')
    changes.append((source, target, relative))
for source, target, relative in changes:
    print(relative.as_posix())
if args.apply:
    for source, target, relative in changes:
        if target.exists():
            backup = HERE / 'upstream-before' / relative
            backup.parent.mkdir(parents=True, exist_ok=True)
            if not backup.exists():
                backup.write_bytes(target.read_bytes())
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(source.read_bytes())
print(f'{"已安装" if args.apply else "待安装"} {len(changes)} 个文件')
