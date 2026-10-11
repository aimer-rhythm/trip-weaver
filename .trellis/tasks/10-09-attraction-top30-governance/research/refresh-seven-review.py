"""按最新阅读台账重绘名单与台账，并保留人工追加的剩余问题章节。"""
import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TASK = ROOT.parent
parser = argparse.ArgumentParser()
parser.add_argument('--readthrough', default='seven-cities-semantic-readthrough-46.json')
parser.add_argument('--ledger', default='seven-cities-review-ledger-39.json')
args = parser.parse_args()
problems = TASK / '七城剩余问题.md'
text = problems.read_text(encoding='utf-8')
marker = '## batch-120完整验证'
tail = ''
if marker in text:
    tail = text[text.index(marker):]
    print(f'保留人工追加 {len(tail)} 字符', file=sys.stderr)
batches = ['batch-108-v2', 'batch-109', 'batch-110', 'batch-111', 'batch-113', 'batch-115', 'batch-112-v2',
    'batch-114-v2', 'batch-116', 'batch-117', 'batch-118', 'batch-119-v2', 'batch-120']
subprocess.run([sys.executable, '-X', 'utf8', '-B', str(ROOT / 'render-seven-review.py'),
    '--ranking', 'seven-cities-ranking-36.json', '--snapshot', 'snapshot-20261010T031749976332Z/input.json',
    '--catalog', 'seven-cities-catalog-29.json', '--retrieval', 'seven-cities-retrieval-27.json',
    '--readthrough', args.readthrough,
    '--ledger', args.ledger, '--batches', *batches], check=True)
if tail:
    with problems.open('a', encoding='utf-8') as handle:
        handle.write('\n' + tail)
