"""按基线校验安装本任务代码，保存逐文件备份，不提交、不归档。"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
STAGE = HERE / 'upstream-stage'
TARGET = Path('D:/Project/xhs-travel-pipeline').resolve()


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None


def main(apply):
    baseline = json.loads((STAGE / 'baseline.json').read_text('utf-8'))
    changes = []
    for folder in ('app', 'tests', 'scripts', 'web/src', 'docs', '.trellis/spec'):
        for source in (STAGE / folder).rglob('*'):
            if not source.is_file() or '__pycache__' in source.parts or source.suffix not in ('.py', '.md', '.ts', '.tsx', '.css', '.ps1'):
                continue
            relative = source.relative_to(STAGE)
            key = relative.as_posix()
            original = baseline.get(key)
            proposed = digest(source)
            if proposed == original:
                continue
            target = (TARGET / relative).resolve()
            if not target.is_relative_to(TARGET) or '.git' in relative.parts:
                raise RuntimeError(f'目标路径越界: {key}')
            current = digest(target)
            if current == proposed:
                continue
            installed = HERE / 'installed-hashes.json'
            last = json.loads(installed.read_text('utf-8')).get(key) if installed.exists() else None
            if current not in (original, last) or (original is None and last is None and current is not None):
                raise RuntimeError(f'上游文件被其他任务修改，停止安装: {key}')
            changes.append((source, target, key, proposed))
    for _, _, key, _ in changes:
        print(key)
    if apply:
        hashes_path = HERE / 'installed-hashes.json'
        hashes = json.loads(hashes_path.read_text('utf-8')) if hashes_path.exists() else {}
        for source, target, key, proposed in changes:
            if target.exists():
                before = HERE / 'upstream-before' / key
                if not before.exists():
                    before.parent.mkdir(parents=True, exist_ok=True)
                    before.write_bytes(target.read_bytes())
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(source.read_bytes())
            hashes[key] = proposed
        hashes_path.write_text(json.dumps(hashes, indent=2), encoding='utf-8')
    print(f'{"已安装" if apply else "待安装"} {len(changes)} 个文件')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    main(parser.parse_args().apply)
