"""安装本任务独立摄影产物；仅新增文件，已有不同内容时整批拒绝。"""
import argparse
import hashlib
import shutil
from pathlib import Path

HERE = Path(__file__).resolve().parent
SOURCE = HERE / 'live/photography/4ad6d27e53d70a5e6e3752e3'
TARGET = Path('D:/Project/xhs-travel-pipeline/data/photography/4ad6d27e53d70a5e6e3752e3').resolve()


def main(apply):
    pending = []
    for source in SOURCE.rglob('*'):
        if not source.is_file() or source.name.endswith('.lock'):
            continue
        target = (TARGET / source.relative_to(SOURCE)).resolve()
        if not target.is_relative_to(TARGET):
            raise RuntimeError('目标路径越界')
        if target.exists():
            if not target.is_file() or hashlib.sha256(target.read_bytes()).digest() != hashlib.sha256(source.read_bytes()).digest():
                raise RuntimeError(f'目标已有不同内容，停止安装：{target.relative_to(TARGET)}')
        else:
            pending.append((source, target))
    if apply:
        for source, target in pending:
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open('xb') as output:
                with source.open('rb') as original:
                    shutil.copyfileobj(original, output)
    print(f'{"已安装" if apply else "待安装"} {len(pending)} 个独立摄影文件')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    main(parser.parse_args().apply)
