"""在原解释器中加载暂存模块；不写上游文件，不读取应用 .env。"""
from pathlib import Path
import os
import sys
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

stage = Path(__file__).resolve().parent / 'upstream'
original = Path('D:/Project/xhs-travel-pipeline')
installed = '--installed' in sys.argv
if installed:
    sys.argv.remove('--installed')
sys.dont_write_bytecode = True
sys.path.insert(0, str(original))
sys.path.insert(0, str(original / 'vendor/spider_xhs'))
# 本任务天地图凭据待轮换；隔离测试不得继承已暴露的生产凭据。
os.environ['TIANDITU_TK'] = ''
os.environ['TIANDITU_BASE_URL'] = ''
import app
if not installed:
    app.__path__.insert(0, str(stage / 'app'))
    for name in ['clean', 'aggregate', 'photography', 'resolve', 'extract', 'qa', 'web']:
        package = __import__(f'app.{name}', fromlist=['_'])
        package.__path__.insert(0, str(stage / 'app' / name))
import scripts
if not installed:
    scripts.__path__ = [str(stage / 'scripts'), *scripts.__path__]
import pytest
arguments = sys.argv[1:]
tests_arg = next((arg for arg in arguments if not arg.startswith('-') and Path(arg).resolve() == original / 'tests'), None)
if tests_arg:
    arguments.remove(tests_arg)
    files = {p.name: p for p in (original / 'tests').glob('test_*.py')}
    if not installed:
        files.update({p.name: p for p in (stage / 'tests').glob('test_*.py')})
    arguments.extend(str(files[name]) for name in sorted(files))
print('天地图凭据待轮换：本轮明确排除 test_live_resolve_hangzhou，不将其报告为通过。')
raise SystemExit(pytest.main(['-q', '-p', 'no:cacheprovider', '-k', 'not test_live_resolve_hangzhou', *arguments]))
